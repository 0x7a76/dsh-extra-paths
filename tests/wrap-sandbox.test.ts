/**
 * The shell half: widen a confined argv with the configured shell-surface rules,
 * record the runner dialect the host really uses, and warn HONESTLY (once) when
 * that dialect cannot express a restriction.
 *
 * THE SYNC-NESS PINS ARE REGRESSIONS, not style: 0.1.5 callers read `.argv` off
 * the return value without awaiting, so an `async` wrapper there yields
 * `undefined` and every confined process dies. The thenable test keeps 0.2.x
 * callers (who await) working from the same body.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { clearNameRuleCache } from '../src/resolve.js'
import { observedShellDialect, resetObservedShellDialect } from '../src/shell-dialect.js'
import {
  isConfiningSandbox,
  resetShellWarnings,
  wrapSandbox,
  type ConfinedArgvLike,
  type SandboxInnerLike,
} from '../src/wrap-sandbox.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const notes = join(base, 'notes')
const secrets = join(base, 'secrets')
mkdirSync(notes)
mkdirSync(secrets)

// Name-rule fixtures. `.git` lives two levels below the workspace root (the
// shape a bare-name rule exists for); `.env` is a FILE, which a name rule must
// match like a directory. `leftoverLink` is the symlink the incomplete-expansion
// case adds later (a sandbox cannot mask a link, so the walk refuses to claim
// exhaustiveness).
const repoGit = join(base, 'repo', '.git')
const envFile = join(base, 'proj', '.env')
mkdirSync(repoGit, { recursive: true })
mkdirSync(join(base, 'proj'), { recursive: true })
writeFileSync(envFile, 'TOKEN=x')

beforeEach(() => {
  resetShellWarnings()
  resetObservedShellDialect()
  // Name-rule walks are cached for 30s: a fresh directory (or a symlink) created
  // by one case must be seen by the next one.
  clearNameRuleCache()
})

const seatbeltConfined = (command: readonly string[]): ConfinedArgvLike => ({
  argv: ['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...command],
  enforcement: 'full',
  denialSignatures: ['operation not permitted'],
  runnerFailureRules: [],
})

const bwrapConfined = (command: readonly string[]): ConfinedArgvLike => ({
  argv: ['bwrap', '--ro-bind', '/', '/', '--bind', base, base, '--', ...command],
  enforcement: 'full',
  denialSignatures: ['read-only file system'],
  runnerFailureRules: [],
})

const landlockConfined = (command: readonly string[]): ConfinedArgvLike => ({
  argv: ['landlock-run', '--ro', '/', '--rw', '/tmp', '--', ...command],
  enforcement: 'partial',
  denialSignatures: ['permission denied'],
  runnerFailureRules: [],
})

const windowsAclConfined = (command: readonly string[]): ConfinedArgvLike => ({
  argv: ['windows-acl-run', '--workspace', base, '--mode', 'workspace-write', '--', ...command],
  enforcement: 'partial',
  denialSignatures: ['access is denied'],
  runnerFailureRules: [],
})

/**
 * The providers in this DSH version are SYNCHRONOUS: callers do
 * `sandbox.confine(argv, policy).argv` without awaiting, so the double must be
 * synchronous too — an `async` double is what let the real defect through.
 */
function stub(argv = ['echo', 'hi'], record: ConfinedArgvLike = seatbeltConfined(argv)) {
  const inner = {
    confine: vi.fn((): ConfinedArgvLike => record),
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

/** Only restrictions: an fs-surface grant must not appear in the shell argv. */
const restricted = (access: 'read' | 'deny', path = secrets, surfaces: readonly ('fs' | 'shell')[] = ['shell']) =>
  normalizeConfig({ paths: [{ path, access, surfaces }] })

const shellPolicy = { mode: 'workspace-write', workspaceRoot: base } as const

describe('wrapSandbox sync/async mirroring and grants (existing behavior)', () => {
  it('answers synchronously, the way its callers read it', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = wrapped.confine(argv, shellPolicy)
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
    const result = await wrapped.confine(argv, shellPolicy)
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
  })

  it('widens the profile for a matching root', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn })
    const result = record(wrapped.confine(argv, shellPolicy))
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
      argv: ['sandbox-ssh', '--host', 'x', '--', ...argv],
      enforcement: 'partial',
      denialSignatures: ['access is denied'],
      runnerFailureRules: [],
    }))
    const result = record(wrapped.confine(argv, shellPolicy))
    expect(result.argv).toHaveLength(argv.length + 4)
    expect(warn).toHaveBeenCalledOnce()
    // The warning must name the runner, or the user cannot tell which command
    // ran without their configured roots.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sandbox-ssh'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOT granted'))
  })

  it('preserves the runner metadata verbatim', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = record(wrapped.confine(argv, shellPolicy))
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
    const policy = { ...shellPolicy }
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

describe('wrapSandbox dialect observation', () => {
  it('records the runner dialect on every confinement', () => {
    expect(observedShellDialect()).toBe('unknown')
    const { inner, argv } = stub(['echo'], bwrapConfined(['echo']))
    const wrapped = wrapSandbox(inner, { readConfig: () => normalizeConfig(undefined), warn: vi.fn() })
    record(wrapped.confine(argv, shellPolicy))
    expect(observedShellDialect()).toBe('bwrap')
  })

  it('records the dialect even when danger-full-access returns the record untouched', () => {
    const recordValue = bwrapConfined(['echo'])
    const { inner, argv } = stub(['echo'], recordValue)
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = record(wrapped.confine(argv, { mode: 'danger-full-access', workspaceRoot: base }))
    expect(result).toBe(recordValue)
    expect(observedShellDialect()).toBe('bwrap')
  })
})

describe('wrapSandbox shell restrictions', () => {
  it('appends a seatbelt deny for a shell deny rule, after the host allow', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => restricted('deny'), warn: vi.fn() })
    const result = record(wrapped.confine(argv, shellPolicy))
    const profile = result.argv[2] ?? ''
    expect(profile).toContain(`(deny file-read* (subpath "${secrets}"))`)
    expect(profile).toContain(`(deny file-write* (subpath "${secrets}"))`)
    // SBPL last-match-wins: the deny must come after the base profile's rules.
    expect(profile.indexOf('(deny file-read*')).toBeGreaterThan(profile.indexOf('(deny file-write*)'))
  })

  it('appends a seatbelt write-deny for a read-only rule (the downgrade reaches the shell)', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => restricted('read'), warn: vi.fn() })
    const result = record(wrapped.confine(argv, shellPolicy))
    expect(result.argv[2]).toContain(`(deny file-write* (subpath "${secrets}"))`)
    expect(result.argv[2]).not.toContain('(deny file-read*')
  })

  it('orders bwrap mounts: bind (grant) then ro-bind (read-only), deny last', () => {
    const command = ['echo']
    const { inner } = stub(command, bwrapConfined(command))
    const wrapped = wrapSandbox(inner, {
      readConfig: () => normalizeConfig({ paths: [
        { path: notes, scope: 'write', surfaces: ['shell'] },
        { path: secrets, access: 'read', surfaces: ['shell'] },
      ] }),
      warn: vi.fn(),
    })
    const result = record(wrapped.confine(command, shellPolicy))
    expect(result.argv).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind', base, base,
      '--bind', notes, notes,
      '--ro-bind', secrets, secrets,
      '--', ...command,
    ])
  })

  it('orders bwrap masks after the base bind and after our read-only mounts', () => {
    const command = ['echo']
    const { inner } = stub(command, bwrapConfined(command))
    const wrapped = wrapSandbox(inner, {
      readConfig: () => normalizeConfig({ paths: [
        { path: notes, access: 'read', surfaces: ['shell'] },
        { path: secrets, access: 'deny', surfaces: ['shell'] },
      ] }),
      warn: vi.fn(),
    })
    const result = record(wrapped.confine(command, shellPolicy))
    expect(result.argv).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind', base, base,
      '--ro-bind', notes, notes,
      '--mask', secrets,
      '--', ...command,
    ])
  })

  it('does not touch the argv for a rule scoped to the fs surface only', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => restricted('deny', secrets, ['fs']), warn })
    const result = record(wrapped.confine(argv, shellPolicy))
    expect(result.argv).toEqual(['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...argv])
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves the record untouched under danger-full-access even with restrictions configured', () => {
    const confined = seatbeltConfined(['echo'])
    const { inner, argv } = stub(['echo'], confined)
    const wrapped = wrapSandbox(inner, { readConfig: () => restricted('deny'), warn: vi.fn() })
    expect(record(wrapped.confine(argv, { mode: 'danger-full-access', workspaceRoot: base }))).toBe(confined)
  })
})

describe('wrapSandbox unsupported dialects warn honestly, once', () => {
  it('landlock: grants are expressible but restrictions are not — refuses nothing, warns once', () => {
    const command = ['echo']
    const recordValue = landlockConfined(command)
    const { inner } = stub(command, recordValue)
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => restricted('deny'), warn })
    const result = record(wrapped.confine(command, shellPolicy))
    expect(result.argv).toBe(recordValue.argv)
    expect(result.argv).not.toContain('--deny')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('landlock'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fs tools'))
  })

  it('landlock: the warning is deduplicated across calls and wrapper instances', () => {
    const command = ['echo']
    const { inner } = stub(command, landlockConfined(command))
    const warn = vi.fn()
    const readConfig = () => restricted('deny')
    const first = wrapSandbox(inner, { readConfig, warn })
    record(first.confine(command, shellPolicy))
    record(first.confine(command, shellPolicy))
    // A host that re-reads ctx.sandbox may hand out a NEW wrapper; the dedupe key
    // lives at module scope so the log still does not flood.
    const second = wrapSandbox(inner, { readConfig, warn })
    record(second.confine(command, shellPolicy))
    expect(warn).toHaveBeenCalledOnce()
  })

  it('landlock: a DIFFERENT rule signature warns again (the capability loss changed)', () => {
    const warn = vi.fn()
    const command = ['echo']
    let config = restricted('deny', secrets, ['shell'])
    const { inner } = stub(command, landlockConfined(command))
    const wrapped = wrapSandbox(inner, { readConfig: () => config, warn })
    record(wrapped.confine(command, shellPolicy))
    expect(warn).toHaveBeenCalledOnce()
    config = restricted('read', notes, ['shell'])
    record(wrapped.confine(command, shellPolicy))
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]?.[0]).toContain('deny shell reads')
    expect(warn.mock.calls[1]?.[0]).toContain('read-only paths')
  })

  it('windows-acl: nothing is appended and the dialect is reported once, naming the runner', () => {
    const command = ['echo']
    const recordValue = windowsAclConfined(command)
    const { inner } = stub(command, recordValue)
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn })
    const result = record(wrapped.confine(command, shellPolicy))
    expect(result.argv).toBe(recordValue.argv)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('windows-acl'))
    record(wrapped.confine(command, shellPolicy))
    expect(warn).toHaveBeenCalledOnce()
  })
})

// ── name rules: fs-only BY DESIGN ──────────────────────────────────────────
// A sandbox profile can only name CONCRETE paths, and expanding a bare name into
// "the paths it matches right now" was costly, stale by up to the cache TTL and
// partial whenever one writable root was deep or unreadable (the real host hit
// exactly that). Name rules therefore stay on the fs surface, where the match is
// lexical and live; the shell wrapper leaves the argv untouched and tells the
// user ONCE that a configured `shell` surface on a name rule is not enforced.

/** A config holding one bare-name rule, plus optional literal rules. */
const nameConfig = (
  path: string,
  access: 'deny' | 'read' | 'write' | 'always-write',
  extra: { path: string; access: 'deny'; surfaces: readonly ('fs' | 'shell')[] }[] = [],
) => normalizeConfig({ paths: [{ path, access, surfaces: ['shell'] as const }, ...extra] })

describe('wrapSandbox name rules (fs-only)', () => {
  it('leaves the seatbelt argv untouched for a name rule and warns once that it is fs-only', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => nameConfig('.git', 'deny'), warn })
    expect(record(wrapped.confine(argv, shellPolicy)).argv).toEqual([
      'sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...argv,
    ])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('restrict the fs tools only'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOT restricted'))
    // No repeated log line on every command.
    record(wrapped.confine(argv, shellPolicy))
    expect(warn).toHaveBeenCalledOnce()
  })

  it('stays silent for a name rule configured for the fs surface only', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const config = normalizeConfig({ paths: [{ path: '.git', access: 'deny', surfaces: ['fs'] }] })
    const wrapped = wrapSandbox(inner, { readConfig: () => config, warn })
    expect(record(wrapped.confine(argv, shellPolicy)).argv).toEqual([
      'sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...argv,
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('never masks a name rule in bwrap either', () => {
    const command = ['echo']
    const { inner } = stub(command, bwrapConfined(command))
    const wrapped = wrapSandbox(inner, { readConfig: () => nameConfig('.git', 'deny'), warn: vi.fn() })
    expect(record(wrapped.confine(command, shellPolicy)).argv).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind', base, base, '--', ...command,
    ])
  })

  it('still appends a literal rule that sits beside a name rule', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, {
      readConfig: () => nameConfig('.git', 'deny', [{ path: secrets, access: 'deny', surfaces: ['shell'] }]),
      warn,
    })
    const profile = record(wrapped.confine(argv, shellPolicy)).argv[2] ?? ''
    expect(profile).toContain(`(deny file-read* (subpath "${secrets}"))`)
    expect(profile).not.toContain(repoGit)
    // The fs-only notice still fires (the name rule asked for the shell surface).
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('restrict the fs tools only'))
  })

  it('does not warn about name rules under danger-full-access (there is no shell sandbox at all)', () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => nameConfig('.git', 'deny'), warn })
    const danger = { mode: 'danger-full-access', workspaceRoot: base } as const
    // The fake provider still returns a confined-looking record; what matters is
    // that the wrapper does not append anything and does not warn in this mode.
    expect(record(wrapped.confine(argv, danger)).argv).toEqual(
      ['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...argv],
    )
    expect(warn).not.toHaveBeenCalled()
  })
})
