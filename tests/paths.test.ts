import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalizeRoot, expandPath, isUnder } from '../src/paths.js'
describe('expandPath', () => {
  it('expands ~ and ~/ to the home directory', () => {
    expect(expandPath('~', '/ws', '/home/u')).toBe('/home/u')
    expect(expandPath('~/notes', '/ws', '/home/u')).toBe('/home/u/notes')
  })

  it('keeps absolute paths as written', () => {
    expect(expandPath('/abs/x', '/ws', '/home/u')).toBe('/abs/x')
  })

  it('resolves relative paths against the given workspace root', () => {
    expect(expandPath('../../notes/home', '/work/typescript/proj', '/home/u')).toBe('/work/notes/home')
  })

  it('treats an unsupported ~user spelling as a literal relative path', () => {
    expect(expandPath('~foo', '/ws', '/home/u')).toBe('/ws/~foo')
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
    expect(canonicalizeRoot(join(link, 'child'))).toBe(join(real, 'child'))
  })

  it('appends a not-yet-existing suffix verbatim', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    expect(canonicalizeRoot(join(base, 'nope', 'deeper'))).toBe(join(base, 'nope', 'deeper'))
  })

  it('resolves an empty spelling to the process working directory', () => {
    expect(isAbsolute(canonicalizeRoot(''))).toBe(true)
    expect(canonicalizeRoot('')).toBe(realpathSync.native(process.cwd()))
  })

  it('is idempotent', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const once = canonicalizeRoot(join(base, 'nope'))
    expect(canonicalizeRoot(once)).toBe(once)
  })
})

describe('isUnder', () => {
  it('accepts the root itself and descendants', () => {
    expect(isUnder('/a/b', '/a/b')).toBe(true)
    expect(isUnder('/a/b/c.md', '/a/b')).toBe(true)
  })

  it('rejects siblings and parent-traversal spellings', () => {
    expect(isUnder('/a/bc', '/a/b')).toBe(false)
    expect(isUnder('/a', '/a/b')).toBe(false)
    expect(isUnder('/a/../b/c', '/a')).toBe(false)
  })

  it('accepts a child whose NAME starts with dots', () => {
    expect(isUnder('/a/..cache/x.md', '/a')).toBe(true)
    expect(isUnder('/a/..foo', '/a')).toBe(true)
    expect(isUnder('/a/...', '/a')).toBe(true)
  })
})
