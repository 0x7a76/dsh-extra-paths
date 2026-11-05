import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { canonicalizeRoot } from '../src/paths.js'
import { isConfiningFs, wrapFs, type FsInnerLike, type FsTargetLike } from '../src/wrap-fs.js'

// realpath the fixture: darwin's tmpdir() is /var/... while canonical spellings
// are /private/var/..., and the wrapper must match the canonical one.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const notes = join(base, 'notes')
mkdirSync(notes)

function innerStub() {
  const calls: { policy: unknown; target: FsTargetLike; expected: unknown; signal: unknown }[] = []
  const inner = {
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTargetLike> {
      return { targetKey: path, displayPath: path }
    },
    async writeText(target: FsTargetLike, _content: string, expected?: unknown, signal?: unknown, policy?: unknown) {
      calls.push({ policy, target, expected, signal })
      return { ok: true }
    },
    async editText(target: FsTargetLike, _edit: unknown, expected?: unknown, signal?: unknown, policy?: unknown) {
      calls.push({ policy, target, expected, signal })
      return { ok: true }
    },
  } as FsInnerLike
  return { inner, calls }
}

function deps(config = normalizeConfig({ paths: [{ path: notes, scope: 'write' }] })) {
  return { readConfig: () => config, fallbackPolicy: () => undefined }
}

const target = (path: string): FsTargetLike => ({ targetKey: path, displayPath: path })

describe('isConfiningFs', () => {
  it('accepts a sandboxed filesystem and rejects a plain one', () => {
    expect(isConfiningFs(innerStub().inner)).toBe(true)
    expect(isConfiningFs({ readText: () => undefined })).toBe(false)
  })
})

describe('wrapFs', () => {
  it('re-stamps the policy with the matched root', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, { mode: 'workspace-write', workspaceRoot: base })
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: notes })
  })

  it('grants an always-write root in a read-only session', async () => {
    const { inner, calls } = innerStub()
    const config = normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] })
    const wrapped = wrapFs(inner, deps(config))
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, { mode: 'read-only', workspaceRoot: base })
    expect(calls[0]?.policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: notes })
  })

  it('passes an unmatched target through untouched (same policy object)', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(base, 'other.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('does not grant a write-scope root in a read-only session', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'read-only', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('delegates unchanged when the caller stamped no policy and no fallback resolves', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    expect(calls[0]?.policy).toBeUndefined()
  })

  it('uses the fallback policy when the caller stamped none', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, { ...deps(), fallbackPolicy: () => ({ mode: 'workspace-write', workspaceRoot: base }) })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('stamps the FIRST matching root, so a nested child cannot narrow its parent', async () => {
    const { inner, calls } = innerStub()
    mkdirSync(join(notes, 'sub'), { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: notes, scope: 'write' },
      { path: join(notes, 'sub'), scope: 'write' },
    ] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    await wrapped.writeText(target(join(notes, 'sub', 'a.md')), 'x', undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('translates editText the same way as writeText', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.editText(target(join(notes, 'a.md')), { find: 'a', replace: 'b' }, undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('delegates unchanged under danger-full-access', async () => {
    const { inner, calls } = innerStub()
    // `always-write` on purpose: with a `write`-scope root the case would pass
    // even if the danger guard were deleted, because nothing is granted outside
    // workspace-write anyway (an always-write root IS granted under read-only).
    const wrapped = wrapFs(inner, deps(normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] })))
    const policy = { mode: 'danger-full-access', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('does not even read the configuration under danger-full-access', async () => {
    const { inner } = innerStub()
    const resolve = vi.fn(async (path: string) => ({ targetKey: path, displayPath: path }))
    inner.resolve = resolve
    // `readConfig` is the assertion with teeth: `grantFor` itself returns [] under
    // danger-full-access, so a resolve-not-called assertion would be satisfied by
    // that other guard. Only skipping `resolveRoots(config, …)` is observable.
    const readConfig = vi.fn(() => normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] }))
    const wrapped = wrapFs(inner, { readConfig, fallbackPolicy: () => undefined })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, {
      mode: 'danger-full-access',
      workspaceRoot: base,
    })
    expect(readConfig).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('never mutates the caller policy object', async () => {
    const { inner } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(policy).toEqual({ mode: 'workspace-write', workspaceRoot: base })
  })

  it('asks for the fallback policy on every call, never once at wrap time', async () => {
    const { inner } = innerStub()
    const fallbackPolicy = vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: base }) as const)
    const wrapped = wrapFs(inner, { readConfig: () => normalizeConfig({ paths: [notes] }), fallbackPolicy })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    expect(fallbackPolicy).toHaveBeenCalledTimes(2)
  })

  it('re-reads the configuration on every call, so a removed root stops being granted', async () => {
    const { inner, calls } = innerStub()
    let config = normalizeConfig({ paths: [{ path: notes, scope: 'write' }] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    config = normalizeConfig(undefined)
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
    expect(calls[1]?.policy).toBe(policy)
  })

  it('matches on the canonical target, not the spelling the caller passed', async () => {
    const { inner, calls } = innerStub()
    const link = join(base, 'link-to-notes')
    if (!existsSync(link)) symlinkSync(notes, link)
    // The stub resolves the symlink to its real path, exactly as the fs service
    // does; matching on `displayPath` would miss the configured root.
    inner.resolve = async (path: string) => ({ targetKey: canonicalizeRoot(path), displayPath: path })
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(link, 'a.md')), 'x', undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('passes the expected intent and the caller signal through, and returns the delegate result', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const controller = new AbortController()
    const expected = { kind: 'createIfAbsent' }
    const result = await wrapped.writeText(target(join(notes, 'a.md')), 'x', expected, controller.signal, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.expected).toBe(expected)
    expect(calls[0]?.signal).toBe(controller.signal)
    expect(result).toEqual({ ok: true })
  })

  it('passes the expected intent and signal through editText too', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const controller = new AbortController()
    const expected = { version: 3 }
    await wrapped.editText(target(join(notes, 'a.md')), { find: 'a', replace: 'b' }, expected, controller.signal, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.expected).toBe(expected)
    expect(calls[0]?.signal).toBe(controller.signal)
  })

  it('keeps every other policy field when it re-stamps the root', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
      sessionId: 'sess-1',
    })
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: notes, sessionId: 'sess-1' })
  })

  it('forwards every other member and keeps getters working', () => {
    const { inner } = innerStub()
    const wrapped = wrapFs(inner, deps())
    expect(wrapped.sandboxMode).toBe('workspace-write')
    expect(typeof wrapped.resolve).toBe('function')
    // Interceptors and bound methods are built once: a fresh closure (or bind)
    // per read would churn identities.
    expect(wrapped.resolve).toBe(wrapped.resolve)
    expect(wrapped.writeText).toBe(wrapped.writeText)
    expect(wrapped.editText).toBe(wrapped.editText)
    expect(wrapped.constructor).toBe(inner.constructor)
    expect(wrapped).toBeInstanceOf(Object)
  })
})

// ── DSH 0.2.2: three more fenced mutations ─────────────────────────────────
// `patchText` (the apply_patch tool), `deleteFile` and `moveFile` joined the
// in-process fence in 0.2.2. The wrapper must cover them structurally: present
// on the inner service → overridden with the same grant translation; absent
// (0.2.1) → left absent. `moveFile` is the only two-target mutation.

/** A stub carrying every mutation the 0.2.2 fs fence declares. */
function mutationStub() {
  const calls: { method: string; target?: FsTargetLike; destination?: FsTargetLike; policy: unknown }[] = []
  const record = (method: string, target: FsTargetLike, policy: unknown, destination?: FsTargetLike) =>
    calls.push(destination === undefined ? { method, target, policy } : { method, target, destination, policy })
  const inner = {
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTargetLike> {
      return { targetKey: path, displayPath: path }
    },
    async writeText(target: FsTargetLike, _content: string, _expected?: unknown, _signal?: unknown, policy?: unknown) {
      record('writeText', target, policy)
      return { ok: true }
    },
    async editText(target: FsTargetLike, _edit: unknown, _expected?: unknown, _signal?: unknown, policy?: unknown) {
      record('editText', target, policy)
      return { ok: true }
    },
    async patchText(target: FsTargetLike, _hunks: unknown, _expected?: unknown, _signal?: unknown, policy?: unknown) {
      record('patchText', target, policy)
      return { ok: true }
    },
    async deleteFile(target: FsTargetLike, _expected?: unknown, _signal?: unknown, policy?: unknown) {
      record('deleteFile', target, policy)
      return { ok: true }
    },
    async moveFile(source: FsTargetLike, destination: FsTargetLike, _options?: unknown, _signal?: unknown, policy?: unknown) {
      record('moveFile', source, policy, destination)
      return { ok: true }
    },
  } as FsInnerLike
  return { inner, calls }
}

describe('wrapFs on the 0.2.2 five-mutation surface', () => {
  it('re-stamps patchText and deleteFile exactly like writeText', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.patchText!(target(join(notes, 'a.md')), [{ hunk: 1 }], undefined, undefined, policy)
    await wrapped.deleteFile!(target(join(notes, 'a.md')), undefined, undefined, policy)
    expect(calls.map(call => [call.method, call.policy])).toEqual([
      ['patchText', { mode: 'workspace-write', workspaceRoot: notes }],
      ['deleteFile', { mode: 'workspace-write', workspaceRoot: notes }],
    ])
  })

  it('leaves a delete outside every configured root untouched', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.deleteFile!(target(join(base, 'other.md')), undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('re-stamps a move whose two ends share one configured root', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.moveFile!(target(join(notes, 'a.md')), target(join(notes, 'b.md')), undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: notes })
  })

  it('grants BOTH roots for a move between two configured roots (0.2.2 additionalWritableRoots)', async () => {
    const cache = join(base, 'cache')
    mkdirSync(cache, { recursive: true })
    const { inner, calls } = mutationStub()
    const config = normalizeConfig({ paths: [{ path: notes, scope: 'write' }, { path: cache, scope: 'write' }] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    await wrapped.moveFile!(target(join(notes, 'a.md')), target(join(cache, 'b.md')), undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toEqual({
      mode: 'workspace-write',
      workspaceRoot: notes,
      additionalWritableRoots: [cache],
    })
  })

  it('does not elevate a move when one end is outside the configured roots', async () => {
    const cache = join(base, 'cache')
    mkdirSync(cache, { recursive: true })
    const { inner, calls } = mutationStub()
    const config = normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    const policy = { mode: 'read-only', workspaceRoot: base } as const
    await wrapped.moveFile!(target(join(notes, 'a.md')), target(join(cache, 'b.md')), undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('only overrides the mutations the running host declares (0.2.1 keeps three absent)', () => {
    const { inner } = innerStub()
    const wrapped = wrapFs(inner, deps())
    expect(wrapped.patchText).toBeUndefined()
    expect(wrapped.deleteFile).toBeUndefined()
    expect(wrapped.moveFile).toBeUndefined()
    const { inner: full } = mutationStub()
    const modern = wrapFs(full, deps())
    expect(typeof modern.patchText).toBe('function')
    expect(typeof modern.deleteFile).toBe('function')
    expect(typeof modern.moveFile).toBe('function')
  })
})
