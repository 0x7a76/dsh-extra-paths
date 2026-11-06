import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { canonicalizeRoot, type PlatformFacts } from '../src/paths.js'
import { buildPreview, MAX_PREVIEW_ENTRIES, parseStagedPaths, PREVIEW_PATH } from '../src/preview.js'
import { shellCapabilityOf, type ShellCapability } from '../src/shell-dialect.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
mkdirSync(join(base, './notes'))
mkdirSync(join(base, './docs'))
mkdirSync(join(base, './secrets'))
mkdirSync(join(base, './sibling'))
// A WSL mount fixture: a Windows drive translated into a path that exists.
const wslMount = join(base, 'mnt')
mkdirSync(join(wslMount, 'c', './notes'), { recursive: true })

/** A POSIX host rooted at the real home (so `~` asserts against the real one). */
const posix: PlatformFacts = { platform: 'darwin', wsl: false, wslMountRoot: '/mnt', home: homedir() }
/** A Windows host: only lexical answers are asserted (no C: exists here). */
const windows: PlatformFacts = { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' }
/** A WSL host whose drive mounts live under the fixture. */
const wsl: PlatformFacts = { platform: 'linux', wsl: true, wslMountRoot: wslMount, home: homedir() }

const capability: ShellCapability = {
  shellReadDeny: false,
  shellWriteDeny: false,
  shellReadOnly: false,
  shellDialect: 'landlock',
}

it('exposes the route path', () => {
  expect(PREVIEW_PATH).toBe('/extra-paths/resolved')
})

it('reports per-entry resolution, the effective set and warnings', () => {
  const config = normalizeConfig({ paths: ['./notes', './nope'] })
  const preview = buildPreview(config, base)
  expect(preview.workspaceCwd).toBe(base)
  expect(preview.entries.map(entry => entry.status)).toEqual(['ok', 'missing'])
  expect(preview.effective).toEqual([join(base, './notes')])
  expect(preview.writable).toEqual([join(base, './notes')])
  expect(preview.warnings).toHaveLength(1)
})

it('reports the host home directory so the page can resolve ~ itself', () => {
  expect(buildPreview(normalizeConfig(undefined), base).home).toBe(homedir())
})

it('reports the host platform facts the page must not infer itself', () => {
  const preview = buildPreview(normalizeConfig(undefined), base, undefined, { facts: posix })
  // Under WSL the browser is Windows Chrome while the host is Linux, and a remote
  // page is a different machine: only the host can answer these.
  expect(preview.platform).toEqual({ platform: 'darwin', wsl: false, wslMountRoot: '/mnt', dialect: 'posix' })
  expect(buildPreview(normalizeConfig(undefined), 'C:\\work', undefined, { facts: windows }).platform.dialect)
    .toBe('windows')
  expect(buildPreview(normalizeConfig(undefined), base, undefined, { facts: wsl }).platform).toMatchObject({
    wsl: true,
    wslMountRoot: wslMount,
    dialect: 'posix',
  })
})

it('defaults the payload to the running host', () => {
  const preview = buildPreview(normalizeConfig(undefined), base)
  expect(preview.platform.platform).toBe(process.platform)
  expect(preview.platform.dialect).toBe(process.platform === 'win32' ? 'windows' : 'posix')
  expect(preview.capabilities).toEqual(shellCapabilityOf(process.platform))
})

it('accepts an injected shell capability (the wrapper records the real dialect)', () => {
  expect(buildPreview(normalizeConfig(undefined), base, undefined, { facts: posix, capability }).capabilities)
    .toBe(capability)
})

it('reports read-only and denied roots separately from the writable set', () => {
  const config = normalizeConfig({ paths: [
    './notes',
    { path: './docs', access: 'read' },
    { path: './secrets', access: 'deny' },
  ] })
  const preview = buildPreview(config, base, undefined, { facts: posix })
  expect(preview.effective).toEqual([join(base, './notes')])
  expect(preview.writable).toEqual([join(base, './notes')])
  expect(preview.readOnly).toEqual([join(base, './docs')])
  expect(preview.denied).toEqual([join(base, './secrets')])
  expect(preview.entries.map(entry => entry.access)).toEqual(['write', 'read', 'deny'])
})

it('resolves a Windows spelling through the host translation', () => {
  const config = normalizeConfig({ paths: ['C:\\notes'] })
  const preview = buildPreview(config, base, undefined, { facts: wsl })
  expect(preview.effective).toEqual([realpathSync.native(join(wslMount, 'c', './notes'))])
  expect(preview.entries[0]).toMatchObject({ status: 'ok', access: 'write' })
})

it('reports a foreign spelling as a non-applicable row instead of failing the route', () => {
  const config = normalizeConfig({ paths: ['C:\\notes'] })
  const preview = buildPreview(config, base, undefined, { facts: posix })
  expect(preview.effective).toEqual([])
  expect(preview.entries[0]).toMatchObject({ status: 'foreign' })
  expect(preview.warnings.join('\n')).toContain('not applicable on this host')
})

it('rejects a missing cwd instead of guessing one', () => {
  expect(() => buildPreview(normalizeConfig({ paths: ['./notes'] }), '')).toThrow('cwd is required')
})

it('expands a ~ base instead of resolving it against the server process cwd', () => {
  // The defect this pins: `~/projects` used to reach `resolvePath('~/projects', '..')`,
  // so the preview showed `…/<server cwd>/~/…` for an otherwise valid `..` row.
  const preview = buildPreview(normalizeConfig({ paths: ['..'] }), '~')
  expect(preview.workspaceCwd).toBe(canonicalizeRoot(homedir()))
  expect(preview.effective).toEqual([canonicalizeRoot(dirname(canonicalizeRoot(homedir())))])
})

it('refuses a relative or ~user base outright', () => {
  expect(() => buildPreview(normalizeConfig(undefined), 'work')).toThrow('absolute')
  expect(() => buildPreview(normalizeConfig(undefined), '~someone')).toThrow('absolute')
})

it('refuses a base that is foreign to the host dialect', () => {
  // A Windows workspace path on a POSIX host cannot be resolved here; the page
  // must not receive a silently different answer.
  expect(() => buildPreview(normalizeConfig(undefined), 'C:\\work', undefined, { facts: posix })).toThrow('absolute')
})

it('resolves a Windows workspace base in the host dialect', () => {
  expect(buildPreview(normalizeConfig(undefined), 'C:\\work', undefined, { facts: windows }).workspaceCwd)
    .toBe('C:\\work')
})

it('resolves a ~ ROW through the same expansion as an absolute one', () => {
  const draft = parseStagedPaths(JSON.stringify(['~']))
  const preview = buildPreview(normalizeConfig(undefined), base, draft)
  expect(preview.effective).toEqual([canonicalizeRoot(homedir())])
  // Broad, but the warning is what tells the user to narrow it.
  expect(preview.warnings.join('\n')).toContain('home directory')
})

it('answers for the UNSAVED rows the page sends, not for the stored document', () => {
  // The stored document knows nothing; the draft is what the user is typing.
  const stored = normalizeConfig(undefined)
  const draft = parseStagedPaths(JSON.stringify([{ path: './notes', access: 'always-write', surfaces: ['fs'] }]))
  const preview = buildPreview(stored, base, draft)
  expect(preview.effective).toEqual([join(base, './notes')])
  expect(preview.entries[0]).toMatchObject({ raw: './notes', access: 'always-write', surfaces: ['fs'], status: 'ok' })
})

it('accepts a legacy scope in a draft row', () => {
  // A page from an older host half may still send `scope`: it must keep answering.
  const draft = parseStagedPaths(JSON.stringify([{ path: './notes', scope: 'always-write' }]))
  const preview = buildPreview(normalizeConfig(undefined), base, draft)
  expect(preview.effective).toEqual([join(base, './notes')])
  expect(preview.entries[0]).toMatchObject({ access: 'always-write', status: 'ok' })
})

it('resolves a relative draft against the workspace it was asked about', () => {
  const preview = buildPreview(normalizeConfig(undefined), base, parseStagedPaths(JSON.stringify(['./sibling'])))
  expect(preview.effective).toEqual([join(base, './sibling')])
})

it('rejects an unusable draft through the same gate the settings service uses', () => {
  const draft = parseStagedPaths(JSON.stringify([{ path: '/', surfaces: ['fs'] }]))
  // `/` is refused by `validateConfig`... but this path runs `normalizeConfig`,
  // so the ROOT check is the resolver's job: it marks the entry rejected.
  const preview = buildPreview(normalizeConfig(undefined), base, draft)
  expect(preview.effective).toEqual([])
  expect(preview.entries[0]?.status).toBe('rejected')
})

it('refuses a draft that is not an array, not JSON, or too large', () => {
  expect(() => parseStagedPaths('nope')).toThrow('paths must be JSON')
  expect(() => parseStagedPaths('{"a":1}')).toThrow('paths must be a JSON array')
  expect(() => parseStagedPaths(JSON.stringify(Array.from({ length: MAX_PREVIEW_ENTRIES + 1 }, () => 'x'))))
    .toThrow('at most')
  expect(() => parseStagedPaths('x'.repeat(9000))).toThrow('too long')
  expect(parseStagedPaths(undefined)).toBeUndefined()
  expect(parseStagedPaths('')).toBeUndefined()
})

it('refuses a draft row the settings service would refuse', () => {
  // `normalizeConfig` is the gate, so an empty spelling fails the same way a
  // settings write would — the route answers 400 and the page keeps its last
  // good preview plus the live lexical column.
  const draft = parseStagedPaths(JSON.stringify(['']))
  expect(() => buildPreview(normalizeConfig(undefined), base, draft)).toThrow('non-empty')
})

describe('name rules in the preview', () => {
  it('reports match counts in the entries but keeps them out of the shell-expressible arrays', () => {
    const denyA = join(base, 'pv', 'a', '.pv-deny')
    const denyB = join(base, 'pv', 'b', '.pv-deny')
    const readRoot = join(base, 'pv', '.pv-read')
    const writeRoot = join(base, 'pv', '.pv-write')
    mkdirSync(denyA, { recursive: true })
    mkdirSync(denyB, { recursive: true })
    mkdirSync(readRoot, { recursive: true })
    mkdirSync(writeRoot, { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: '.pv-deny', access: 'deny' },
      { path: '.pv-read', access: 'read' },
      { path: '.pv-write', access: 'write' },
    ] })
    const preview = buildPreview(config, base, undefined, { facts: posix })
    // Name rules are FS-ONLY: the effective-roots arrays describe what the SHELL
    // can express, so they stay empty here. The row still gets its match count.
    expect(preview.denied).toEqual([])
    expect(preview.readOnly).toEqual([])
    expect(preview.writable).toEqual([])
    expect(preview.effective).toEqual(preview.writable)
    expect(preview.entries.map(entry => entry.matches)).toEqual([2, 1, 1])
  })

  it('does not put an always-write name rule into the writable/effective set', () => {
    const root = join(base, 'pv-always', '.pv-always')
    mkdirSync(root, { recursive: true })
    const preview = buildPreview(
      normalizeConfig({ paths: [{ path: '.pv-always', access: 'always-write' }] }),
      base,
      undefined,
      { facts: posix },
    )
    expect(preview.writable).toEqual([])
    expect(preview.effective).toEqual([])
    expect(preview.entries[0]).toMatchObject({ access: 'always-write', matches: 1 })
  })

  it('never lets a name match duplicate (or reorder) a literal root in the arrays', () => {
    const literal = join(base, 'pv-dedupe', '.pv-keep')
    mkdirSync(literal, { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: literal, access: 'write' },
      { path: '.pv-keep', access: 'write' },
    ] })
    const preview = buildPreview(config, base, undefined, { facts: posix })
    expect(preview.writable).toEqual([literal])
    expect(preview.entries[0]).not.toHaveProperty('matches')
    expect(preview.entries[1]).toMatchObject({ matches: 1 })
  })

  it('answers for an unsaved bare-name row', () => {
    const root = join(base, 'pv-draft', '.pv-draft')
    mkdirSync(root, { recursive: true })
    const draft = parseStagedPaths(JSON.stringify([{ path: '.pv-draft', access: 'deny' }]))
    const preview = buildPreview(normalizeConfig(undefined), base, draft, { facts: posix })
    expect(preview.denied).toEqual([])
    expect(preview.entries[0]).toMatchObject({ raw: '.pv-draft', resolved: '', matches: 1, status: 'ok' })
  })

  it('says the match count is partial when the display walk is incomplete', () => {
    const link = join(base, '.pv-link')
    // A symlinked match cannot be counted reliably; the count is partial and the
    // warning says so (fs enforcement itself never walks and is unaffected).
    if (!existsSync(link)) symlinkSync(join(base, 'notes'), link)
    const preview = buildPreview(
      normalizeConfig({ paths: [{ path: '.pv-link', access: 'deny' }] }),
      base,
      undefined,
      { facts: posix },
    )
    expect(preview.denied).toEqual([])
    expect(preview.entries[0]).toMatchObject({ matches: 0, status: 'ok' })
    expect(preview.warnings.join('\n')).toContain('match count is partial')
    expect(preview.warnings.join('\n')).toContain('symbolic links')
  })

  it('shows zero matches for a name nothing matches yet, without a warning', () => {
    const preview = buildPreview(
      normalizeConfig({ paths: [{ path: '.pv-none', access: 'deny' }] }),
      base,
      undefined,
      { facts: posix },
    )
    expect(preview.denied).toEqual([])
    expect(preview.entries[0]).toMatchObject({ matches: 0, status: 'ok' })
    expect(preview.warnings).toEqual([])
  })
})
