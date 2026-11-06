/**
 * The filesystem half: the transparent grant proxy AND the hard-rule fence.
 *
 * Two families of pins live here:
 * - the 0.2.x grant translation (policy re-stamp, mode gate, move endpoints) must
 *   stay byte-for-byte what it was — the 0.3.0 deny/read levels only ADD refusals;
 * - the hard rules must run BEFORE any backend call: a denied/read-only target
 *   never reaches the inner service, and that holds even under
 *   `danger-full-access` (the host does not confine then, so this is the only
 *   layer left).
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { ACCESS_DENIED_CODE, AccessDeniedError } from '../src/denial.js'
import { canonicalizeRoot } from '../src/paths.js'
import { isConfiningFs, wrapFs, type FsInnerLike, type FsReadMethod, type FsTargetLike } from '../src/wrap-fs.js'

// realpath the fixture: darwin's tmpdir() is /var/... while canonical spellings
// are /private/var/..., and the wrapper must match the canonical one.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const notes = join(base, 'notes')
const secrets = join(base, 'secrets')
const generated = join(base, 'generated')
mkdirSync(notes)
mkdirSync(secrets)
mkdirSync(generated)

// A second root OUTSIDE the workspace: a configured WRITABLE root is part of a
// name rule's scope, so a `.git` deny must reach into it too.
const external = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-ext-')))
// A repository tree for the name-rule cases: `.git` exists two levels below the
// workspace root, exactly the shape a bare-name rule is meant to cover.
const repo = join(base, 'repo')
const repoGit = join(repo, '.git')
mkdirSync(repoGit, { recursive: true })

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

function deps(
  config = normalizeConfig({ paths: [{ path: notes, scope: 'write' }] }),
  fallbackPolicy: () => { mode: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot: string } | undefined = () => undefined,
) {
  return { readConfig: () => config, fallbackPolicy }
}

const target = (path: string): FsTargetLike => ({ targetKey: path, displayPath: path })
const writePolicy = { mode: 'workspace-write', workspaceRoot: base } as const
const dangerPolicy = { mode: 'danger-full-access', workspaceRoot: base } as const

/** Capture the thrown/rejected error so its CODE and message can both be pinned. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused')
}

describe('isConfiningFs', () => {
  it('accepts a sandboxed filesystem and rejects a plain one', () => {
    expect(isConfiningFs(innerStub().inner)).toBe(true)
    expect(isConfiningFs({ readText: () => undefined })).toBe(false)
  })
})

describe('wrapFs grant translation (existing behavior preserved)', () => {
  it('re-stamps the policy with the matched root', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, writePolicy)
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
    await wrapped.writeText(target(join(notes, 'sub', 'a.md')), 'x', undefined, undefined, writePolicy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('translates editText the same way as writeText', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.editText(target(join(notes, 'a.md')), { find: 'a', replace: 'b' }, undefined, undefined, writePolicy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('delegates unchanged under danger-full-access', async () => {
    const { inner, calls } = innerStub()
    // `always-write` on purpose: with a `write`-scope root the case would pass
    // even if the danger guard were deleted, because nothing is granted outside
    // workspace-write anyway (an always-write root IS granted under read-only).
    const wrapped = wrapFs(inner, deps(normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] })))
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, dangerPolicy)
    expect(calls[0]?.policy).toBe(dangerPolicy)
  })

  it('checks hard rules under danger-full-access but never resolves or re-stamps when there are none', async () => {
    const { inner, calls } = innerStub()
    const resolve = vi.fn(async (path: string) => ({ targetKey: path, displayPath: path }))
    inner.resolve = resolve
    // 0.3.0 deliberate change: the configuration IS read in every mode, because a
    // deny/read rule must survive danger-full-access. The pinned property that
    // remains is "no resolve, no re-stamp" when no hard rule exists.
    const readConfig = vi.fn(() => normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] }))
    const wrapped = wrapFs(inner, { readConfig, fallbackPolicy: () => undefined })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, dangerPolicy)
    expect(readConfig).toHaveBeenCalledOnce()
    expect(resolve).not.toHaveBeenCalled()
    expect(calls[0]?.policy).toBe(dangerPolicy)
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
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, writePolicy)
    config = normalizeConfig(undefined)
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, writePolicy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
    expect(calls[1]?.policy).toBe(writePolicy)
  })

  it('matches on the canonical target, not the spelling the caller passed', async () => {
    const { inner, calls } = innerStub()
    const link = join(base, 'link-to-notes')
    symlinkSync(notes, link)
    // The stub resolves the symlink to its real path, exactly as the fs service
    // does; matching on `displayPath` would miss the configured root.
    inner.resolve = async (path: string) => ({ targetKey: canonicalizeRoot(path), displayPath: path })
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(link, 'a.md')), 'x', undefined, undefined, writePolicy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('passes the expected intent and the caller signal through, and returns the delegate result', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const controller = new AbortController()
    const expected = { kind: 'createIfAbsent' }
    const result = await wrapped.writeText(target(join(notes, 'a.md')), 'x', expected, controller.signal, writePolicy)
    expect(calls[0]?.expected).toBe(expected)
    expect(calls[0]?.signal).toBe(controller.signal)
    expect(result).toEqual({ ok: true })
  })

  it('passes the expected intent and signal through editText too', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const controller = new AbortController()
    const expected = { version: 3 }
    await wrapped.editText(target(join(notes, 'a.md')), { find: 'a', replace: 'b' }, expected, controller.signal, writePolicy)
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

// ── hard rules: deny reads ──────────────────────────────────────────────────

/** All six content/listing/watch entry points the deny rule must cover. */
const READ_METHODS: readonly FsReadMethod[] = ['readText', 'streamText', 'readBytes', 'readByteRange', 'listDir', 'watch']

/** A stub declaring every read method plus the metadata methods. */
function readStub() {
  const calls: { method: string; target: FsTargetLike }[] = []
  const record = (method: string, targetValue: FsTargetLike) => { calls.push({ method, target: targetValue }) }
  const inner = {
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTargetLike> {
      return { targetKey: canonicalizeRoot(path), displayPath: path }
    },
    async readText(t: FsTargetLike) { record('readText', t); return 'text' },
    async streamText(t: FsTargetLike) { record('streamText', t); return ['chunk'] },
    async readBytes(t: FsTargetLike, _signal: AbortSignal | undefined, _max: number) { record('readBytes', t); return new Uint8Array([1]) },
    async readByteRange(t: FsTargetLike, _range: unknown) { record('readByteRange', t); return new Uint8Array([2]) },
    async listDir(t: FsTargetLike) { record('listDir', t); return [] },
    async watch(t: FsTargetLike) { record('watch', t); return async () => undefined },
    async stat(t: FsTargetLike) { record('stat', t); return { size: 1 } },
    async writeText(t: FsTargetLike, _c: string, _e?: unknown, _s?: unknown, p?: unknown) { record('writeText', t); return { policy: p } },
    async editText(t: FsTargetLike, _e: unknown) { record('editText', t); return { ok: true } },
  } as FsInnerLike
  return { inner, calls }
}

/** Call one read member through the wrapped proxy (thrown errors stay thrown). */
function readVia(wrapped: FsInnerLike, method: FsReadMethod, targetValue: FsTargetLike): unknown {
  const fn = (wrapped as unknown as Record<string, (value: FsTargetLike) => unknown>)[method]
  if (typeof fn !== 'function') throw new Error(`the wrapper does not declare ${method}`)
  return fn.call(wrapped, targetValue)
}

/** The read-side deps: a fallback policy supplies the base for relative rules. */
const readDeps = (config: ReturnType<typeof normalizeConfig>) => ({
  readConfig: () => config,
  fallbackPolicy: () => writePolicy,
})

// NOTE on the relative spellings below: a bare single-component name
// (`secrets`, `generated`) is a NAME RULE by design — it matches that component
// at ANY depth (see the name-rule suite at the bottom). These fixtures mean one
// literal `<workspace>/<name>` path, which is the `./name` spelling (it contains
// a separator and therefore stays a normal relative path).
const denySecrets = normalizeConfig({ paths: [{ path: './secrets', access: 'deny' }] })
const readTarget = (name = 'key'): FsTargetLike => ({ targetKey: join(secrets, name), displayPath: join(secrets, name) })

describe('wrapFs deny reads', () => {
  it('refuses all six content/list/watch reads before the backend is touched', () => {
    const { inner, calls } = readStub()
    const wrapped = wrapFs(inner, readDeps(denySecrets))
    for (const method of READ_METHODS) {
      let error: unknown
      try {
        readVia(wrapped, method, readTarget())
      } catch (caught) {
        error = caught
      }
      expect(error, `${method} must refuse`).toBeInstanceOf(AccessDeniedError)
      expect((error as AccessDeniedError).code).toBe(ACCESS_DENIED_CODE)
      expect((error as Error).message).toContain('cannot read')
      // The message names the RULE spelling, which after the bare-name split is
      // `./secrets` (a bare `secrets` would be a name rule, see the suite below).
      expect((error as Error).message).toContain('"./secrets"')
    }
    expect(calls).toEqual([])
  })

  it('lets every read through for an allowed path and returns the backend value', async () => {
    const { inner, calls } = readStub()
    const wrapped = wrapFs(inner, readDeps(denySecrets))
    const allowed = target(join(notes, 'a.md'))
    await expect(readVia(wrapped, 'readText', allowed)).resolves.toBe('text')
    await expect(readVia(wrapped, 'streamText', allowed)).resolves.toEqual(['chunk'])
    await expect(readVia(wrapped, 'readBytes', allowed)).resolves.toBeInstanceOf(Uint8Array)
    await expect(readVia(wrapped, 'readByteRange', allowed)).resolves.toBeInstanceOf(Uint8Array)
    await expect(readVia(wrapped, 'listDir', allowed)).resolves.toEqual([])
    await expect(readVia(wrapped, 'watch', allowed)).resolves.toBeTruthy()
    expect(calls).toHaveLength(READ_METHODS.length)
  })

  it('uses the display spelling in the message but the canonical identity for the match', () => {
    const { inner } = readStub()
    const wrapped = wrapFs(inner, readDeps(denySecrets))
    const aliased: FsTargetLike = { targetKey: join(secrets, 'key'), displayPath: '/a/friendly/spelling' }
    expect(() => readVia(wrapped, 'readText', aliased)).toThrow(/"\/a\/friendly\/spelling"/)
  })

  it('keeps the documented metadata boundary: stat/resolve are NOT intercepted', async () => {
    const { inner, calls } = readStub()
    const wrapped = wrapFs(inner, readDeps(denySecrets))
    await expect((wrapped as unknown as { stat(t: FsTargetLike): Promise<unknown> }).stat(readTarget())).resolves.toEqual({ size: 1 })
    await expect(wrapped.resolve(join(secrets, 'key'))).resolves.toMatchObject({ targetKey: join(secrets, 'key') })
    expect(calls.map(call => call.method)).toEqual(['stat'])
  })

  it('applies only to the fs surface: a shell-only deny rule does not block reads', async () => {
    const shellOnly = normalizeConfig({ paths: [{ path: './secrets', access: 'deny', surfaces: ['shell'] }] })
    const { inner, calls } = readStub()
    const wrapped = wrapFs(inner, readDeps(shellOnly))
    await expect(readVia(wrapped, 'readText', readTarget())).resolves.toBe('text')
    expect(calls).toHaveLength(1)
  })

  it('resolves relative deny rules against the fallback policy workspace (best effort)', async () => {
    // With a fallback policy the relative rule is live; without one the base is
    // the plugin process cwd, so the read is NOT refused — the tool guard is what
    // resolves relative rules against the SESSION cwd.
    const withFallback = readStub()
    expect(() => readVia(wrapFs(withFallback.inner, readDeps(denySecrets)), 'readText', readTarget())).toThrow(AccessDeniedError)
    const withoutFallback = readStub()
    const wrapped = wrapFs(withoutFallback.inner, { readConfig: () => denySecrets, fallbackPolicy: () => undefined })
    await expect(readVia(wrapped, 'readText', readTarget())).resolves.toBe('text')
  })

  it('adopts a revoked deny rule on the next read', async () => {
    let config = denySecrets
    const { inner } = readStub()
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => writePolicy })
    expect(() => readVia(wrapped, 'readText', readTarget())).toThrow(AccessDeniedError)
    config = normalizeConfig(undefined)
    await expect(readVia(wrapped, 'readText', readTarget())).resolves.toBe('text')
  })

  it('only overrides read methods the inner service declares', () => {
    const { inner } = innerStub()
    const wrapped = wrapFs(inner, deps())
    expect(wrapped.readText).toBeUndefined()
    expect(wrapped.listDir).toBeUndefined()
    expect(wrapped.watch).toBeUndefined()
  })
})

// ── hard rules: deny / read-only writes ─────────────────────────────────────

const denyWriteConfig = normalizeConfig({ paths: [{ path: './secrets', access: 'deny' }] })
const readOnlyGenerated = normalizeConfig({ paths: [{ path: './generated', access: 'read' }] })

describe('wrapFs hard rules on writes', () => {
  it('refuses a write covered by a deny rule before the backend is touched', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(denyWriteConfig))
    const error = await rejection(wrapped.writeText(target(join(secrets, 'a.md')), 'x', undefined, undefined, writePolicy))
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect((error as AccessDeniedError).code).toBe(ACCESS_DENIED_CODE)
    expect((error as Error).message).toContain('cannot write')
    expect((error as Error).message).toContain('access: deny')
    expect(calls).toEqual([])
  })

  it('refuses EVERY mutation shape on a denied target, including the 0.2.2 three', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, readDeps(denyWriteConfig))
    const denied = target(join(secrets, 'a.md'))
    for (const call of [
      () => wrapped.writeText(denied, 'x', undefined, undefined, writePolicy),
      () => wrapped.editText(denied, { find: 'a', replace: 'b' }, undefined, undefined, writePolicy),
      () => wrapped.patchText!(denied, [], undefined, undefined, writePolicy),
      () => wrapped.deleteFile!(denied, undefined, undefined, writePolicy),
      () => wrapped.moveFile!(target(join(notes, 'a.md')), denied, undefined, undefined, writePolicy),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(AccessDeniedError)
    }
    expect(calls).toEqual([])
  })

  it('lets deny win over a broader writable ancestor', async () => {
    mkdirSync(join(notes, 'private'), { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: notes, scope: 'write' },
      { path: join(notes, 'private'), access: 'deny' },
    ] })
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(config))
    const error = await rejection(wrapped.writeText(target(join(notes, 'private', 'a.md')), 'x', undefined, undefined, writePolicy))
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('downgrades a read-only path INSIDE the writable workspace', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(readOnlyGenerated))
    const error = await rejection(wrapped.writeText(target(join(generated, 'out.js')), 'x', undefined, undefined, writePolicy))
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect((error as Error).message).toContain('configured read-only')
    expect((error as Error).message).toContain('access: read')
    expect(calls).toEqual([])
  })

  it('allows a write outside the read-only path (no false positive)', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(readOnlyGenerated))
    await wrapped.writeText(target(join(base, 'other.md')), 'x', undefined, undefined, writePolicy)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.policy).toBe(writePolicy)
  })

  it('keeps a deny rule under danger-full-access', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(denyWriteConfig))
    await expect(wrapped.writeText(target(join(secrets, 'a.md')), 'x', undefined, undefined, dangerPolicy))
      .rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('keeps a read-only rule under danger-full-access', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(readOnlyGenerated))
    await expect(wrapped.writeText(target(join(generated, 'out.js')), 'x', undefined, undefined, dangerPolicy))
      .rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('still delegates a hard-rule-free target under danger-full-access', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(readOnlyGenerated))
    await wrapped.writeText(target(join(base, 'other.md')), 'x', undefined, undefined, dangerPolicy)
    expect(calls[0]?.policy).toBe(dangerPolicy)
  })

  it('checks both ends of a move against deny rules', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, readDeps(denyWriteConfig))
    const destinationError = await rejection(
      wrapped.moveFile!(target(join(notes, 'a.md')), target(join(secrets, 'b.md')), undefined, undefined, writePolicy),
    )
    expect((destinationError as Error).message).toContain(join(secrets, 'b.md'))
    const sourceError = await rejection(
      wrapped.moveFile!(target(join(secrets, 'a.md')), target(join(notes, 'b.md')), undefined, undefined, writePolicy),
    )
    expect((sourceError as Error).message).toContain(join(secrets, 'a.md'))
    expect(calls).toEqual([])
  })

  it('checks both ends of a move against read-only rules', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, readDeps(readOnlyGenerated))
    await expect(
      wrapped.moveFile!(target(join(generated, 'a.js')), target(join(base, 'b.js')), undefined, undefined, writePolicy),
    ).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(
      wrapped.moveFile!(target(join(base, 'a.js')), target(join(generated, 'b.js')), undefined, undefined, writePolicy),
    ).rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('checks both ends of a move under danger-full-access too', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, readDeps(denyWriteConfig))
    await expect(
      wrapped.moveFile!(target(join(secrets, 'a.md')), target(join(notes, 'b.md')), undefined, undefined, dangerPolicy),
    ).rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
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

// ── name rules: a bare name matches at any depth ───────────────────────────
// `.git | deny` is a NAME RULE: it applies to `<scope-root>/**/.git` and its
// whole subtree on EVERY call, matched lexically against the fresh canonical
// target (no filesystem walk on the fs hot path). The fixtures above already
// contain `<base>/repo/.git`; `external` is a configured writable root OUTSIDE
// the workspace, which the name rule's scope also covers.

/** `.git` at any depth: the canonical bare-name deny fixture. */
const denyGitName = normalizeConfig({ paths: [{ path: '.git', access: 'deny' }] })
/** `.git` read-only: reads pass, writes are downgraded. */
const readGitName = normalizeConfig({ paths: [{ path: '.git', access: 'read' }] })

/** Read the git config through the wrapped service, whatever the read method. */
function readGitVia(wrapped: FsInnerLike, method: FsReadMethod, targetValue: FsTargetLike): unknown {
  return readVia(wrapped, method, targetValue)
}

describe('wrapFs name rules (bare names)', () => {
  it('refuses content reads whose path contains a denied name component', () => {
    const { inner, calls } = readStub()
    const wrapped = wrapFs(inner, readDeps(denyGitName))
    for (const method of ['readText', 'streamText', 'listDir'] as const) {
      let error: unknown
      try {
        readGitVia(wrapped, method, { targetKey: join(repoGit, 'config'), displayPath: join(repoGit, 'config') })
      } catch (caught) {
        error = caught
      }
      expect(error, `${method} must refuse a denied name component`).toBeInstanceOf(AccessDeniedError)
      expect((error as AccessDeniedError).code).toBe(ACCESS_DENIED_CODE)
      // The rule spelling (not the literal path) is what the user must see: the
      // configured `.git` matches every repository, so naming the matched path
      // alone would look like an unrelated rule fired.
      expect((error as Error).message).toContain('cannot read')
      expect((error as Error).message).toContain('".git"')
    }
    expect(calls).toEqual([])
  })

  it('refuses writes under a denied name component before the backend is touched', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(denyGitName))
    const error = await rejection(
      wrapped.writeText(target(join(repoGit, 'config')), 'x', undefined, undefined, writePolicy),
    )
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect((error as Error).message).toContain('cannot write')
    expect((error as Error).message).toContain('".git"')
    expect((error as Error).message).toContain('access: deny')
    expect(calls).toEqual([])
  })

  it('keeps a denied name rule under danger-full-access (it is a hard rule)', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(denyGitName))
    await expect(
      wrapped.writeText(target(join(repoGit, 'config')), 'x', undefined, undefined, dangerPolicy),
    ).rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('downgrades a write under a read-only name component', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(readGitName))
    const error = await rejection(
      wrapped.writeText(target(join(repoGit, 'config')), 'x', undefined, undefined, writePolicy),
    )
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect((error as Error).message).toContain('configured read-only')
    expect((error as Error).message).toContain('".git"')
    expect((error as Error).message).toContain('access: read')
    expect(calls).toEqual([])
  })

  it('applies to a name component that does not exist yet (lexical, no walk)', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(denyGitName))
    // `fresh/` does not exist: the match must come from the components of the
    // freshly canonicalised key, not from a directory listing.
    await expect(
      wrapped.writeText(target(join(base, 'fresh', '.git', 'config')), 'x', undefined, undefined, writePolicy),
    ).rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('leaves a name component OUTSIDE the scope roots alone', async () => {
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-outside-')))
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, readDeps(denyGitName))
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(outside, 'repo', '.git', 'config')), 'x', undefined, undefined, policy)
    // No grant matched either, so the caller policy passes through untouched and
    // the base fence remains the only gate.
    expect(calls[0]?.policy).toBe(policy)
  })

  it('extends the name-rule scope to a configured writable root outside the workspace', async () => {
    const config = normalizeConfig({ paths: [
      { path: external, scope: 'write' },
      { path: '.git', access: 'deny' },
    ] })
    const denyTarget = target(join(external, 'proj', '.git', 'config'))
    const { inner: readInner, calls: readCalls } = readStub()
    const readWrapped = wrapFs(readInner, readDeps(config))
    expect(() => readVia(readWrapped, 'readText', denyTarget)).toThrow(AccessDeniedError)
    expect(readCalls).toEqual([])
    const { inner, calls } = innerStub()
    const writeWrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => writePolicy })
    await expect(writeWrapped.writeText(denyTarget, 'x', undefined, undefined, writePolicy))
      .rejects.toBeInstanceOf(AccessDeniedError)
    expect(calls).toEqual([])
  })

  it('applies only to the fs surface: a shell-only deny name rule does not block reads', async () => {
    const shellOnly = normalizeConfig({ paths: [{ path: '.git', access: 'deny', surfaces: ['shell'] }] })
    const { inner, calls } = readStub()
    const wrapped = wrapFs(inner, readDeps(shellOnly))
    await expect(readVia(wrapped, 'readText', { targetKey: join(repoGit, 'config'), displayPath: join(repoGit, 'config') }))
      .resolves.toBe('text')
    expect(calls).toHaveLength(1)
  })

  it('grants a write under a matched name component, stamping that component as the root', async () => {
    const { inner, calls } = innerStub()
    const grantName = normalizeConfig({ paths: [{ path: 'node_modules', access: 'write' }] })
    const wrapped = wrapFs(inner, readDeps(grantName))
    const matched = join(base, 'pkg', 'node_modules')
    await wrapped.writeText(target(join(matched, 'lib', 'a.js')), 'x', undefined, undefined, writePolicy)
    // The matched COMPONENT (not the workspace root) is the effective root: that
    // is what makes one configured name cover every checkout.
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: matched })
  })

  it('honours the mode gate for name grants: write needs workspace-write, always-write survives', async () => {
    const readOnly = { mode: 'read-only', workspaceRoot: base } as const
    const writeName = normalizeConfig({ paths: [{ path: 'node_modules', access: 'write' }] })
    const writeCalls = innerStub()
    const writeWrapped = wrapFs(writeCalls.inner, readDeps(writeName))
    await writeWrapped.writeText(target(join(base, 'pkg', 'node_modules', 'a.js')), 'x', undefined, undefined, readOnly)
    expect(writeCalls.calls[0]?.policy).toBe(readOnly)

    const alwaysName = normalizeConfig({ paths: [{ path: 'node_modules', access: 'always-write' }] })
    const alwaysCalls = innerStub()
    const alwaysWrapped = wrapFs(alwaysCalls.inner, readDeps(alwaysName))
    await alwaysWrapped.writeText(target(join(base, 'pkg', 'node_modules', 'a.js')), 'x', undefined, undefined, readOnly)
    expect(alwaysCalls.calls[0]?.policy).toMatchObject({
      mode: 'workspace-write',
      workspaceRoot: join(base, 'pkg', 'node_modules'),
    })
  })

  it('grants BOTH matched name components for a move between them (cross-root handling)', async () => {
    const first = join(base, 'cache-a', '.cache')
    const second = join(base, 'cache-b', '.cache')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    const { inner, calls } = mutationStub()
    const wrapName = normalizeConfig({ paths: [{ path: '.cache', access: 'write' }] })
    const wrapped = wrapFs(inner, { readConfig: () => wrapName, fallbackPolicy: () => undefined })
    await wrapped.moveFile!(target(join(first, 'x')), target(join(second, 'y')), undefined, undefined, writePolicy)
    // Two matched components are two DIFFERENT configured roots: one policy
    // carries the union through `additionalWritableRoots` (0.2.2+).
    expect(calls[0]?.policy).toEqual({
      mode: 'workspace-write',
      workspaceRoot: first,
      additionalWritableRoots: [second],
    })
  })

  it('stamps a move WITHIN one matched name component with that component alone', async () => {
    const cache = join(base, 'cache-c', '.cache')
    mkdirSync(cache, { recursive: true })
    const { inner, calls } = mutationStub()
    const wrapName = normalizeConfig({ paths: [{ path: '.cache', access: 'always-write' }] })
    const wrapped = wrapFs(inner, { readConfig: () => wrapName, fallbackPolicy: () => undefined })
    const policy = { mode: 'read-only', workspaceRoot: base } as const
    await wrapped.moveFile!(target(join(cache, 'a')), target(join(cache, 'b')), undefined, undefined, policy)
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: cache })
  })

  it('prefers a matching LITERAL grant over a matching name rule', async () => {
    const { inner, calls } = innerStub()
    // The workspace itself is a literal grant; the name rule would stamp the
    // deeper `.git` component. The literal (more specific statement of intent)
    // wins, keeping the established literal-grant behavior byte-identical.
    const config = normalizeConfig({ paths: [
      { path: base, scope: 'write' },
      { path: '.git', access: 'write' },
    ] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    await wrapped.writeText(target(join(repoGit, 'config')), 'x', undefined, undefined, writePolicy)
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: base })
  })

  it('checks BOTH ends of a move against a denied name component', async () => {
    const { inner, calls } = mutationStub()
    const wrapped = wrapFs(inner, readDeps(denyGitName))
    const sourceError = await rejection(
      wrapped.moveFile!(target(join(repoGit, 'a')), target(join(base, 'b')), undefined, undefined, writePolicy),
    )
    expect((sourceError as Error).message).toContain(join(repoGit, 'a'))
    const destinationError = await rejection(
      wrapped.moveFile!(target(join(base, 'a')), target(join(repoGit, 'b')), undefined, undefined, writePolicy),
    )
    expect((destinationError as Error).message).toContain(join(repoGit, 'b'))
    expect(calls).toEqual([])
  })
})
