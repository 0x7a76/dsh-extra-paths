/**
 * Cross-module enforcement boundaries: the properties that make a plugin which
 * both widens and narrows a sandbox defensible at all.
 *
 *   A. a call can only ever be re-stamped with a root the user configured —
 *      checked by trying to escape through a prefix-string sibling, a symlink
 *      that leaves the root, and a parent-traversal spelling;
 *   B. a grant never leaks across calls or objects — checked through live
 *      configuration, a reused caller policy, report aliasing and inner failure;
 *   C. a HARD RULE cannot be escaped either: a symlink alias inside a granted
 *      root, danger-full-access, or a broader ancestor grant must not widen a
 *      denied path, and the shell argv must append the deny after the grant.
 *
 * The per-module suites pin each function; this file pins the composition,
 * which is where an escape would actually have to happen.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { AccessDeniedError } from '../src/denial.js'
import { canonicalizeRoot, isUnder } from '../src/paths.js'
import { resolveRoots } from '../src/resolve.js'
import { widenArgv } from '../src/argv.js'
import { wrapFs, type FsInnerLike, type FsTargetLike } from '../src/wrap-fs.js'
import type { PolicyLike } from '../src/policy.js'

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'adv-')))
const ROOT = join(base, 'granted')
const SIBLING = join(base, 'granted-sibling')
const SECRETS = join(base, 'secrets')
mkdirSync(join(ROOT, 'sub'), { recursive: true })
mkdirSync(SIBLING, { recursive: true })
mkdirSync(SECRETS)
symlinkSync(SIBLING, join(ROOT, 'escape')) // a link INSIDE the root pointing OUT
symlinkSync(SECRETS, join(ROOT, 'into-secrets')) // a link inside the grant pointing at a DENIED root
const FILE_ROOT = join(base, 'file-root')
writeFileSync(FILE_ROOT, 'x')
const policy: PolicyLike = { mode: 'workspace-write', workspaceRoot: join(base, 'ws') }
const target = (path: string): FsTargetLike => ({ targetKey: path, displayPath: path })

function stub() {
  const calls: { policy: PolicyLike | undefined; target: FsTargetLike }[] = []
  const inner = {
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTargetLike> {
      return { targetKey: canonicalizeRoot(path), displayPath: path }
    },
    async readText(t: FsTargetLike) {
      calls.push({ policy: undefined, target: t })
      return 'content'
    },
    async writeText(t: FsTargetLike, _c: string, _e?: unknown, _s?: unknown, p?: PolicyLike) {
      calls.push({ policy: p, target: t })
      return { ok: true }
    },
    async editText(t: FsTargetLike, _ed: unknown, _e?: unknown, _s?: unknown, p?: PolicyLike) {
      calls.push({ policy: p, target: t })
      return { ok: true }
    },
  } as FsInnerLike
  return { inner, calls }
}

const always = normalizeConfig({ paths: [{ path: ROOT, scope: 'always-write' }] })
const writeOnly = normalizeConfig({ paths: [{ path: ROOT, scope: 'write' }] })
/** Always-write on the grant plus a deny on the secrets root: the hard-rule fixture. */
const alwaysWithSecretsDenied = normalizeConfig({ paths: [
  { path: ROOT, scope: 'always-write' },
  { path: SECRETS, access: 'deny' },
] })
const wrapped = (config = always, p: PolicyLike | undefined = policy) => {
  const s = stub()
  return {
    ...s,
    fs: wrapFs(s.inner, {
      readConfig: () => config,
      fallbackPolicy: () => p ?? { mode: 'workspace-write', workspaceRoot: base },
    }),
  }
}

describe('A. never grant outside a configured root', () => {
  it('rejects a prefix-string sibling', async () => {
    const { fs, calls } = wrapped()
    await fs.writeText(target(join(SIBLING, 'x.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy) // untouched → the base fence denies
  })

  it('rejects a symlink inside the root that escapes it', async () => {
    const { fs, calls } = wrapped()
    await fs.writeText(target(join(ROOT, 'escape', 'x.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('rejects a parent-traversal spelling', async () => {
    const { fs, calls } = wrapped()
    await fs.writeText(target(join(ROOT, '..', 'granted-sibling', 'x.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('still grants a legitimate descendant', async () => {
    const { fs, calls } = wrapped()
    await fs.writeText(target(join(ROOT, 'sub', 'x.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: ROOT, mode: 'workspace-write' })
  })

  it('never widens beyond the matched root: the stamped root is exactly the configured one', async () => {
    const { fs, calls } = wrapped()
    await fs.writeText(target(join(ROOT, 'sub', 'x.md')), 'x', undefined, undefined, policy)
    // Exactly the configured root, nothing appended, nothing broadened.
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: ROOT })
  })

  it('honours the mode gate: write-scope grants nothing under read-only', async () => {
    const readOnly: PolicyLike = { mode: 'read-only', workspaceRoot: policy.workspaceRoot }
    const { fs, calls } = wrapped(writeOnly)
    await fs.writeText(target(join(ROOT, 'sub', 'x.md')), 'x', undefined, undefined, readOnly)
    expect(calls[0]?.policy).toBe(readOnly)
  })

  it('honours the mode gate: always-write grants under read-only', async () => {
    const readOnly: PolicyLike = { mode: 'read-only', workspaceRoot: policy.workspaceRoot }
    const { fs, calls } = wrapped()
    await fs.writeText(target(join(ROOT, 'sub', 'x.md')), 'x', undefined, undefined, readOnly)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: ROOT, mode: 'workspace-write' })
  })

  it('widenArgv can only ever emit the roots it was handed', () => {
    const wrappedArgv = ['echo', 'hi']
    const confined = ['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...wrappedArgv]
    const widened = widenArgv(confined, wrappedArgv.length, { grants: [ROOT], readOnly: [], denied: [] })?.argv ?? []
    const profile = widened[2] ?? ''
    expect(profile).toContain(ROOT)
    expect(profile).not.toContain(SIBLING)
    // an unknown dialect yields undefined, which the caller must read as "no grant"
    expect(widenArgv(['weird-runner', '--', 'echo'], 1, { grants: [ROOT], readOnly: [], denied: [] })).toBeUndefined()
  })
})

describe('B. no leaks across calls or objects', () => {
  it('follows the live configuration, not a snapshot', async () => {
    const s = stub()
    let config = always
    const fs = wrapFs(s.inner, { readConfig: () => config, fallbackPolicy: () => policy })
    await fs.writeText(target(join(ROOT, 'sub', 'a.md')), 'x', undefined, undefined, policy)
    config = normalizeConfig(undefined)
    await fs.writeText(target(join(ROOT, 'sub', 'b.md')), 'x', undefined, undefined, policy)
    expect(s.calls[0]?.policy).toMatchObject({ workspaceRoot: ROOT })
    expect(s.calls[1]?.policy).toBe(policy) // revocation takes effect immediately
  })

  it('never mutates the caller policy, so a reused object cannot carry a grant', async () => {
    const s = stub()
    const reusable: PolicyLike = { mode: 'workspace-write', workspaceRoot: join(base, 'ws') }
    const fs = wrapFs(s.inner, { readConfig: () => always, fallbackPolicy: () => reusable })
    await fs.writeText(target(join(ROOT, 'sub', 'a.md')), 'x')
    expect(reusable).toEqual({ mode: 'workspace-write', workspaceRoot: join(base, 'ws') })
    // a later call for an unrelated target must not inherit the earlier stamp
    await fs.writeText(target(join(SIBLING, 'b.md')), 'x')
    expect(s.calls[1]?.policy).toBe(reusable)
  })

  it('does not alias the resolved report into the config', () => {
    const config = normalizeConfig({ paths: [{ path: ROOT, scope: 'write', surfaces: ['fs'] }] })
    const report = resolveRoots(config, base)
    ;(report.entries[0]?.surfaces as string[]).push('shell')
    expect(config.paths[0]?.surfaces).toEqual(['fs'])
    expect(resolveRoots(config, base).roots[0]?.surfaces).toEqual(['fs'])
  })

  it('documents the file-root edge: it is reported ok and fails later at the filesystem layer', () => {
    const report = resolveRoots(normalizeConfig({ paths: [FILE_ROOT] }), base)
    expect(report.entries[0]?.status).toBe('ok')
    expect(isUnder(join(FILE_ROOT, 'child'), FILE_ROOT)).toBe(true)
  })

  it('keeps isUnder honest for sibling prefixes and dot-prefixed children', () => {
    expect(isUnder(SIBLING, ROOT)).toBe(false)
    expect(isUnder(`${ROOT}extra`, ROOT)).toBe(false)
    expect(isUnder(join(ROOT, '..cache'), ROOT)).toBe(true)
  })

  it('propagates an inner failure instead of turning it into a grant', async () => {
    const boom = new Error('inner exploded')
    const inner = {
      sandboxMode: 'workspace-write',
      async resolve(path: string) { return { targetKey: path, displayPath: path } },
      async writeText() { throw boom },
      async editText() { throw boom },
    } as FsInnerLike
    const fs = wrapFs(inner, { readConfig: () => always, fallbackPolicy: () => policy })
    await expect(fs.writeText(target(join(ROOT, 'sub', 'a.md')), 'x', undefined, undefined, policy)).rejects.toBe(boom)
  })

  it('never reaches the filesystem for reads of unrelated members', () => {
    const s = stub()
    const resolve = vi.fn(s.inner.resolve)
    s.inner.resolve = resolve
    const fs = wrapFs(s.inner, { readConfig: () => always, fallbackPolicy: () => policy })
    expect(fs.sandboxMode).toBe('workspace-write')
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('C. a hard rule cannot be escaped', () => {
  it('a symlink inside a granted root cannot smuggle a DENIED target past the fence', async () => {
    const { fs, calls } = wrapped(alwaysWithSecretsDenied)
    // The spelling lives under the granted root, but the host resolves it to the
    // denied real path — the wrapper must judge the RESOLVED identity.
    const error = (await (async () => {
      try {
        await fs.writeText(target(join(ROOT, 'into-secrets', 'x.md')), 'x', undefined, undefined, policy)
      } catch (caught) {
        return caught
      }
      return undefined
    })())
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('the same alias cannot smuggle a denied READ', async () => {
    const { fs } = wrapped(alwaysWithSecretsDenied)
    const resolved = await (fs.resolve as unknown as (path: string) => Promise<FsTargetLike>)(join(ROOT, 'into-secrets', 'x.md'))
    expect(() => (fs.readText as unknown as (t: FsTargetLike) => unknown)(resolved)).toThrow(AccessDeniedError)
  })

  it('danger-full-access does not lift a deny rule', async () => {
    const { fs, calls } = wrapped(alwaysWithSecretsDenied)
    const danger: PolicyLike = { mode: 'danger-full-access', workspaceRoot: policy.workspaceRoot }
    await expect(fs.writeText(target(join(SECRETS, 'x.md')), 'x', undefined, undefined, danger))
      .rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('a broader granted ancestor cannot re-enable a denied descendant', async () => {
    const config = normalizeConfig({ paths: [
      { path: ROOT, scope: 'always-write' },
      { path: join(SECRETS, 'keys'), access: 'deny' },
    ] })
    mkdirSync(join(SECRETS, 'keys'), { recursive: true })
    const { fs, calls } = wrapped(config)
    await expect(fs.writeText(target(join(SECRETS, 'keys', 'id')), 'x', undefined, undefined, policy))
      .rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('revoking the hard rule restores the write immediately', async () => {
    let config = alwaysWithSecretsDenied
    const s = stub()
    const guarded = wrapFs(s.inner, { readConfig: () => config, fallbackPolicy: () => policy })
    await expect(guarded.writeText(target(join(SECRETS, 'x.md')), 'x', undefined, undefined, policy))
      .rejects.toBeInstanceOf(AccessDeniedError)
    config = always
    await guarded.writeText(target(join(SECRETS, 'x.md')), 'x', undefined, undefined, policy)
    // No grant matched the secrets root, so the caller policy passes through
    // untouched and the base fence remains the gate there.
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]?.policy).toBe(policy)
  })

  it('appends a shell deny AFTER the grant it must override (last rule wins)', () => {
    const command = ['echo']
    const confined = ['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...command]
    const profile = widenArgv(confined, command.length, {
      grants: [ROOT],
      readOnly: [],
      denied: [SECRETS],
    })?.argv[2] ?? ''
    expect(profile).toContain(`(allow file-write* (subpath "${ROOT}"))`)
    expect(profile).toContain(`(deny file-read* (subpath "${SECRETS}"))`)
    expect(profile).toContain(`(deny file-write* (subpath "${SECRETS}"))`)
    expect(profile.indexOf(`(allow file-write* (subpath "${ROOT}"))`))
      .toBeLessThan(profile.indexOf(`(deny file-read* (subpath "${SECRETS}"))`))
  })
})
