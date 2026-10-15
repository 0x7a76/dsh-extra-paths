/**
 * Cross-module enforcement boundaries: the two properties that make a plugin
 * which widens a sandbox defensible at all.
 *
 *   A. a call can only ever be re-stamped with a root the user configured —
 *      checked by trying to escape through a prefix-string sibling, a symlink
 *      that leaves the root, and a parent-traversal spelling;
 *   B. a grant never leaks across calls or objects — checked through live
 *      configuration, a reused caller policy, report aliasing and inner failure.
 *
 * The per-module suites pin each function; this file pins the composition,
 * which is where an escape would actually have to happen.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { canonicalizeRoot, isUnder } from '../src/paths.js'
import { resolveRoots } from '../src/resolve.js'
import { widenArgv } from '../src/argv.js'
import { wrapFs, type FsInnerLike, type FsTargetLike } from '../src/wrap-fs.js'
import type { PolicyLike } from '../src/policy.js'

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'adv-')))
const ROOT = join(base, 'granted')
const SIBLING = join(base, 'granted-sibling')
mkdirSync(join(ROOT, 'sub'), { recursive: true })
mkdirSync(SIBLING, { recursive: true })
symlinkSync(SIBLING, join(ROOT, 'escape')) // a link INSIDE the root pointing OUT
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
const wrapped = (config = always, p: PolicyLike | undefined = policy) => {
  const s = stub()
  return { ...s, fs: wrapFs(s.inner, { readConfig: () => config, fallbackPolicy: () => p }) }
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
    const widened = widenArgv(confined, wrappedArgv.length, [ROOT]) ?? []
    const quoted = widened[2] ?? ''
    expect(quoted).toContain(ROOT)
    expect(quoted).not.toContain(SIBLING)
    // an unknown dialect yields undefined, which the caller must read as "no grant"
    expect(widenArgv(['weird-runner', '--', 'echo'], 1, [ROOT])).toBeUndefined()
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
