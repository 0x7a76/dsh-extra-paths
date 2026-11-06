import { describe, expect, it } from 'vitest'
import { isFilesystemRoot, normalizeConfig, validateConfig } from '../src/config.js'

describe('normalizeConfig', () => {
  it('applies the plugin-level defaults', () => {
    const config = normalizeConfig({ paths: ['~/notes'] })
    expect(config.paths).toEqual([{ path: '~/notes', access: 'write', surfaces: ['fs', 'shell'] }])
    expect(config.defaultAccess).toBe('write')
  })

  it('lets one entry override access and surfaces', () => {
    const config = normalizeConfig({
      defaultSurfaces: ['fs'],
      paths: [{ path: '/tmp/x', access: 'always-write', surfaces: ['shell'] }],
    })
    expect(config.paths[0]).toEqual({ path: '/tmp/x', access: 'always-write', surfaces: ['shell'] })
  })

  it('lets the plugin-level defaultAccess reach an entry that omits its own', () => {
    const config = normalizeConfig({ defaultAccess: 'read', paths: ['/x'] })
    expect(config.paths[0]?.access).toBe('read')
  })

  it('accepts every access level', () => {
    for (const access of ['deny', 'read', 'write', 'always-write'] as const) {
      expect(normalizeConfig({ paths: [{ path: '/x', access }] }).paths[0]?.access).toBe(access)
    }
  })

  it('maps the legacy per-entry scope onto access', () => {
    const config = normalizeConfig({ paths: [{ path: '/x', scope: 'always-write' }] })
    expect(config.paths[0]?.access).toBe('always-write')
  })

  it('maps the legacy defaultScope onto defaultAccess', () => {
    const config = normalizeConfig({ defaultScope: 'always-write', paths: ['/x'] })
    expect(config.defaultAccess).toBe('always-write')
    expect(config.paths[0]?.access).toBe('always-write')
  })

  it('refuses a conflicting access and legacy scope on one entry', () => {
    expect(() => normalizeConfig({ paths: [{ path: '/x', access: 'read', scope: 'always-write' }] }))
      .toThrow('conflicts with legacy scope')
  })

  it('refuses conflicting defaultAccess and legacy defaultScope', () => {
    expect(() => normalizeConfig({ defaultAccess: 'read', defaultScope: 'write' })).toThrow('conflicts with legacy')
  })

  it('does not hand an entry the shared defaultSurfaces array instance', () => {
    const config = normalizeConfig({ paths: ['/x'] })
    expect(config.paths[0]?.surfaces).not.toBe(config.defaultSurfaces)
    expect(config.paths[0]?.surfaces).toEqual(config.defaultSurfaces)
  })

  it('normalises undefined into the documented empty configuration', () => {
    expect(normalizeConfig(undefined)).toEqual({
      defaultAccess: 'write',
      defaultSurfaces: ['fs', 'shell'],
      paths: [],
    })
  })

  it('trims paths and deduplicates surfaces', () => {
    const config = normalizeConfig({ paths: [{ path: '  /a  ', surfaces: ['fs', 'fs', 'shell'] }] })
    expect(config.paths[0]?.path).toBe('/a')
    expect(config.paths[0]?.surfaces).toEqual(['fs', 'shell'])
  })

  it.each([
    [{ paths: [''] }, 'path must be a non-empty string'],
    [{ paths: [{}] }, 'path must be a non-empty string'],
    [{ paths: ['/a'], defaultAccess: 'rw' }, 'access must be one of'],
    [{ paths: ['/a'], defaultScope: 'rw' }, 'defaultScope: access must be one of'],
    [{ paths: [{ path: '/a', access: 'ro' }] }, 'access must be one of'],
    [{ paths: [{ path: '/a', surfaces: ['net'] }] }, 'unknown surface'],
    [{ paths: [{ path: '/a', surfaces: [] }] }, 'at least one surface'],
    [{ paths: [{ path: '/a', surfaces: 'fs' }] }, 'surfaces must be an array'],
    [{ defaultSurfaces: ['net'] }, 'defaultSurfaces: unknown surface'],
    [{ paths: [{ path: '/a' }], defaultSurfaces: [] }, 'at least one surface'],
    [{ paths: '/a' }, 'paths: expected an array'],
  ])('rejects %j', (raw, message) => {
    expect(() => normalizeConfig(raw as never)).toThrow(message)
  })

  it('names the offending row, not just the reason', () => {
    expect(() => normalizeConfig({ paths: ['/ok', ''] })).toThrow(/^paths\[1\]: .*non-empty/)
  })
})

describe('validateConfig', () => {
  it('accepts a normal section', () => {
    expect(() => validateConfig({ paths: ['~/notes'] })).not.toThrow()
    expect(() => validateConfig({ paths: [{ path: '~/.ssh', access: 'deny' }] })).not.toThrow()
    expect(() => validateConfig({ paths: [{ path: '../shared', access: 'read' }] })).not.toThrow()
  })

  it('rejects duplicate literal entries', () => {
    expect(() => validateConfig({ paths: ['/a', '/a'] })).toThrow('duplicate path entry')
  })

  it('rejects duplicates that differ only by surrounding whitespace or a trailing separator', () => {
    expect(() => validateConfig({ paths: ['/a', ' /a '] })).toThrow('duplicate path entry')
    expect(() => validateConfig({ paths: ['/a', '/a/'] })).toThrow('duplicate path entry')
    expect(() => validateConfig({ paths: ['C:\\a', 'C:\\a\\'] })).toThrow('duplicate path entry')
  })

  it('treats Windows duplications as the same path regardless of case or separator', () => {
    expect(() => validateConfig({ paths: ['C:\\Users\\Me', 'c:/users/me'] })).toThrow('duplicate path entry')
  })

  it('reports the filesystem root rather than the duplicate it also is', () => {
    expect(() => validateConfig({ paths: ['//', '/'] })).toThrow('filesystem root')
  })

  it('accepts an empty configuration (clearing the settings page must save)', () => {
    expect(() => validateConfig({ paths: [] })).not.toThrow()
    expect(() => validateConfig(undefined)).not.toThrow()
  })

  it('admits the spellings only canonicalisation can reject — Task 4 owns that rejection', () => {
    expect(isFilesystemRoot('//')).toBe(false)
    expect(() => validateConfig({ paths: ['//'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['/a/..'] })).not.toThrow()
  })

  it('rejects the filesystem root', () => {
    expect(() => validateConfig({ paths: ['/'] })).toThrow('filesystem root')
  })

  it('rejects a UNC share root, which is as broad as a drive', () => {
    expect(() => validateConfig({ paths: ['\\\\server\\share'] })).toThrow('filesystem root')
    expect(() => validateConfig({ paths: ['\\\\server\\share\\x'] })).not.toThrow()
  })

  it('rejects an ambiguous drive-relative path', () => {
    expect(() => validateConfig({ paths: ['C:foo'] })).toThrow('drive-relative')
  })

  it('accepts a Windows path on a POSIX host: one shared configuration must stay savable', () => {
    expect(() => validateConfig({ paths: ['C:\\Users\\me\\work'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['\\\\server\\share\\proj'] })).not.toThrow()
  })

  it('accepts a bounded pattern and rejects a volume-root or shallow anchor', () => {
    expect(() => validateConfig({ paths: ['~/projects/**/.worktrees/..'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['C:/Users/someone/**/.worktrees/*'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['/**'] })).toThrow('at least two segments')
    expect(() => validateConfig({ paths: ['~/**'] })).toThrow('at least two segments')
    expect(() => validateConfig({ paths: ['C:/**'] })).toThrow()
    expect(() => validateConfig({ paths: ['//server/share/**'] })).toThrow('volume root')
  })

  it('accepts workspace-relative patterns (wildcard-led, literal-prefixed, parent) and final-file patterns', () => {
    expect(() => validateConfig({ paths: ['**/.git'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['*/src'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['../**/.git'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['**/.env'] })).not.toThrow()
    // …but a pure workspace sweep is refused: it names no structure.
    expect(() => validateConfig({ paths: ['**'] })).toThrow('sweep the whole workspace')
    expect(() => validateConfig({ paths: ['**/*'] })).toThrow('sweep the whole workspace')
  })

  it('rejects a pattern with a non-trailing ..', () => {
    expect(() => validateConfig({ paths: ['~/a/**/../b'] })).toThrow("'..' may only appear at the END")
  })

  it('accepts bare names as name rules with every access level', () => {
    // A bare name matches that component at any depth; all four levels stay
    // legal (the docs recommend deny/read, but the validation does not invent a
    // rule the user did not write).
    expect(() => validateConfig({ paths: [{ path: '.git', access: 'deny' }] })).not.toThrow()
    expect(() => validateConfig({ paths: [{ path: '.env', access: 'read' }] })).not.toThrow()
    expect(() => validateConfig({ paths: [{ path: 'node_modules', access: 'write' }] })).not.toThrow()
    expect(() => validateConfig({ paths: [{ path: '.git', access: 'always-write' }] })).not.toThrow()
  })

  it('rejects duplicate name rules, but not a name rule next to a relative path spelling it', () => {
    expect(() => validateConfig({ paths: ['.git', '.git'] })).toThrow('duplicate name rule')
    expect(() => validateConfig({ paths: ['.git', './.git'] })).not.toThrow()
  })

  it('leaves a bare name in the normalised entries as a rule, not a path rewrite', () => {
    expect(normalizeConfig({ paths: [{ path: '.git', access: 'deny' }] }).paths[0])
      .toEqual({ path: '.git', access: 'deny', surfaces: ['fs', 'shell'] })
  })
})

describe('isFilesystemRoot', () => {
  it.each(['/', 'C:\\', 'D:/', 'C:', '\\\\server\\share', '//server/share'])('accepts %s', path => expect(isFilesystemRoot(path)).toBe(true))
  it.each(['/tmp', '~', 'C:\\tmp', '//', '\\\\server\\share\\x'])('rejects %s', path => expect(isFilesystemRoot(path)).toBe(false))
})
