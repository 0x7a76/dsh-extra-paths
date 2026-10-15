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
describe('the plugin Config export', () => {
  it('is the same schema the host reads as entry.fiber.runtime.Config', () => {
    expect(Config).toBe(extraPathsConfigSchema)
  })

  it('marks every field volatile, which is what makes a generated form exist', () => {
    const fields = (schema: unknown): Record<string, { meta?: { volatile?: boolean } }> =>
      (schema as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict
    for (const key of ['defaultScope', 'defaultSurfaces', 'paths']) {
      expect(fields(Config)[key]?.meta?.volatile, `${key} must be volatile on 0.2.x`).toBe(true)
      // The 0.1.5 registration schema stays plain: that service consumes values,
      // not volatile holders, so one schema cannot serve both.
      expect(fields(extraPathsSchema)[key]?.meta?.volatile).not.toBe(true)
    }
  })

  it('resolves the documented defaults through the volatile holders', () => {
    const resolved = Config({}) as unknown as Record<string, { get(): unknown }>
    expect(resolved.defaultScope?.get()).toBe('write')
    expect(resolved.defaultSurfaces?.get()).toEqual(['fs', 'shell'])
    expect(resolved.paths?.get()).toEqual([])
  })
})

describe('readLiveConfig', () => {
  it('unwraps volatile fields into a section the normaliser accepts', () => {
    const resolved = Config({ paths: ['~/projects/**/.worktrees/*'] })
    const section = readLiveConfig(resolved)
    expect(section).toBeDefined()
    expect(normalizeConfig(section).paths).toEqual([
      { path: '~/projects/**/.worktrees/*', scope: 'write', surfaces: ['fs', 'shell'] },
    ])
  })

  it('passes a plain config through unchanged (0.1.5 and hand-written patches)', () => {
    const plain = { defaultScope: 'always-write', paths: ['/data'] }
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
