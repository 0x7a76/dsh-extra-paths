import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeRoot,
  discoverPlatformFacts,
  expandConfiguredPath,
  isUnder,
  pathApiOf,
  type PlatformFacts,
} from '../src/paths.js'

/** A POSIX host whose home is the real one (so `~` tests are not fake paths). */
const posix: PlatformFacts = { platform: 'darwin', wsl: false, wslMountRoot: '/mnt', home: homedir() }
/** A Windows host; the lexical half of the logic does not touch the filesystem. */
const windows: PlatformFacts = { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' }

describe('discoverPlatformFacts', () => {
  it('reports the running host and an absolute home', () => {
    const facts = discoverPlatformFacts()
    expect(facts.platform).toBe(process.platform)
    expect(isAbsolute(facts.home)).toBe(true)
    expect(typeof facts.wsl).toBe('boolean')
    expect(facts.wslMountRoot.startsWith('/')).toBe(true)
  })

  it('selects the matching node:path implementation', () => {
    expect(pathApiOf(posix)).toBe(pathApiOf(posix))
    expect(pathApiOf(posix).sep).toBe('/')
    expect(pathApiOf(windows).sep).toBe('\\')
  })
})

describe('expandConfiguredPath', () => {
  it('expands ~ and ~/ to the configured home', () => {
    expect(expandConfiguredPath('~', '/ws', posix)).toMatchObject({ ok: true, path: posix.home })
    expect(expandConfiguredPath('~/notes', '/ws', posix)).toMatchObject({ ok: true, path: `${posix.home}/notes` })
  })

  it('resolves relative paths against the given workspace root', () => {
    expect(expandConfiguredPath('../../notes/home', '/work/typescript/proj', posix))
      .toMatchObject({ ok: true, path: '/work/notes/home' })
  })

  it('treats an unsupported ~user spelling as a literal relative path', () => {
    expect(expandConfiguredPath('~foo', '/ws', posix)).toMatchObject({ ok: true, path: '/ws/~foo' })
  })

  it('uses the host dialect for the returned path', () => {
    expect(expandConfiguredPath('sub\\dir', 'C:\\ws', windows)).toMatchObject({ ok: true, path: 'C:\\ws\\sub\\dir' })
  })
})

describe('canonicalizeRoot', () => {
  it('resolves a symlinked ancestor', () => {
    // realpath the fixture: on darwin tmpdir() is /var/... while the canonical
    // spelling is /private/var/..., and canonicalizeRoot is SUPPOSED to return
    // the latter — the expectation, not the implementation, was wrong.
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const real = join(base, 'real')
    const link = join(base, 'link')
    mkdirSync(real)
    symlinkSync(real, link)
    expect(canonicalizeRoot(join(link, 'child'), posix)).toBe(join(real, 'child'))
  })

  it('appends a not-yet-existing suffix verbatim', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    expect(canonicalizeRoot(join(base, 'nope', 'deeper'), posix)).toBe(join(base, 'nope', 'deeper'))
  })

  it('resolves an empty spelling to the process working directory', () => {
    expect(isAbsolute(canonicalizeRoot('', posix))).toBe(true)
    expect(canonicalizeRoot('', posix)).toBe(realpathSync.native(process.cwd()))
  })

  it('is idempotent', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const once = canonicalizeRoot(join(base, 'nope'), posix)
    expect(canonicalizeRoot(once, posix)).toBe(once)
  })
})

describe('isUnder', () => {
  it('accepts the root itself and descendants', () => {
    expect(isUnder('/a/b', '/a/b', posix)).toBe(true)
    expect(isUnder('/a/b/c.md', '/a/b', posix)).toBe(true)
  })

  it('rejects siblings and parent-traversal spellings', () => {
    expect(isUnder('/a/bc', '/a/b', posix)).toBe(false)
    expect(isUnder('/a', '/a/b', posix)).toBe(false)
    expect(isUnder('/a/../b/c', '/a', posix)).toBe(false)
  })

  it('accepts a child whose NAME starts with dots', () => {
    expect(isUnder('/a/..cache/x.md', '/a', posix)).toBe(true)
    expect(isUnder('/a/..foo', '/a', posix)).toBe(true)
    expect(isUnder('/a/...', '/a', posix)).toBe(true)
  })

  it('compares Windows spellings case-insensitively, without touching the filesystem', () => {
    expect(isUnder('C:\\Users\\Me\\work\\x', 'C:\\Users\\me', windows)).toBe(true)
    expect(isUnder('C:\\Users\\me\\work', 'c:\\users\\ME', windows)).toBe(true)
    expect(isUnder('D:\\Users\\me\\work', 'C:\\Users\\me', windows)).toBe(false)
    expect(isUnder('C:\\Users\\meX', 'C:\\Users\\me', windows)).toBe(false)
  })

  it('falls back to filesystem identity for an alias spelling (symlinked root)', () => {
    // The base fs fence does the same thing for Windows 8.3 names and case
    // aliases: lexical containment first, then dev+ino on the target's
    // existing ancestors. A symlinked root is the portable way to pin it.
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const real = join(base, 'real')
    const link = join(base, 'link')
    mkdirSync(real)
    symlinkSync(real, link)
    // `darwin` enables the fallback; the comparison itself is POSIX either way.
    expect(isUnder(real, link, posix)).toBe(true)
    expect(isUnder(join(real, 'child'), link, posix)).toBe(true)
  })

  it('skips the identity fallback on a plain Linux host (perf gate, no aliases there)', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const real = join(base, 'real')
    const link = join(base, 'link')
    mkdirSync(real)
    symlinkSync(real, link)
    const plainLinux: PlatformFacts = { platform: 'linux', wsl: false, wslMountRoot: '/mnt', home: '/home/u' }
    expect(isUnder(real, link, plainLinux)).toBe(false)
  })
})
