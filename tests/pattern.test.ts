import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { expandPattern, isPattern, parsePattern, parsePatternOutcome, PATTERN_LIMITS } from '../src/pattern.js'
import type { PlatformFacts } from '../src/paths.js'
import { clearPatternCache, resolveRoots } from '../src/resolve.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const repoA = join(base, 'repo-a')
const repoB = join(base, 'repo-b')
const worktreeA1 = join(repoA, '.worktrees', 'dev_1')
const worktreeA2 = join(repoA, '.worktrees', 'dev_2')
const worktreeB1 = join(repoB, '.worktrees', 'dev_b1')
mkdirSync(worktreeA1, { recursive: true })
mkdirSync(worktreeA2, { recursive: true })
mkdirSync(worktreeB1, { recursive: true })
mkdirSync(join(repoB, 'src'), { recursive: true })
mkdirSync(join(base, 'plain', 'notes'), { recursive: true })
// A `.worktrees` the walk must NOT reach: pruning is part of the safety story.
mkdirSync(join(repoA, 'node_modules', 'pkg', '.worktrees'), { recursive: true })
// Fixtures for the two newer capabilities: a FINAL literal may match a file, and
// a pruned name (`.git`) stays matchable even though the walk never descends into it.
mkdirSync(join(repoA, '.git'), { recursive: true })
writeFileSync(join(repoA, '.git', 'config'), 'x')
writeFileSync(join(repoA, '.env'), 'SECRET=1')
writeFileSync(join(base, 'plain', 'notes', '.env'), 'SECRET=2')

/** A POSIX host whose home does not exist on this machine (pure lexical rules). */
const posix: PlatformFacts = { platform: 'darwin', wsl: false, wslMountRoot: '/mnt', home: '/Users/someone' }
/** A Windows host: the lexical half of the pattern grammar never touches the fs. */
const windows: PlatformFacts = { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' }
/** A WSL host: Windows spellings are translated instead of being foreign. */
const wsl: PlatformFacts = { platform: 'linux', wsl: true, wslMountRoot: '/mnt', home: '/Users/someone' }

/** Resolve one pattern spelling against the fixture, through the real pipeline. */
function rootsFor(spelling: string) {
  const report = resolveRoots(normalizeConfig({ paths: [{ path: spelling, access: 'always-write' }] }), base)
  return { report, entries: report.entries, roots: report.roots.map(root => root.root) }
}

describe('isPattern / parsePattern', () => {
  it('treats a wildcard spelling as a pattern and a literal one as a path', () => {
    expect(isPattern('/a/b/*')).toBe(true)
    expect(isPattern('/a/b/**/.worktrees/..')).toBe(true)
    expect(isPattern('../notes')).toBe(false)
  })

  it('refuses an anchor that is too shallow to bound the walk', () => {
    // `~/**` and `/**` would walk a whole home directory or the filesystem.
    expect(parsePattern('~/**', base, posix)).toBeUndefined()
    expect(parsePattern('/**', base)).toBeUndefined()
    expect(parsePattern('/srv/**', base)).toBeUndefined()
    // …while a two-segment anchor is accepted.
    expect(parsePattern('/srv/data/**', base)?.anchor).toBe('/srv/data')
    expect(parsePattern('~/projects/**', base, posix)?.anchor).toBe('/Users/someone/projects')
  })

  it('anchors a wildcard-led workspace-relative pattern at the session workspace, but refuses a pure sweep', () => {
    // `**/.worktrees` means "under THIS session's workspace" — it needs no
    // machine-specific work-root spelling and never walks above the workspace.
    expect(parsePattern('**/.worktrees', base)?.anchor).toBe(base)
    expect(parsePattern('**/.worktrees', base)?.segments).toEqual(['**', '.worktrees'])
    // A relative pattern with a literal prefix is anchored at that subdirectory.
    expect(parsePattern('services/**/notes', base)?.anchor).toBe(join(base, 'services'))
    expect(parsePattern('../**/.git', base)?.anchor).toBe(realpathSync.native(join(base, '..')))
    // `**` / `**/*` alone would sweep the whole workspace.
    expect(parsePattern('**', base)).toBeUndefined()
    expect(parsePattern('**/*', base)).toBeUndefined()
  })

  it('refuses an anchor that IS or CONTAINS the home directory', () => {
    expect(parsePattern('/Users/someone/**', base, posix)).toBeUndefined()
    expect(parsePattern('/Users/**', base, posix)).toBeUndefined()
  })

  it('separates a trailing .. run from the walk', () => {
    const pattern = parsePattern(`${base}/**/.worktrees/..`, base)
    expect(pattern?.segments).toEqual(['**', '.worktrees'])
    expect(pattern?.up).toBe(1)
  })
})

describe('parsePattern across path dialects', () => {
  it('parses a Windows spelling and translates its anchor into the host dialect', () => {
    // The grammar sees `/`, the anchor is translated by the host half: one
    // configuration is meant to describe the same tree on Windows and in WSL.
    const pattern = parsePattern('C:\\work\\**\\notes', base, wsl)
    expect(pattern?.anchor).toBe('/mnt/c/work')
    expect(pattern?.segments).toEqual(['**', 'notes'])
  })

  it('accepts both Windows separators in the pattern grammar', () => {
    expect(parsePattern('C:/work/**/notes', base, wsl)?.anchor).toBe('/mnt/c/work')
    expect(parsePattern('C:\\work/**\\notes', base, wsl)?.anchor).toBe('/mnt/c/work')
  })

  it('reports a Windows anchor as foreign instead of rejecting the pattern', () => {
    // Shared configurations must stay usable everywhere: the entry is merely
    // inactive here, with the reason the caller turns into one warning.
    const outcome = parsePatternOutcome('C:\\work\\**\\notes', base, posix)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.foreign).toContain('Windows')
    // …and parsePattern reduces that to "not walkable on this host".
    expect(parsePattern('C:\\work\\**\\notes', base, posix)).toBeUndefined()
  })

  it('expands a Windows home spelling through the host home directory', () => {
    expect(parsePattern('~\\projects\\**', base, wsl)?.anchor).toBe('/Users/someone/projects')
    expect(parsePattern('~\\projects\\**', base, posix)?.anchor).toBe('/Users/someone/projects')
  })

  it('rejects a volume root AFTER translation', () => {
    // `C:\` inside WSL is `/mnt/<mountRoot>/c`; the literal-root rejection runs on
    // the canonical host path, so the drive root cannot slip through as an anchor.
    expect(parsePattern('/mnt/c/**/x', base, wsl)).toBeUndefined()
    // …and on native Windows the POSIX spelling is translated the other way.
    expect(parsePattern('/mnt/c/**/x', base, windows)).toBeUndefined()
    // A UNC share root is as broad as a drive and is refused in its own dialect.
    expect(parsePattern('\\\\mnt\\c\\**\\x', base, windows)).toBeUndefined()
  })

  it('carries the host facts the anchor was parsed with into the walk', () => {
    const pattern = parsePattern('C:\\work\\**\\notes', base, wsl)
    expect(pattern?.platform).toBe(wsl)
  })
})

describe('expandPattern', () => {
  const parsed = (spelling: string) => {
    const pattern = parsePattern(spelling, base)
    if (pattern === undefined) throw new Error(`pattern not parsed: ${spelling}`)
    return pattern
  }

  it('matches a directory that CONTAINS .worktrees, at any depth (** and ..)', () => {
    expect(expandPattern(parsed(`${base}/**/.worktrees/..`)).matches).toEqual([repoA, repoB])
  })

  it('matches one level below .worktrees (*)', () => {
    expect(expandPattern(parsed(`${base}/**/.worktrees/*`)).matches)
      .toEqual([worktreeA1, worktreeA2, worktreeB1].sort())
  })

  it('lets ** match zero segments as well as many', () => {
    expect(expandPattern(parsed(`${base}/**/notes`)).matches).toEqual([join(base, 'plain', 'notes')])
    expect(expandPattern(parsed(`${base}/plain/**`)).matches).toEqual([join(base, 'plain'), join(base, 'plain', 'notes')])
  })

  it('never descends into node_modules or .git', () => {
    const matches = expandPattern(parsed(`${base}/**/.worktrees/..`)).matches
    expect(matches.some(match => match.includes('node_modules'))).toBe(false)
  })

  it('matches a pruned NAME as the final segment, and still never descends into it', () => {
    // `.git` must stay matchable — otherwise the main reason to use a pattern
    // here would be impossible — but nothing below it is walked.
    expect(expandPattern(parsed(`${base}/**/.git`)).matches).toEqual([join(repoA, '.git')])
    expect(expandPattern(parsed(`${base}/**/.git/config`)).matches).toEqual([])
  })

  it('matches a FILE when the final segment is a literal name', () => {
    expect(expandPattern(parsed(`${base}/**/.env`)).matches).toEqual([
      join(base, 'plain', 'notes', '.env'),
      join(repoA, '.env'),
    ])
    // A trailing wildcard keeps its historical directories-only meaning.
    expect(expandPattern(parsed(`${base}/**/*`)).matches.every(match => !match.endsWith('.env'))).toBe(true)
  })

  it('expands a workspace-relative pattern against the same fixture', () => {
    expect(expandPattern(parsed('**/.worktrees')).matches).toEqual([join(repoA, '.worktrees'), join(repoB, '.worktrees')])
    expect(expandPattern(parsed('*/src')).matches).toEqual([join(repoB, 'src')])
  })

  it('treats the depth bound as semantics, keeping what it found', () => {
    // `**` means "up to maxDepth levels": a shallower bound still matches, it
    // only reports that it stopped — unlike a runaway walk, which grants nothing.
    const shallow = expandPattern(parsed(`${base}/**`), {
      maxDirs: PATTERN_LIMITS.maxDirs,
      maxMatches: PATTERN_LIMITS.maxMatches,
      maxDepth: 0,
    })
    expect(shallow.capped).toBe(false)
    expect(shallow.truncated).toBe(true)
    expect(shallow.matches).toContain(base)
  })

  it('fails closed when the walk runs away (directories or matches)', () => {
    const wide = expandPattern(parsed(`${base}/**`), { maxDirs: 2, maxMatches: PATTERN_LIMITS.maxMatches, maxDepth: PATTERN_LIMITS.maxDepth })
    expect(wide.capped).toBe(true)
    expect(wide.cap).toBe('directories')
    expect(wide.matches).toEqual([])
    const many = expandPattern(parsed(`${base}/**`), { maxDirs: PATTERN_LIMITS.maxDirs, maxMatches: 1, maxDepth: PATTERN_LIMITS.maxDepth })
    expect(many.capped).toBe(true)
    expect(many.cap).toBe('matches')
    expect(many.matches).toEqual([])
  })
})

describe('patterns through resolveRoots', () => {
  beforeEach(() => { clearPatternCache() })

  it('turns one pattern entry into one root per match', () => {
    const { roots, entries, report } = rootsFor(`${base}/**/.worktrees/*`)
    expect(roots).toEqual([worktreeA1, worktreeA2, worktreeB1].sort())
    // One entry per match, all carrying the configured spelling so the page can
    // show "this row produced N roots".
    expect(entries.map(entry => entry.raw)).toEqual(Array(3).fill(`${base}/**/.worktrees/*`))
    expect(entries.every(entry => entry.status === 'ok')).toBe(true)
    expect(report.warnings).toEqual([])
  })

  it('warns when a granted root contains the session workspace', () => {
    // The worktree case this feature exists for: the session runs INSIDE a
    // worktree while the pattern grants the repository root above it.
    const report = resolveRoots(
      normalizeConfig({ paths: [`${base}/**/.worktrees/..`] }),
      worktreeA1,
    )
    expect(report.roots.map(root => root.root)).toEqual([repoA, repoB])
    expect(report.warnings.join('\n')).toContain('contains this session')
  })

  it('grants the repository root for the .worktrees parent pattern', () => {
    expect(rootsFor(`${base}/**/.worktrees/..`).roots).toEqual([repoA, repoB])
  })

  it('resolves a workspace-relative pattern against the given workspace', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: '**/.worktrees', access: 'deny' }] }), base)
    expect(report.denied.map(rule => rule.root)).toEqual([join(repoA, '.worktrees'), join(repoB, '.worktrees')])
    expect(report.entries.every(entry => entry.status === 'ok')).toBe(true)
  })

  it('resolves a file pattern to the matched FILE path', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: '**/.env', access: 'deny' }] }), base)
    expect(report.denied.map(rule => rule.root)).toEqual([join(base, 'plain', 'notes', '.env'), join(repoA, '.env')])
  })

  it('reports zero matches as missing, with a warning, and grants nothing', () => {
    const { roots, entries, report } = rootsFor(`${base}/**/nothing-here`)
    expect(roots).toEqual([])
    expect(entries[0]).toMatchObject({ status: 'missing', resolved: '' })
    expect(report.warnings.join('\n')).toContain('matches no existing directory')
  })

  it('reports an unwalkable anchor as rejected and grants nothing', () => {
    const { roots, entries, report } = rootsFor('/**')
    expect(roots).toEqual([])
    expect(entries[0]).toMatchObject({ status: 'rejected', resolved: '' })
    expect(report.warnings.join('\n')).toContain('was not expanded because its anchor is not walkable')
  })

  it('reports each match of a read-only pattern as a read-only rule', () => {
    const report = resolveRoots(
      normalizeConfig({ paths: [{ path: `${base}/**/.worktrees/*`, access: 'read' }] }),
      base,
    )
    expect(report.roots).toEqual([])
    expect(report.readOnly.map(rule => rule.root)).toEqual([worktreeA1, worktreeA2, worktreeB1].sort())
    expect(report.readOnly.every(rule => rule.access === 'read')).toBe(true)
  })

  it('reuses an expansion for a few seconds, then follows the filesystem', () => {
    expect(rootsFor(`${base}/**/.worktrees/*`).roots).toHaveLength(3)
    const worktreeA3 = join(repoA, '.worktrees', 'dev_3')
    mkdirSync(worktreeA3)
    // Cached: a brand-new worktree is not granted yet (bounded staleness).
    expect(rootsFor(`${base}/**/.worktrees/*`).roots).toHaveLength(3)
    clearPatternCache()
    expect(rootsFor(`${base}/**/.worktrees/*`).roots).toEqual([worktreeA1, worktreeA2, worktreeA3, worktreeB1].sort())
  })

  it('leaves a literal entry exactly as it was', () => {
    const { roots, entries } = rootsFor(join(repoB, 'src'))
    expect(roots).toEqual([join(repoB, 'src')])
    expect(entries).toHaveLength(1)
  })
})
