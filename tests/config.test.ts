import { describe, expect, it } from 'vitest'
import { isFilesystemRoot, normalizeConfig, validateConfig } from '../src/config.js'

describe('normalizeConfig', () => {
  it('applies the plugin-level defaults', () => {
    const config = normalizeConfig({ paths: ['~/notes'] })
    expect(config.paths).toEqual([{ path: '~/notes', scope: 'write', surfaces: ['fs', 'shell'] }])
    expect(config.defaultScope).toBe('write')
  })

  it('lets one entry override scope and surfaces', () => {
    const config = normalizeConfig({
      defaultSurfaces: ['fs'],
      paths: [{ path: '/tmp/x', scope: 'always-write', surfaces: ['shell'] }],
    })
    expect(config.paths[0]).toEqual({ path: '/tmp/x', scope: 'always-write', surfaces: ['shell'] })
  })

  it('lets the plugin-level defaultScope reach an entry that omits its own', () => {
    const config = normalizeConfig({ defaultScope: 'always-write', paths: ['/x'] })
    expect(config.paths[0]?.scope).toBe('always-write')
  })

  it('does not hand an entry the shared defaultSurfaces array instance', () => {
    const config = normalizeConfig({ paths: ['/x'] })
    expect(config.paths[0]?.surfaces).not.toBe(config.defaultSurfaces)
    expect(config.paths[0]?.surfaces).toEqual(config.defaultSurfaces)
  })

  it('normalises undefined into the documented empty configuration', () => {
    expect(normalizeConfig(undefined)).toEqual({
      defaultScope: 'write',
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
    [{ paths: ['/a'], defaultScope: 'rw' }, 'scope must be one of'],
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
  })

  it('rejects duplicate literal entries', () => {
    expect(() => validateConfig({ paths: ['/a', '/a'] })).toThrow('duplicate path entry')
  })

  it('rejects duplicates that differ only by surrounding whitespace or a trailing separator', () => {
    expect(() => validateConfig({ paths: ['/a', ' /a '] })).toThrow('duplicate path entry')
    expect(() => validateConfig({ paths: ['/a', '/a/'] })).toThrow('duplicate path entry')
    expect(() => validateConfig({ paths: ['C:\\a', 'C:\\a\\'] })).toThrow('duplicate path entry')
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
})

describe('isFilesystemRoot', () => {
  it.each(['/', 'C:\\', 'D:/', 'C:'])('accepts %s', path => expect(isFilesystemRoot(path)).toBe(true))
  it.each(['/tmp', '~', 'C:\\tmp'])('rejects %s', path => expect(isFilesystemRoot(path)).toBe(false))
})
