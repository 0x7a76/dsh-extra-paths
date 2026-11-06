import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  expandNameMatches,
  findNameComponent,
  NAME_RULE_LIMITS,
  scopeRootsOf,
} from '../src/name-rule.js'
import type { PlatformFacts } from '../src/platform.js'

const posix: PlatformFacts = { platform: 'darwin', wsl: false, wslMountRoot: '/mnt', home: '/Users/someone' }
const windows: PlatformFacts = { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' }

/** A throw-away tree, canonicalised (darwin's /var → /private/var must not leak). */
function fixture(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), 'xp-name-')))
}

describe('scopeRootsOf', () => {
  it('keeps the workspace first and drops roots nested inside another scope root', () => {
    const facts = posix
    expect(scopeRootsOf('/ws', ['/ws/repo', '/extra', '/extra/nested'], facts)).toEqual(['/ws', '/extra'])
  })

  it('deduplicates without reordering', () => {
    expect(scopeRootsOf('/ws', ['/b', '/a', '/b'], posix)).toEqual(['/ws', '/b', '/a'])
  })

  it('resolves relative spellings through the host path API', () => {
    expect(scopeRootsOf('C:\\ws', ['C:\\ws\\repo', 'D:\\data'], windows))
      .toEqual(['C:\\ws', 'D:\\data'])
  })
})

describe('findNameComponent (lexical, filesystem-free)', () => {
  const roots = ['/ws', '/extra']

  it('matches the component itself and everything beneath it', () => {
    expect(findNameComponent('/ws/repo/.git', '.git', roots, posix)).toBe('/ws/repo/.git')
    expect(findNameComponent('/ws/repo/.git/config', '.git', roots, posix)).toBe('/ws/repo/.git')
    expect(findNameComponent('/extra/a/.git', '.git', roots, posix)).toBe('/extra/a/.git')
  })

  it('matches a file component too', () => {
    expect(findNameComponent('/ws/repo/.env', '.env', roots, posix)).toBe('/ws/repo/.env')
  })

  it('does not match a sibling spelling or a path outside every scope root', () => {
    expect(findNameComponent('/ws/repo/.gitignore', '.git', roots, posix)).toBeUndefined()
    expect(findNameComponent('/ws/repo/x', '.git', roots, posix)).toBeUndefined()
    expect(findNameComponent('/elsewhere/.git', '.git', roots, posix)).toBeUndefined()
  })

  it('matches a scope root whose own basename is the name', () => {
    expect(findNameComponent('/ws/.git/x', '.git', ['/ws/.git'], posix)).toBe('/ws/.git')
  })

  it('compares case-insensitively on a Windows host only', () => {
    expect(findNameComponent('C:\\Work\\Repo\\.GIT\\config', '.git', ['C:\\Work'], windows))
      .toBe('C:\\Work\\Repo\\.GIT')
    expect(findNameComponent('/ws/Repo/.GIT/x', '.git', roots, posix)).toBeUndefined()
  })
})

describe('expandNameMatches (bounded walk)', () => {
  it('finds directories and files at any walked depth, and skips pruned descent', () => {
    const base = fixture()
    mkdirSync(join(base, 'repo', '.git', 'objects'), { recursive: true })
    writeFileSync(join(base, 'repo', '.env'), 'secret')
    mkdirSync(join(base, 'a', 'b', '.git'), { recursive: true })
    mkdirSync(join(base, 'node_modules', 'pkg', '.git'), { recursive: true })
    const expansion = expandNameMatches('.git', [base], posix)
    expect(expansion.matches).toEqual([join(base, 'a', 'b', '.git'), join(base, 'repo', '.git')])
    expect(expansion.complete).toBe(true)
    // …and the `.env` walk sees files, not only directories.
    expect(expandNameMatches('.env', [base], posix).matches).toEqual([join(base, 'repo', '.env')])
  })

  it('deduplicates nested scope roots (the outer walk already covers them)', () => {
    const base = fixture()
    mkdirSync(join(base, 'repo', '.git'), { recursive: true })
    const roots = scopeRootsOf(base, [join(base, 'repo')], posix)
    expect(expandNameMatches('.git', roots, posix).matches).toEqual([join(base, 'repo', '.git')])
  })

  it('reports a cap, keeps the matches it found, and marks the affected root', () => {
    const base = fixture()
    mkdirSync(join(base, 'a', '.git'), { recursive: true })
    mkdirSync(join(base, 'b', '.git'), { recursive: true })
    const expansion = expandNameMatches('.git', [base], posix, { ...NAME_RULE_LIMITS, maxMatches: 1 })
    expect(expansion.capped).toBe(true)
    expect(expansion.cap).toBe('matches')
    expect(expansion.complete).toBe(false)
    expect(expansion.incompleteRoots).toContain(base)
    expect(expansion.matches).toHaveLength(1)
  })

  it('reports a directory-scan cap', () => {
    const base = fixture()
    mkdirSync(join(base, 'a'), { recursive: true })
    const expansion = expandNameMatches('.git', [base], posix, { ...NAME_RULE_LIMITS, maxDirs: 1 })
    expect(expansion.cap).toBe('directories')
    expect(expansion.complete).toBe(false)
    expect(expansion.incompleteRoots).toContain(base)
  })

  it('reports depth truncation as incomplete instead of claiming exhaustive coverage', () => {
    const base = fixture()
    mkdirSync(join(base, 'a', 'b', 'c', '.git'), { recursive: true })
    const expansion = expandNameMatches('.git', [base], posix, { ...NAME_RULE_LIMITS, maxDepth: 1 })
    expect(expansion.matches).toEqual([])
    expect(expansion.truncated).toBe(true)
    expect(expansion.incompleteRoots).toContain(base)
    expect(expansion.complete).toBe(false)
  })

  it('keeps one root\'s matches when ANOTHER root is the incomplete one', () => {
    // The real-host bug this pins: a deep/unreadable writable root (a runtime
    // directory) used to make the whole rule incomplete, so a `.git` rule
    // protected the fs tools but silently skipped the shell in the WORKSPACE.
    const workspace = fixture()
    const deepRoot = fixture()
    mkdirSync(join(workspace, '.git'), { recursive: true })
    mkdirSync(join(deepRoot, 'a', 'b', '.git'), { recursive: true })
    const expansion = expandNameMatches('.git', [workspace, deepRoot], posix, { ...NAME_RULE_LIMITS, maxDepth: 1 })
    expect(expansion.matches).toEqual([join(workspace, '.git')])
    expect(expansion.incompleteRoots).toEqual([deepRoot])
    expect(expansion.complete).toBe(false)
  })

  it('skips symlink matches and counts them, so the caller must not claim completeness', () => {
    const base = fixture()
    const target = join(base, 'real-env')
    writeFileSync(target, 'x')
    symlinkSync(target, join(base, '.env'))
    const expansion = expandNameMatches('.env', [base], posix)
    expect(expansion.matches).toEqual([])
    expect(expansion.skippedSymlinks).toBe(1)
    expect(expansion.incompleteRoots).toContain(base)
    expect(expansion.complete).toBe(false)
  })

  it('does not follow symlinked directories', () => {
    const base = fixture()
    const real = join(base, 'real')
    mkdirSync(join(real, '.git'), { recursive: true })
    symlinkSync(real, join(base, 'linked'))
    expect(expandNameMatches('.git', [base], posix).matches).toEqual([join(real, '.git')])
  })

  it('matches a scope root whose own basename is the name without walking it', () => {
    const base = fixture()
    const root = join(base, '.git')
    mkdirSync(join(root, 'objects'), { recursive: true })
    const expansion = expandNameMatches('.git', [root], posix)
    expect(expansion.matches).toEqual([root])
    expect(expansion.complete).toBe(true)
  })
})
