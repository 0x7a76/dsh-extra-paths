import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { isConfiningSandbox, wrapSandbox, type ConfinedArgvLike, type SandboxInnerLike } from '../src/wrap-sandbox.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const notes = join(base, 'notes')
mkdirSync(notes)

const seatbeltConfined = (command: readonly string[]): ConfinedArgvLike => ({
  argv: ['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...command],
  enforcement: 'full',
  denialSignatures: ['operation not permitted'],
  runnerFailureRules: [],
})

/**
 * The providers in this DSH version are SYNCHRONOUS: callers do
 * `sandbox.confine(argv, policy).argv` without awaiting, so the double must be
 * synchronous too — an `async` double is what let the real defect through.
 */
function stub(argv = ['echo', 'hi']) {
  const inner = {
    confine: vi.fn((): ConfinedArgvLike => seatbeltConfined(argv)),
  } as unknown as SandboxInnerLike
  return { inner, argv }
}

/** Read the record the way production does, and fail loudly if a thenable came back. */
function record(value: ConfinedArgvLike | Promise<ConfinedArgvLike>): ConfinedArgvLike {
  if (typeof (value as PromiseLike<unknown>).then === 'function') {
    throw new Error('wrapSandbox returned a thenable for a synchronous provider')
  }
  return value as ConfinedArgvLike
}

const config = (scope: 'write' | 'always-write' = 'write') =>
  normalizeConfig({ paths: [{ path: notes, scope, surfaces: ['shell'] }] })

describe('wrapSandbox', () => {
  it('answers synchronously, the way its callers read it', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    // The regression pin for the defect that broke every confined process:
    // `.argv` must be readable off the call itself, not off a promise.
    expect(result).not.toBeInstanceOf(Promise)
    expect(record(result).argv).toHaveLength(argv.length + 4)
    expect(record(result).argv[0]).toBe('sandbox-exec')
  })

  it('still supports a provider that answers with a thenable', async () => {
    const { argv } = stub()
    const inner = {
      confine: vi.fn(async (): Promise<ConfinedArgvLike> => seatbeltConfined(argv)),
    } as unknown as SandboxInnerLike
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = await wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
  })

  it('widens the profile for a matching root', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn })
    const result = record(wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base }))
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves read-only alone for a write-scope root', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = record(wrapped.confine(argv, { mode: 'read-only', workspaceRoot: base }))
    expect(result.argv[2]).not.toContain('subpath')
  })

  it('widens read-only for an always-write root', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config('always-write'), warn: vi.fn() })
    const result = record(wrapped.confine(argv, { mode: 'read-only', workspaceRoot: base }))
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
  })

  it('warns and grants nothing when the dialect is unrecognised', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn })
    inner.confine = vi.fn((): ConfinedArgvLike => ({
      argv: ['windows-acl-run', '--workspace', base, '--', ...argv],
      enforcement: 'partial',
      denialSignatures: ['access is denied'],
      runnerFailureRules: [],
    }))
    const result = record(wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base }))
    expect(result.argv).toHaveLength(argv.length + 4)
    expect(warn).toHaveBeenCalledOnce()
    // The warning must name the runner, or the user cannot tell which command
    // ran without their configured roots.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('windows-acl-run'))
  })

  it('preserves the runner metadata verbatim', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = record(wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base }))
    // Losing these would make the consumer read "denied by the sandbox" as
    // "the command itself failed".
    expect(result.enforcement).toBe('full')
    expect(result.denialSignatures).toEqual(['operation not permitted'])
    expect(result.runnerFailureRules).toEqual([])
  })

  it('delegates unchanged under danger-full-access', () => {
    const { inner, argv } = stub()
    // always-write on purpose: a `write`-scope root is never granted outside
    // workspace-write, which would make this case pass without the guard.
    const wrapped = wrapSandbox(inner, { readConfig: () => config('always-write'), warn: vi.fn() })
    const result = record(wrapped.confine(argv, { mode: 'danger-full-access', workspaceRoot: base }))
    expect(result.argv).toEqual(['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...argv])
  })

  it('passes argv and the policy through, and any third argument with them', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    const controller = new AbortController()
    wrapped.confine(argv, policy, controller.signal)
    expect(inner.confine).toHaveBeenCalledWith(argv, policy, controller.signal)
  })

  it('forwards other members untouched', () => {
    const { inner } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    // Same identity contract as the fs wrapper: the interceptor is built once.
    expect(wrapped.confine).toBe(wrapped.confine)
    expect(wrapped.constructor).toBe(inner.constructor)
    expect(isConfiningSandbox(wrapped)).toBe(true)
    expect(isConfiningSandbox({})).toBe(false)
  })
})
