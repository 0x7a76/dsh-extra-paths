import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeConfig, type Surface } from '../src/config.js'
import { resolveRoots } from '../src/resolve.js'

// realpath the fixture: on darwin tmpdir() is /var/... while canonical spellings
// are /private/var/..., and resolveRoots is SUPPOSED to return the latter.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
mkdirSync(join(base, 'notes'))

describe('resolveRoots', () => {
  it('resolves a relative entry against the session workspace', () => {
    const config = normalizeConfig({ paths: ['notes'] })
    const report = resolveRoots(config, base)
    expect(report.roots.map(root => root.root)).toEqual([join(base, 'notes')])
    expect(report.entries[0]).toMatchObject({ status: 'ok' })
  })

  it('marks a missing root inactive and warns once', () => {
    const config = normalizeConfig({ paths: ['nope'] })
    const report = resolveRoots(config, base)
    expect(report.roots).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'missing' })
    expect(report.warnings).toHaveLength(1)
  })

  it('rejects a filesystem-root spelling', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['/'] }), base)
    expect(report.roots).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'rejected' })
  })

  it('rejects spellings that only canonicalisation exposes as the filesystem root', () => {
    expect(resolveRoots(normalizeConfig({ paths: ['//'] }), base).entries[0]).toMatchObject({ status: 'rejected' })
    expect(resolveRoots(normalizeConfig({ paths: ['/a/..'] }), base).entries[0]).toMatchObject({ status: 'rejected' })
  })

  it('merges spellings that canonicalise to the same root', () => {
    const config = normalizeConfig({ paths: [
      { path: `${base}//notes`, scope: 'write', surfaces: ['fs'] },
      { path: join(base, 'notes'), scope: 'write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]?.root).toBe(join(base, 'notes'))
  })

  it('merges duplicate roots taking the widest scope and the union of surfaces', () => {
    const config = normalizeConfig({ paths: [
      { path: 'notes', scope: 'write', surfaces: ['fs'] },
      { path: join(base, 'notes'), scope: 'always-write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ scope: 'always-write', surfaces: ['fs', 'shell'] })
  })

  it('warns when a root is the home directory itself', () => {
    const report = resolveRoots(normalizeConfig({ paths: [homedir()] }), base)
    expect(report.warnings.join('\n')).toContain('entire home directory')
  })

  it('warns when a root CONTAINS the home directory (~/.. must not pass unwarned)', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['~/..'] }), base)
    expect(report.warnings.join('\n')).toContain('entire home directory')
  })

  it('keeps entries in configured order for the preview', () => {
    const config = normalizeConfig({ paths: ['notes', 'nope'] })
    const report = resolveRoots(config, base)
    expect(report.entries.map(entry => entry.status)).toEqual(['ok', 'missing'])
  })

  it('keeps a single configured surface instead of widening it', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: 'notes', surfaces: ['fs'] }] }), base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]?.surfaces).toEqual(['fs'])
  })

  it('reports each entry with its canonical path, scope and surfaces', () => {
    const config = normalizeConfig({ paths: [{ path: 'notes', scope: 'always-write', surfaces: ['shell'] }] })
    expect(resolveRoots(config, base).entries[0]).toEqual({
      raw: 'notes',
      resolved: join(base, 'notes'),
      scope: 'always-write',
      surfaces: ['shell'],
      status: 'ok',
    })
  })

  it('keeps the first spelling as the merged root provenance', () => {
    const config = normalizeConfig({ paths: [
      { path: `${base}//notes`, scope: 'write', surfaces: ['fs'] },
      { path: join(base, 'notes'), scope: 'write', surfaces: ['shell'] },
    ] })
    expect(resolveRoots(config, base).roots[0]?.raw).toBe(`${base}//notes`)
  })

  it('warns once for a repeated inactive entry', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['nope', 'nope'] }), base)
    expect(report.entries.map(entry => entry.status)).toEqual(['missing', 'missing'])
    expect(report.warnings).toHaveLength(1)
  })

  it('collapses a symlinked spelling into the real root', () => {
    const link = join(base, 'link-to-notes')
    if (!existsSync(link)) symlinkSync(join(base, 'notes'), link)
    const config = normalizeConfig({ paths: [
      { path: 'link-to-notes', scope: 'write', surfaces: ['fs'] },
      { path: 'notes', scope: 'write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ root: join(base, 'notes'), surfaces: ['fs', 'shell'] })
  })

  it('contributes nothing for an inactive entry on any surface', () => {
    const config = normalizeConfig({ paths: [
      { path: 'nope', surfaces: ['shell'] },
      { path: 'notes', surfaces: ['fs'] },
    ] })
    expect(resolveRoots(config, base).roots.map(root => root.surfaces)).toEqual([['fs']])
  })

  it('returns an empty report for an empty configuration', () => {
    expect(resolveRoots(normalizeConfig(undefined), base)).toEqual({ roots: [], entries: [], warnings: [] })
  })

  it('does not alias the caller config through the per-entry report', () => {
    const config = normalizeConfig({ paths: [{ path: 'notes', surfaces: ['fs'] }] })
    const report = resolveRoots(config, base)
    expect(report.entries[0]?.surfaces).not.toBe(config.paths[0]?.surfaces)
    // Deliberate mutation through a report: the cast records that the point of
    // this test is that the array is a private copy, not the config's.
    ;(report.entries[0]?.surfaces as Surface[]).push('shell')
    expect(config.paths[0]?.surfaces).toEqual(['fs'])
    expect(resolveRoots(config, base).roots[0]?.surfaces).toEqual(['fs'])
  })

  it('reports surfaces in a stable order regardless of config order', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: 'notes', surfaces: ['shell', 'fs'] }] }), base)
    expect(report.roots[0]?.surfaces).toEqual(['fs', 'shell'])
  })

  it('keeps a nested child as its own root and lets the wider ancestor grant it', () => {
    mkdirSync(join(base, 'notes', 'sub'), { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: 'notes', scope: 'write', surfaces: ['fs', 'shell'] },
      { path: 'notes/sub', scope: 'write', surfaces: ['fs'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots.map(root => root.root)).toEqual([join(base, 'notes'), join(base, 'notes', 'sub')])
  })

  it('warns when a root contains the session workspace', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['..'] }), base)
    expect(report.warnings.join('\n')).toContain("contains this session's workspace")
  })

  it('warns about nothing for a benign active root', () => {
    expect(resolveRoots(normalizeConfig({ paths: ['notes'] }), base).warnings).toEqual([])
  })

  it('names both the spelling and the resolved path when an entry is inactive', () => {
    const warning = resolveRoots(normalizeConfig({ paths: ['nope'] }), base).warnings[0] ?? ''
    expect(warning).toContain('"nope"')
    expect(warning).toContain(join(base, 'nope'))
  })

  it('does not leak roots across passes', () => {
    const first = resolveRoots(normalizeConfig({ paths: ['notes'] }), base)
    const second = resolveRoots(normalizeConfig(undefined), base)
    expect(first.roots).toHaveLength(1)
    expect(second.roots).toEqual([])
  })
})
