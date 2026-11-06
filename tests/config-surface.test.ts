import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { Config, readLiveConfig, safeEntryConfig, SETTINGS_NAMESPACE } from '../src/index.js'
import { extraPathsConfigSchema, extraPathsSchema } from '../src/schema.js'

/**
 * The 0.2.x settings surface. 0.2.0 deleted the 0.1.5
 * `ctx.settings.register(ns, schema, …)` API: a plugin's settings ARE its loader
 * entry, its schema is the module-level `Config` export, and the framework's
 * generated form only describes VOLATILE fields (a schema without one yields no
 * descriptor at all — the settings page would simply not exist). These tests pin
 * that surface without needing a running 0.2.x host.
 */

/** The generated field descriptors of one object schema. */
const fields = (schema: unknown): Record<string, { meta?: { volatile?: boolean; default?: unknown } }> =>
  (schema as { dict: Record<string, { meta?: { volatile?: boolean; default?: unknown } }> }).dict

describe('the plugin Config export', () => {
  it('is the same schema the host reads as entry.fiber.runtime.Config', () => {
    expect(Config).toBe(extraPathsConfigSchema)
  })

  it('marks every field volatile, which is what makes a generated form exist', () => {
    for (const key of ['defaultAccess', 'defaultScope', 'defaultSurfaces', 'paths']) {
      expect(fields(Config)[key]?.meta?.volatile, `${key} must be volatile on 0.2.x`).toBe(true)
      // The 0.1.5 registration schema stays plain: that service consumes values,
      // not volatile holders, so one schema cannot serve both.
      expect(fields(extraPathsSchema)[key]?.meta?.volatile).not.toBe(true)
    }
  })

  it('leaves the access aliases WITHOUT a schema default, so a legacy document cannot conflict', () => {
    // The 0.2.x framework materialises schema defaults before the plugin reads the
    // section. A `defaultAccess: write` default would then appear next to a legacy
    // `defaultScope: always-write` and `normalizeConfig` would reject the whole
    // configuration; the documented default lives in the normaliser instead.
    expect(fields(Config).defaultAccess?.meta?.default).toBeUndefined()
    expect(fields(Config).defaultScope?.meta?.default).toBeUndefined()
    expect(fields(Config).defaultSurfaces?.meta?.default).toEqual(['fs', 'shell'])
  })

  it('resolves the documented defaults through the volatile holders', () => {
    const resolved = Config({})
    expect(resolved.defaultSurfaces?.get()).toEqual(['fs', 'shell'])
    expect(resolved.paths?.get()).toEqual([])
    // The access default is reached by the normaliser, not by a schema default.
    expect(normalizeConfig(readLiveConfig(resolved)).defaultAccess).toBe('write')
  })

  it('keeps the new access vocabulary on the resolved section', () => {
    const resolved = Config({
      defaultAccess: 'read',
      defaultSurfaces: ['fs'],
      paths: [{ path: '/x', access: 'deny', surfaces: ['shell'] }],
    })
    expect(normalizeConfig(readLiveConfig(resolved))).toEqual({
      defaultAccess: 'read',
      defaultSurfaces: ['fs'],
      paths: [{ path: '/x', access: 'deny', surfaces: ['shell'] }],
    })
  })

  it('keeps accepting the legacy defaultScope / scope spellings', () => {
    // One document shape from 0.2.x must stay readable: only the legacy spelling
    // is present, so nothing materialises a conflicting defaultAccess.
    const resolved = Config({ defaultScope: 'always-write', paths: [{ path: '/x', scope: 'write', surfaces: ['fs'] }] })
    expect(normalizeConfig(readLiveConfig(resolved))).toEqual({
      defaultAccess: 'always-write',
      defaultSurfaces: ['fs', 'shell'],
      paths: [{ path: '/x', access: 'write', surfaces: ['fs'] }],
    })
  })

  it('accepts both spellings on the 0.1.5 plain schema too', () => {
    const section = extraPathsSchema({
      defaultScope: 'always-write',
      paths: [{ path: '/x', access: 'read', surfaces: ['fs'] }],
    })
    expect(normalizeConfig(section)).toMatchObject({
      defaultAccess: 'always-write',
      paths: [{ path: '/x', access: 'read', surfaces: ['fs'] }],
    })
    expect(normalizeConfig(extraPathsSchema({ defaultAccess: 'deny', paths: ['/y'] }))).toMatchObject({
      defaultAccess: 'deny',
      paths: [{ path: '/y', access: 'deny' }],
    })
  })
})

describe('readLiveConfig', () => {
  it('unwraps volatile fields into a section the normaliser accepts', () => {
    const resolved = Config({ paths: ['~/projects/**/.worktrees/*'] })
    const section = readLiveConfig(resolved)
    expect(section).toBeDefined()
    expect(normalizeConfig(section).paths).toEqual([
      { path: '~/projects/**/.worktrees/*', access: 'write', surfaces: ['fs', 'shell'] },
    ])
  })

  it('passes a plain config through unchanged (0.1.5 and hand-written patches)', () => {
    const plain = { defaultAccess: 'read', defaultScope: 'always-write', paths: ['/data'] }
    expect(readLiveConfig(plain)).toEqual(plain)
    expect(readLiveConfig(undefined)).toBeUndefined()
    expect(readLiveConfig(null)).toBeUndefined()
  })

  it('reads again on every call, so an edit applies without a restart', () => {
    // A stable holder whose value the framework may replace: only a reader that
    // calls get() per decision sees the new value.
    let value = ['/one']
    const holder = { get: () => value }
    expect(normalizeConfig(readLiveConfig({ paths: holder })).paths[0]?.path).toBe('/one')
    value = ['/two']
    expect(normalizeConfig(readLiveConfig({ paths: holder })).paths[0]?.path).toBe('/two')
  })

  it('keeps the namespace the client page binds to', () => {
    expect(SETTINGS_NAMESPACE).toBe('extra-paths')
  })
})

describe('safeEntryConfig', () => {
  it('degrades a rejected entry config to the empty section and warns once', () => {
    const warnings: string[] = []
    const config = safeEntryConfig({ paths: [42] } as never, message => warnings.push(message))
    expect(config.paths).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('entry config rejected')
  })
})
