import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { canonicalizeRoot } from '../src/paths.js'
import { buildPreview, MAX_PREVIEW_ENTRIES, parseStagedPaths, PREVIEW_PATH } from '../src/preview.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
mkdirSync(join(base, 'notes'))
mkdirSync(join(base, 'sibling'))

it('exposes the route path', () => {
  expect(PREVIEW_PATH).toBe('/extra-paths/resolved')
})

it('reports per-entry resolution, the effective set and warnings', () => {
  const config = normalizeConfig({ paths: ['notes', 'nope'] })
  const preview = buildPreview(config, base)
  expect(preview.workspaceCwd).toBe(base)
  expect(preview.entries.map(entry => entry.status)).toEqual(['ok', 'missing'])
  expect(preview.effective).toEqual([join(base, 'notes')])
  expect(preview.warnings).toHaveLength(1)
})

it('reports the host home directory so the page can resolve ~ itself', () => {
  expect(buildPreview(normalizeConfig(undefined), base).home).toBe(homedir())
})

it('rejects a missing cwd instead of guessing one', () => {
  expect(() => buildPreview(normalizeConfig({ paths: ['notes'] }), '')).toThrow('cwd is required')
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
  const draft = parseStagedPaths(JSON.stringify([{ path: 'notes', scope: 'always-write', surfaces: ['fs'] }]))
  const preview = buildPreview(stored, base, draft)
  expect(preview.effective).toEqual([join(base, 'notes')])
  expect(preview.entries[0]).toMatchObject({ raw: 'notes', scope: 'always-write', surfaces: ['fs'], status: 'ok' })
})

it('resolves a relative draft against the workspace it was asked about', () => {
  const preview = buildPreview(normalizeConfig(undefined), base, parseStagedPaths(JSON.stringify(['sibling'])))
  expect(preview.effective).toEqual([join(base, 'sibling')])
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
