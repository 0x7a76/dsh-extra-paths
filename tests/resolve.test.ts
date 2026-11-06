import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConfig, type Surface } from '../src/config.js'
import { NAME_RULE_LIMITS } from '../src/name-rule.js'
import type { PlatformFacts } from '../src/paths.js'
import { clearNameRuleCache, clearPatternCache, nameScopeRoots, resolveRoots } from '../src/resolve.js'

/**
 * A seam over the ONE bounded walk a resolution can trigger. Counting starts is
 * how "the fs hot path never walks" is pinned without timing: the count must
 * stay 0 unless `expandNameRules` is requested. `override` scripts a degraded
 * verdict, so the cap warning is cheap to test (a real >256-match fixture
 * would otherwise be needed just to read one message).
 */
const walkSeam = vi.hoisted(() => ({
  walks: 0,
  override: undefined as undefined | {
    readonly matches: readonly string[]
    readonly capped: boolean
    readonly cap?: 'directories' | 'matches'
    readonly truncated: boolean
    readonly incompleteRoots: readonly string[]
    readonly skippedSymlinks: number
    readonly scanned: number
    readonly complete: boolean
  },
}))

vi.mock('../src/name-rule.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/name-rule.js')>()
  return {
    ...actual,
    expandNameMatches: (name: string, scopeRoots: readonly string[], facts: PlatformFacts) => {
      walkSeam.walks += 1
      return walkSeam.override ?? actual.expandNameMatches(name, scopeRoots, facts)
    },
  }
})

// realpath the fixture: on darwin tmpdir() is /var/... while canonical spellings
// are /private/var/..., and resolveRoots is SUPPOSED to return the latter.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
mkdirSync(join(base, './notes'))
mkdirSync(join(base, './secrets'))
// A translation fixture: a WSL mount root that really exists, holding drive C:.
const wslMount = join(base, 'mnt')
mkdirSync(join(wslMount, 'c', './notes'), { recursive: true })

/** The host dialect of this machine; the lexical half must not depend on it. */
const posix: PlatformFacts = { platform: 'darwin', wsl: false, wslMountRoot: '/mnt', home: homedir() }
/** A WSL host whose Windows drives live under the fixture (so paths can exist). */
const wsl: PlatformFacts = { platform: 'linux', wsl: true, wslMountRoot: wslMount, home: homedir() }

/** Resolve configured rows against the fixture workspace with deterministic facts. */
function rootsOf(paths: readonly unknown[], facts: PlatformFacts = posix) {
  return resolveRoots(normalizeConfig({ paths }), base, facts)
}

describe('resolveRoots', () => {
  it('resolves a relative entry against the session workspace', () => {
    const config = normalizeConfig({ paths: ['./notes'] })
    const report = resolveRoots(config, base)
    expect(report.roots.map(root => root.root)).toEqual([join(base, './notes')])
    expect(report.entries[0]).toMatchObject({ status: 'ok' })
  })

  it('marks a missing root inactive and warns once', () => {
    const config = normalizeConfig({ paths: ['./nope'] })
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
      { path: join(base, './notes'), scope: 'write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]?.root).toBe(join(base, './notes'))
  })

  it('merges duplicate roots taking the widest scope and the union of surfaces', () => {
    // The legacy write/always-write document must keep its old report: one root,
    // widest scope, union of surfaces (0.3.0 only adds the read/deny levels).
    const config = normalizeConfig({ paths: [
      { path: './notes', scope: 'write', surfaces: ['fs'] },
      { path: join(base, './notes'), scope: 'always-write', surfaces: ['shell'] },
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
    const config = normalizeConfig({ paths: ['./notes', './nope'] })
    const report = resolveRoots(config, base)
    expect(report.entries.map(entry => entry.status)).toEqual(['ok', 'missing'])
  })

  it('keeps a single configured surface instead of widening it', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: './notes', surfaces: ['fs'] }] }), base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]?.surfaces).toEqual(['fs'])
  })

  it('reports each entry with its canonical path, access and surfaces', () => {
    const config = normalizeConfig({ paths: [{ path: './notes', scope: 'always-write', surfaces: ['shell'] }] })
    expect(resolveRoots(config, base).entries[0]).toEqual({
      raw: './notes',
      resolved: join(base, './notes'),
      access: 'always-write',
      surfaces: ['shell'],
      status: 'ok',
    })
  })

  it('keeps the first spelling as the merged root provenance', () => {
    const config = normalizeConfig({ paths: [
      { path: `${base}//notes`, scope: 'write', surfaces: ['fs'] },
      { path: join(base, './notes'), scope: 'write', surfaces: ['shell'] },
    ] })
    expect(resolveRoots(config, base).roots[0]?.raw).toBe(`${base}//notes`)
  })

  it('warns once for a repeated inactive entry', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['./nope', './nope'] }), base)
    expect(report.entries.map(entry => entry.status)).toEqual(['missing', 'missing'])
    expect(report.warnings).toHaveLength(1)
  })

  it('collapses a symlinked spelling into the real root', () => {
    const link = join(base, './link-to-notes')
    if (!existsSync(link)) symlinkSync(join(base, './notes'), link)
    const config = normalizeConfig({ paths: [
      { path: './link-to-notes', scope: 'write', surfaces: ['fs'] },
      { path: './notes', scope: 'write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ root: join(base, './notes'), surfaces: ['fs', 'shell'] })
  })

  it('contributes nothing for an inactive entry on any surface', () => {
    const config = normalizeConfig({ paths: [
      { path: './nope', surfaces: ['shell'] },
      { path: './notes', surfaces: ['fs'] },
    ] })
    expect(resolveRoots(config, base).roots.map(root => root.surfaces)).toEqual([['fs']])
  })

  it('returns an empty report for an empty configuration', () => {
    expect(resolveRoots(normalizeConfig(undefined), base)).toEqual({
      roots: [],
      readOnly: [],
      denied: [],
      entries: [],
      nameRules: [],
      nameMatches: [],
      warnings: [],
    })
  })

  it('does not alias the caller config through the per-entry report', () => {
    const config = normalizeConfig({ paths: [{ path: './notes', surfaces: ['fs'] }] })
    const report = resolveRoots(config, base)
    expect(report.entries[0]?.surfaces).not.toBe(config.paths[0]?.surfaces)
    // Deliberate mutation through a report: the cast records that the point of
    // this test is that the array is a private copy, not the config's.
    ;(report.entries[0]?.surfaces as Surface[]).push('shell')
    expect(config.paths[0]?.surfaces).toEqual(['fs'])
    expect(resolveRoots(config, base).roots[0]?.surfaces).toEqual(['fs'])
  })

  it('reports surfaces in a stable order regardless of config order', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: './notes', surfaces: ['shell', 'fs'] }] }), base)
    expect(report.roots[0]?.surfaces).toEqual(['fs', 'shell'])
  })

  it('keeps a nested child as its own root and lets the wider ancestor grant it', () => {
    mkdirSync(join(base, './notes', 'sub'), { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: './notes', scope: 'write', surfaces: ['fs', 'shell'] },
      { path: 'notes/sub', scope: 'write', surfaces: ['fs'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots.map(root => root.root)).toEqual([join(base, './notes'), join(base, './notes', 'sub')])
  })

  it('warns when a root contains the session workspace', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['..'] }), base)
    expect(report.warnings.join('\n')).toContain("contains this session's workspace")
  })

  it('warns about nothing for a benign active root', () => {
    expect(resolveRoots(normalizeConfig({ paths: ['./notes'] }), base).warnings).toEqual([])
  })

  it('names both the spelling and the resolved path when an entry is inactive', () => {
    const warning = resolveRoots(normalizeConfig({ paths: ['./nope'] }), base).warnings[0] ?? ''
    expect(warning).toContain('"./nope"')
    expect(warning).toContain(join(base, './nope'))
  })

  it('does not leak roots across passes', () => {
    const first = resolveRoots(normalizeConfig({ paths: ['./notes'] }), base)
    const second = resolveRoots(normalizeConfig(undefined), base)
    expect(first.roots).toHaveLength(1)
    expect(second.roots).toEqual([])
  })
})

describe('resolveRoots access levels', () => {
  it('reports a read-only entry as a read rule and grants nothing', () => {
    const report = rootsOf([{ path: './notes', access: 'read' }])
    expect(report.roots).toEqual([])
    expect(report.readOnly).toEqual([
      { raw: './notes', root: join(base, './notes'), access: 'read', surfaces: ['fs', 'shell'] },
    ])
    expect(report.denied).toEqual([])
    expect(report.entries[0]).toMatchObject({ access: 'read', status: 'ok' })
  })

  it('reports a denied entry as a deny rule and grants nothing', () => {
    const report = rootsOf([{ path: './secrets', access: 'deny' }])
    expect(report.roots).toEqual([])
    expect(report.readOnly).toEqual([])
    expect(report.denied).toEqual([
      { raw: './secrets', root: join(base, './secrets'), access: 'deny', surfaces: ['fs', 'shell'] },
    ])
  })

  it('lets deny/read subtract from the writable surfaces of one root', () => {
    // Same canonical root: fs may write, the shell may only read it.
    const report = rootsOf([
      { path: './notes', access: 'write', surfaces: ['fs'] },
      { path: join(base, './notes'), access: 'read', surfaces: ['shell'] },
    ])
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ root: join(base, './notes'), scope: 'write', surfaces: ['fs'] })
    expect(report.readOnly).toHaveLength(1)
    expect(report.readOnly[0]).toMatchObject({ root: join(base, './notes'), access: 'read', surfaces: ['shell'] })
    expect(report.denied).toEqual([])
  })

  it('lets a deny rule on one surface keep the other surface writable', () => {
    const report = rootsOf([
      { path: './notes', access: 'deny', surfaces: ['fs'] },
      { path: './notes', access: 'write', surfaces: ['shell'] },
    ])
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ scope: 'write', surfaces: ['shell'] })
    expect(report.denied).toHaveLength(1)
    expect(report.denied[0]).toMatchObject({ access: 'deny', surfaces: ['fs'] })
    expect(report.readOnly).toEqual([])
  })

  it('applies deny > read > write on one surface', () => {
    expect(rootsOf([
      { path: './notes', access: 'write', surfaces: ['fs'] },
      { path: './notes', access: 'read', surfaces: ['fs'] },
    ])).toMatchObject({
      roots: [],
      readOnly: [{ access: 'read', surfaces: ['fs'] }],
      denied: [],
    })
    expect(rootsOf([
      { path: './notes', access: 'write', surfaces: ['fs'] },
      { path: './notes', access: 'read', surfaces: ['fs'] },
      { path: './notes', access: 'deny', surfaces: ['fs'] },
    ])).toMatchObject({
      roots: [],
      readOnly: [],
      denied: [{ access: 'deny', surfaces: ['fs'] }],
    })
  })

  it('merges write and always-write to the wider always-write', () => {
    const report = rootsOf([
      { path: './notes', access: 'write', surfaces: ['fs'] },
      { path: './notes', access: 'always-write', surfaces: ['fs', 'shell'] },
    ])
    expect(report.roots).toHaveLength(1)
    // Widest scope across the writable surfaces, exactly like the legacy report.
    expect(report.roots[0]).toMatchObject({ scope: 'always-write', surfaces: ['fs', 'shell'] })
  })

  it('keeps a read-only entry inactive while its path does not exist', () => {
    const report = rootsOf([{ path: './not-yet', access: 'read' }])
    expect(report.entries[0]).toMatchObject({ status: 'missing', access: 'read' })
    expect(report.readOnly).toEqual([])
    expect(report.denied).toEqual([])
    expect(report.warnings.join('\n')).toContain('does not exist')
  })

  it('keeps a nested read-only rule next to the writable ancestor it narrows', () => {
    mkdirSync(join(base, './notes', 'drafts'), { recursive: true })
    const report = rootsOf([
      { path: './notes', access: 'write' },
      { path: 'notes/drafts', access: 'read' },
    ])
    // The report is per canonical root, not per containment: a nested rule is
    // its OWN entry, and it is the enforcement layer's job to apply the stricter
    // rule to a target under the narrower path.
    expect(report.roots.map(root => root.root)).toEqual([join(base, './notes')])
    expect(report.readOnly.map(rule => rule.root)).toEqual([join(base, './notes', 'drafts')])
  })

  it('reports a denied subdirectory even when an ancestor is writable', () => {
    mkdirSync(join(base, './notes', 'private'), { recursive: true })
    const report = rootsOf([
      { path: './notes', access: 'write' },
      { path: 'notes/private', access: 'deny' },
    ])
    expect(report.roots.map(root => root.root)).toEqual([join(base, './notes')])
    expect(report.denied.map(rule => rule.root)).toEqual([join(base, './notes', 'private')])
  })

  it('merges the surfaces of repeated rules with the same level', () => {
    const report = rootsOf([
      { path: './notes', access: 'read', surfaces: ['fs'] },
      { path: join(base, './notes'), access: 'read', surfaces: ['shell'] },
    ])
    expect(report.readOnly).toEqual([
      { raw: './notes', root: join(base, './notes'), access: 'read', surfaces: ['fs', 'shell'] },
    ])
  })

  it('rejects a translated volume root after translation (WSL drive root)', () => {
    // `C:\` is `/mnt/<root>/c` inside WSL: the literal-root rejection must run on
    // the canonical host spelling, not on the configured one.
    const report = rootsOf(['C:\\'], wsl)
    expect(report.roots).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'rejected' })
  })

  it('resolves a translated Windows spelling through the real filesystem', () => {
    // The translation is only trusted once the canonical path EXISTS: this is what
    // makes one configuration usable on Windows and in WSL.
    const report = rootsOf(['C:\\notes'], wsl)
    expect(report.roots.map(root => root.root)).toEqual([realpathSync.native(join(wslMount, 'c', './notes'))])
    expect(report.entries[0]).toMatchObject({ status: 'ok', access: 'write' })
  })
})

describe('resolveRoots foreign entries', () => {
  it('keeps a Windows spelling inactive on a POSIX host with one informative warning', () => {
    const report = rootsOf(['C:\\Users\\someone\\work'])
    expect(report.roots).toEqual([])
    expect(report.readOnly).toEqual([])
    expect(report.denied).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'foreign' })
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain('not applicable on this host')
    expect(report.warnings[0]).toContain('stays inactive')
  })

  it('reports a foreign pattern as foreign instead of as an unwalkable anchor', () => {
    clearPatternCache()
    const report = rootsOf(['C:\\work\\**\\notes'])
    expect(report.roots).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'foreign', resolved: '' })
    expect(report.warnings.join('\n')).toContain('not applicable on this host')
  })

  it('warns once for a repeated foreign spelling', () => {
    const report = rootsOf(['C:\\Users\\someone\\a', 'C:\\Users\\someone\\a'])
    expect(report.entries.map(entry => entry.status)).toEqual(['foreign', 'foreign'])
    expect(report.warnings).toHaveLength(1)
  })

  it('does not let one foreign entry disable the rest of the configuration', () => {
    const report = rootsOf(['C:\\Users\\someone\\work', './notes'])
    expect(report.roots.map(root => root.root)).toEqual([join(base, './notes')])
    expect(report.entries.map(entry => entry.status)).toEqual(['foreign', 'ok'])
  })

  it('treats a Windows home spelling as foreign without a Windows host', () => {
    const report = rootsOf(['~\\notes'])
    expect(report.entries[0]).toMatchObject({ status: 'foreign' })
    expect(report.warnings[0]).toContain('Windows home spelling')
  })
})

describe('resolveRoots name rules (bare names)', () => {
  beforeEach(() => {
    clearNameRuleCache()
    walkSeam.walks = 0
    walkSeam.override = undefined
  })

  it('reports every bare name as a rule, in configured order, for all access levels', () => {
    const report = rootsOf([
      { path: '.git', access: 'deny' },
      { path: '.env', access: 'read', surfaces: ['fs'] },
      { path: 'node_modules', access: 'always-write', surfaces: ['shell'] },
    ])
    expect(report.nameRules).toEqual([
      { raw: '.git', name: '.git', access: 'deny', surfaces: ['fs', 'shell'] },
      { raw: '.env', name: '.env', access: 'read', surfaces: ['fs'] },
      { raw: 'node_modules', name: 'node_modules', access: 'always-write', surfaces: ['shell'] },
    ])
    // A name rule is not a concrete path, so the concrete rule arrays stay empty;
    // the shell/preview merge matches themselves (by access level).
    expect(report.roots).toEqual([])
    expect(report.readOnly).toEqual([])
    expect(report.denied).toEqual([])
    expect(report.nameMatches).toEqual([])
    // …and a plain resolution costs no walk at all.
    expect(walkSeam.walks).toBe(0)
  })

  it('reports a bare-name entry as one live entry with no resolved path', () => {
    const report = rootsOf([{ path: '.git', access: 'deny' }])
    expect(report.entries).toEqual([
      { raw: '.git', resolved: '', access: 'deny', surfaces: ['fs', 'shell'], status: 'ok' },
    ])
    // No existence probe, hence no missing/home/workspace warnings for a name
    // rule — the fs surface matches it live, whatever the walk currently sees.
    expect(report.warnings).toEqual([])
    expect(report.entries[0]).not.toHaveProperty('matches')
  })

  it('keeps the ./name escape hatch a literal path, not a name rule', () => {
    const report = rootsOf(['./notes'])
    expect(report.nameRules).toEqual([])
    expect(report.roots.map(root => root.root)).toEqual([join(base, './notes')])
  })

  it('keeps the configured order across literal, name and inactive entries', () => {
    const report = rootsOf(['./notes', '.env', './nope', '.git'])
    expect(report.entries.map(entry => [entry.raw, entry.status])).toEqual([
      ['./notes', 'ok'],
      ['.env', 'ok'],
      ['./nope', 'missing'],
      ['.git', 'ok'],
    ])
    expect(report.nameRules.map(rule => rule.raw)).toEqual(['.env', '.git'])
  })

  it('deduplicates a repeated bare name to one rule', () => {
    // The settings gate refuses duplicate bare names; a synthesized document can
    // still carry them, and it must produce ONE rule (and one walk), not two.
    const report = rootsOf(['.git', '.git'])
    expect(report.nameRules).toHaveLength(1)
    expect(report.entries).toHaveLength(2)
  })

  it('enumerates one match per concrete path only when expansion is requested', () => {
    const repo = join(base, 'name-repo')
    mkdirSync(join(repo, '.git', 'objects'), { recursive: true })

    const plain = rootsOf(['.git'])
    expect(walkSeam.walks).toBe(0)
    expect(plain.nameMatches).toEqual([])

    const expanded = resolveRoots(normalizeConfig({ paths: ['.git'] }), base, posix, { expandNameRules: true })
    expect(walkSeam.walks).toBe(1)
    expect(expanded.nameMatches.map(match => match.root)).toEqual([join(repo, '.git')])
    // The match points AT the rule object the report publishes, so a consumer
    // can read `match.rule.access` without re-resolving by spelling.
    expect(expanded.nameMatches[0]?.rule).toBe(expanded.nameRules[0])
    expect(expanded.entries[0]).toMatchObject({ raw: '.git', status: 'ok', matches: 1 })
    // Concrete matches are NOT folded into the concrete rule arrays: the shell
    // surface adds them itself (by access level), and the preview merges them.
    expect(expanded.denied).toEqual([])
  })

  it('scopes a name rule to the workspace plus the configured writable roots', () => {
    const extra = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-extra-')))
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-outside-')))
    const name = '.name-scope'
    mkdirSync(join(base, name))
    mkdirSync(join(extra, name))
    mkdirSync(join(outside, name))
    const config = normalizeConfig({ paths: [
      { path: extra, access: 'write' },
      { path: name, access: 'deny' },
    ] })
    const report = resolveRoots(config, base, posix, { expandNameRules: true })
    expect(report.nameMatches.map(match => match.root)).toEqual([join(base, name), join(extra, name)].sort())
    // A directory outside every scope root is not enumerated…
    expect(report.nameMatches.map(match => match.root)).not.toContain(join(outside, name))
    // …and a denied name rule still stays out of the concrete arrays.
    expect(report.denied).toEqual([])
  })

  it('counts zero matches as still-ok and still-live', () => {
    const report = rootsOf(['.name-never-appears'])
    const expanded = resolveRoots(normalizeConfig({ paths: ['.name-never-appears'] }), base, posix, {
      expandNameRules: true,
    })
    expect(report.nameRules).toHaveLength(1)
    expect(expanded.nameMatches).toEqual([])
    // A directory created a moment later must start matching with no new save:
    // the fs surface never needed the walk in the first place.
    expect(expanded.entries[0]).toMatchObject({ status: 'ok', matches: 0 })
    expect(expanded.warnings).toEqual([])
  })

  it('reuses a walk within the TTL and drops it on demand', () => {
    const name = '.name-cache'
    mkdirSync(join(base, name))
    const config = normalizeConfig({ paths: [name] })
    expect(resolveRoots(config, base, posix, { expandNameRules: true }).nameMatches).toHaveLength(1)
    expect(walkSeam.walks).toBe(1)

    mkdirSync(join(base, 'name-cache-sub', name), { recursive: true })
    // Cached: a directory that appeared a moment ago is not enumerated yet.
    expect(resolveRoots(config, base, posix, { expandNameRules: true }).nameMatches).toHaveLength(1)
    expect(walkSeam.walks).toBe(1)

    clearNameRuleCache()
    expect(resolveRoots(config, base, posix, { expandNameRules: true }).nameMatches).toHaveLength(2)
    expect(walkSeam.walks).toBe(2)

    // `clearPatternCache` is the one "forget the walk caches" hook for tests.
    clearPatternCache()
    expect(resolveRoots(config, base, posix, { expandNameRules: true }).nameMatches).toHaveLength(2)
    expect(walkSeam.walks).toBe(3)
  })

  it('keeps the matches it found and warns when the walk is truncated (partial coverage)', () => {
    const name = '.name-deep'
    // A shallow match PLUS a tree deeper than the walk's bound. The earlier
    // fail-closed version dropped the shallow match too, which in the real host
    // meant one deep writable root disabled shell protection in the workspace.
    const shallow = join(base, 'shallow-deep', name)
    mkdirSync(shallow, { recursive: true })
    const deep = join(
      base,
      'name-deep-root',
      ...Array.from({ length: NAME_RULE_LIMITS.maxDepth + 1 }, (_, index) => `d${index}`),
      name,
    )
    mkdirSync(deep, { recursive: true })
    const expanded = resolveRoots(normalizeConfig({ paths: [{ path: name, access: 'deny' }] }), base, posix, {
      expandNameRules: true,
    })
    expect(expanded.nameMatches.map(match => match.root)).toEqual([shallow])
    expect(expanded.entries[0]).toMatchObject({ status: 'ok', matches: 1 })
    expect(expanded.warnings).toHaveLength(1)
    const warning = expanded.warnings[0] ?? ''
    expect(warning).toContain(`name rule ${JSON.stringify(name)}`)
    expect(warning).toContain('match count is partial')
    expect(warning).toContain('depth limit')
    // The partial state is honest AND still protective: found paths stay denied.
    expect(warning).toContain('match count is partial')
    expect(warning).toContain('the 1 match(es) found still apply to the fs tools')
    expect(warning).toContain('were not scanned')
  })

  it('skips symlink matches and warns instead of claiming partial coverage', () => {
    const name = '.name-link'
    symlinkSync(join(base, 'notes'), join(base, name))
    const expanded = resolveRoots(normalizeConfig({ paths: [name] }), base, posix, { expandNameRules: true })
    expect(expanded.nameMatches).toEqual([])
    expect(expanded.warnings).toHaveLength(1)
    expect(expanded.warnings[0]).toContain('symbolic links')
    expect(expanded.entries[0]).toMatchObject({ matches: 0, status: 'ok' })
  })

  it('warns about a cap with the rule spelling and the cap reason', () => {
    walkSeam.override = {
      matches: [],
      capped: true,
      cap: 'matches',
      truncated: false,
      incompleteRoots: [base],
      skippedSymlinks: 0,
      scanned: 1,
      complete: false,
    }
    try {
      const expanded = resolveRoots(normalizeConfig({ paths: ['.name-capped'] }), base, posix, {
        expandNameRules: true,
      })
      expect(expanded.nameMatches).toEqual([])
      expect(expanded.entries[0]).toMatchObject({ matches: 0 })
      expect(expanded.warnings[0]).toContain(`more than ${NAME_RULE_LIMITS.maxMatches} paths`)
    } finally {
      walkSeam.override = undefined
      clearNameRuleCache()
    }
  })

  it('exposes the same walk scope the expansion used', () => {
    const extra = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-extra-')))
    mkdirSync(join(extra, 'nested'))
    const config = normalizeConfig({ paths: [extra, join(extra, 'nested')] })
    const report = resolveRoots(config, base, posix)
    // Workspace first, then the writable roots in report order; the nested root
    // is dropped because the outer walk already covers it.
    expect(nameScopeRoots(report, base, posix)).toEqual([base, extra])
  })

  it('does not alias the config surface array into a name rule', () => {
    const config = normalizeConfig({ paths: [{ path: '.git', surfaces: ['fs'] }] })
    const report = resolveRoots(config, base, posix)
    expect(report.nameRules[0]?.surfaces).not.toBe(config.paths[0]?.surfaces)
    ;(report.nameRules[0]?.surfaces as Surface[]).push('shell')
    expect(config.paths[0]?.surfaces).toEqual(['fs'])
    expect(resolveRoots(config, base, posix).nameRules[0]?.surfaces).toEqual(['fs'])
  })
})
