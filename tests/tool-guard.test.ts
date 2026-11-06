/**
 * The tool-layer deny seam.
 *
 * `grep`/`glob` spawn the host's bundled ripgrep and never touch `ctx.fs`, so
 * the fs proxy cannot refuse them. `ctx.tools.guard` is the documented
 * parameter-level seam: a synchronous reason string refuses the call before
 * dispatch. These tests pin both halves — the pure `guardReason` decision and the
 * feature-detected registration.
 */
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig, type ExtraPathsConfig } from '../src/config.js'
import {
  extractPathCandidates,
  guardReason,
  installToolGuard,
  type ToolExecutionLike,
  type ToolGuardDeps,
  type ToolServiceLike,
} from '../src/tool-guard.js'

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const secrets = join(base, 'secrets')
const notes = join(base, 'notes')
mkdirSync(secrets)
mkdirSync(notes)

/** A live configuration source the tests can swap (live re-reads are pinned). */
function depsOf(config: ExtraPathsConfig, warn = vi.fn()): ToolGuardDeps & { warn: ReturnType<typeof vi.fn> } {
  return { readConfig: () => config, warn }
}

const denyConfig = normalizeConfig({ paths: [{ path: './secrets', access: 'deny' }] })

/** One execution as the host hands it to the guard, in the session's workspace. */
function execution(name: string, args: unknown, cwd: string | undefined = base): ToolExecutionLike {
  return {
    name,
    arguments: args,
    ...(cwd === undefined ? {} : { agent: { session: { header: { cwd } } } }),
  }
}

describe('extractPathCandidates', () => {
  it('collects strings and string arrays under the documented argument names', () => {
    expect(extractPathCandidates({ path: 'a', pattern: 'needle' })).toEqual(['a'])
    expect(extractPathCandidates({ file_path: 'b' })).toEqual(['b'])
    expect(extractPathCandidates({ paths: ['c', 'd'] })).toEqual(['c', 'd'])
    expect(extractPathCandidates({ targets: ['e'], directory: 'f', cwd: 'g', workdir: 'h', dir: 'i' }))
      .toEqual(['e', 'f', 'g', 'h', 'i'])
  })

  it('walks one nested level for batch shapes and objects under path keys', () => {
    expect(extractPathCandidates({ files: [{ path: 'a' }, { file_path: 'b' }] })).toEqual(['a', 'b'])
    expect(extractPathCandidates({ target: { path: 'c' } })).toEqual(['c'])
    // Two levels is the documented recursion limit: a deeper key is not guessed.
    expect(extractPathCandidates({ a: { b: { c: { path: 'too-deep' } } } })).toEqual([])
  })

  it('ignores non-path keys, empty strings and duplicates', () => {
    expect(extractPathCandidates({ content: '/not/a/path', pattern: 'x' })).toEqual([])
    expect(extractPathCandidates({ path: '  ' })).toEqual([])
    expect(extractPathCandidates({ path: 'a', targets: ['a'] })).toEqual(['a'])
  })
})

describe('guardReason', () => {
  it('refuses grep with an explicit denied path, naming tool, path and rule', () => {
    const reason = guardReason(execution('grep', { pattern: 'PRIVATE', path: secrets }), depsOf(denyConfig))
    expect(reason).toBeDefined()
    expect(reason).toContain('grep')
    // The message names the RULE spelling: `./secrets` is the literal relative
    // path (a bare `secrets` is a name rule now, see the name-rule suite below).
    expect(reason).toContain('"./secrets"')
    expect(reason).toContain('denied by the extra-paths rule')
    expect(reason).toContain('access: deny')
  })

  it('refuses glob with a relative path resolved against the SESSION cwd', () => {
    const reason = guardReason(execution('glob', { pattern: '*.pem', path: 'secrets/certs' }), depsOf(denyConfig))
    expect(reason).toContain('glob')
    expect(reason).toContain('secrets/certs')
  })

  it('refuses a path under a denied directory reached through a symlink spelling', () => {
    const reason = guardReason(execution('read', { path: join(base, 'secrets', '..', 'secrets', 'key') }), depsOf(denyConfig))
    expect(reason).toBeDefined()
  })

  it('checks string arrays and nested batch shapes too', () => {
    const deps = depsOf(denyConfig)
    expect(guardReason(execution('multi_read', { paths: [join(notes, 'a'), join(secrets, 'b')] }), deps)).toBeDefined()
    expect(guardReason(execution('multi_read', { files: [{ path: join(secrets, 'c') }] }), deps)).toBeDefined()
  })

  it('keeps allowed paths and path-free tools out of it (no false positives)', () => {
    const deps = depsOf(denyConfig)
    expect(guardReason(execution('grep', { path: notes }), deps)).toBeUndefined()
    expect(guardReason(execution('glob', { path: join(base, 'secrets-backup') }), deps)).toBeUndefined()
    expect(guardReason(execution('todo_write', { items: [{ text: 'x' }] }), deps)).toBeUndefined()
    expect(guardReason(execution('grep', {}), deps)).toBeUndefined()
  })

  it('resolves an ABSOLUTE candidate even without a session cwd', () => {
    const reason = guardReason(execution('grep', { path: join(secrets, 'k') }, undefined), depsOf(denyConfig))
    expect(reason).toBeDefined()
  })

  it('follows the live configuration: removing the deny rule lifts the guard', () => {
    let config = denyConfig
    const deps: ToolGuardDeps = { readConfig: () => config, warn: vi.fn() }
    expect(guardReason(execution('grep', { path: secrets }), deps)).toBeDefined()
    config = normalizeConfig(undefined)
    expect(guardReason(execution('grep', { path: secrets }), deps)).toBeUndefined()
  })

  it('does not deny reads for a read-only rule (reads are allowed by design)', () => {
    const readOnly = normalizeConfig({ paths: [{ path: './secrets', access: 'read' }] })
    expect(guardReason(execution('grep', { path: secrets }), depsOf(readOnly))).toBeUndefined()
  })

  it('does not deny a tool for a rule scoped to the shell surface only', () => {
    const shellOnly = normalizeConfig({ paths: [{ path: './secrets', access: 'deny', surfaces: ['shell'] }] })
    expect(guardReason(execution('grep', { path: secrets }), depsOf(shellOnly))).toBeUndefined()
  })

  it('never throws: a failing config source, cyclic arguments and junk arguments mean no opinion', () => {
    const throwing: ToolGuardDeps = {
      readConfig: () => { throw new Error('config exploded') },
      warn: vi.fn(),
    }
    expect(guardReason(execution('grep', { path: secrets }), throwing)).toBeUndefined()
    const cyclic: Record<string, unknown> = { path: 'a' }
    cyclic['self'] = cyclic
    expect(() => guardReason(execution('grep', cyclic), depsOf(denyConfig))).not.toThrow()
    expect(guardReason(execution('grep', 'not-an-object'), depsOf(denyConfig))).toBeUndefined()
    expect(guardReason(execution('grep', null), depsOf(denyConfig))).toBeUndefined()
  })
})

// ── registration ────────────────────────────────────────────────────────────

interface InstallDouble {
  readonly ctx: { inject(names: readonly string[], callback: (scope: unknown) => void): unknown }
  readonly registration: ReturnType<typeof vi.fn>
  readonly disposer: ReturnType<typeof vi.fn>
  readonly injectedNames: readonly string[][]
  /** Run every captured injection callback with the scope the host would pass. */
  run(scope: unknown): void
}

/** An immediate-injection double: the callback runs as it is registered. */
function installDouble(tools: ToolServiceLike | undefined): InstallDouble {
  const disposer = vi.fn()
  const registration = vi.fn((_guard: unknown) => disposer)
  const injectedNames: readonly string[][] = []
  const callbacks: ((scope: unknown) => void)[] = []
  const ctx = {
    inject(names: readonly string[], callback: (scope: unknown) => void): unknown {
      injectedNames.push([...names])
      callbacks.push(callback)
      if (tools !== undefined) callback({ tools })
      return {}
    },
  }
  return {
    ctx,
    registration,
    disposer,
    injectedNames,
    run: (scope: unknown) => { for (const callback of callbacks) callback(scope) },
  }
}

describe('installToolGuard', () => {
  it('registers a guard through ctx.inject([tools]) and returns its disposer', () => {
    const tools: ToolServiceLike = { guard: vi.fn((_guard: unknown) => vi.fn()) }
    const double = installDouble(tools)
    const dispose = installToolGuard(double.ctx, depsOf(denyConfig))
    expect(double.injectedNames).toEqual([['tools']])
    expect(tools.guard).toHaveBeenCalledOnce()
    const registered = (tools.guard as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as (execution: ToolExecutionLike) => string | undefined
    expect(registered(execution('grep', { path: secrets }))).toContain('grep')
    expect(registered(execution('grep', { path: notes }))).toBeUndefined()
    dispose()
  })

  it('calls the registered disposer exactly once when disposed', () => {
    const registrationDisposer = vi.fn()
    const tools: ToolServiceLike = { guard: vi.fn(() => registrationDisposer) }
    const double = installDouble(tools)
    const dispose = installToolGuard(double.ctx, depsOf(denyConfig))
    expect(registrationDisposer).not.toHaveBeenCalled()
    dispose()
    dispose() // idempotent
    expect(registrationDisposer).toHaveBeenCalledOnce()
  })

  it('is a silent no-op on a host whose tools service has no guard', () => {
    const double = installDouble({})
    const warn = vi.fn()
    const dispose = installToolGuard(double.ctx, { readConfig: () => denyConfig, warn })
    expect(warn).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
  })

  it('does not register when the deferred injection runs after disposal', () => {
    const tools: ToolServiceLike = { guard: vi.fn(() => vi.fn()) }
    const double = installDouble(undefined)
    const dispose = installToolGuard(double.ctx, depsOf(denyConfig))
    dispose()
    double.run({ tools })
    expect(tools.guard).not.toHaveBeenCalled()
  })

  it('registers at most once when the injection callback fires twice', () => {
    const tools: ToolServiceLike = { guard: vi.fn(() => vi.fn()) }
    const double = installDouble(undefined)
    installToolGuard(double.ctx, depsOf(denyConfig))
    double.run({ tools })
    double.run({ tools })
    expect(tools.guard).toHaveBeenCalledOnce()
  })

  it('falls back to a directly-available ctx.tools when there is no inject seam', () => {
    const tools: ToolServiceLike = { guard: vi.fn(() => vi.fn()) }
    const warn = vi.fn()
    installToolGuard({ tools }, { readConfig: () => denyConfig, warn })
    expect(tools.guard).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades to a warning (never a throw) when registration fails', () => {
    const tools: ToolServiceLike = { guard: vi.fn(() => { throw new Error('no slot left') }) }
    const double = installDouble(tools)
    const warn = vi.fn()
    const dispose = installToolGuard(double.ctx, { readConfig: () => denyConfig, warn })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no slot left'))
    expect(() => dispose()).not.toThrow()
  })
})

// ── name rules: a bare name matches at any depth ──────────────────────────
// `.git | deny` is a NAME RULE: the guard must refuse a tool call whose own
// argument path CONTAINS a `.git` component under the session workspace (plus
// every configured writable root), exactly like the fs proxy does. The lexical
// test is shared with the fs wrapper, so the two surfaces cannot disagree.

const repo = join(base, 'repo')
const repoGit = join(repo, '.git')
mkdirSync(repoGit, { recursive: true })
const external = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-guard-ext-')))

const nameGitDeny = normalizeConfig({ paths: [{ path: '.git', access: 'deny' }] })

describe('guardReason name rules', () => {
  it('refuses a tool call whose explicit path contains a denied name component', () => {
    const reason = guardReason(execution('grep', { pattern: 'token', path: join(repoGit, 'config') }), depsOf(nameGitDeny))
    expect(reason).toBeDefined()
    expect(reason).toContain('grep')
    expect(reason).toContain(join(repoGit, 'config'))
    expect(reason).toContain('".git"')
    expect(reason).toContain('access: deny')
  })

  it('resolves a RELATIVE argument against the session cwd before matching the component', () => {
    const reason = guardReason(execution('glob', { pattern: '*.pem', path: 'repo/.git/config' }), depsOf(nameGitDeny))
    expect(reason).toContain('glob')
    // The candidate is echoed as the caller spelled it; the match used the
    // canonical path resolved against the SESSION workspace.
    expect(reason).toContain('repo/.git/config')
    expect(reason).toContain('".git"')
  })

  it('extends the name-rule scope to a configured writable root outside the workspace', () => {
    const config = normalizeConfig({ paths: [
      { path: external, scope: 'write' },
      { path: '.git', access: 'deny' },
    ] })
    const reason = guardReason(
      execution('grep', { path: join(external, 'proj', '.git', 'config') }),
      depsOf(config),
    )
    expect(reason).toBeDefined()
    expect(reason).toContain('".git"')
  })

  it('keeps harmless paths and names outside every scope root out of it', () => {
    const deps = depsOf(nameGitDeny)
    expect(guardReason(execution('grep', { path: join(repo, 'src', 'index.ts') }), deps)).toBeUndefined()
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-guard-outside-')))
    expect(guardReason(execution('grep', { path: join(outside, 'x', '.git', 'config') }), deps)).toBeUndefined()
  })

  it('does not deny for a name rule scoped to the shell or set to read-only', () => {
    const shellOnly = normalizeConfig({ paths: [{ path: '.git', access: 'deny', surfaces: ['shell'] }] })
    expect(guardReason(execution('grep', { path: join(repoGit, 'config') }), depsOf(shellOnly))).toBeUndefined()
    // A read rule only stops writes; the fs proxy downgrades them, and a
    // parameter-level guard cannot know whether the tool will write.
    const readOnly = normalizeConfig({ paths: [{ path: '.git', access: 'read' }] })
    expect(guardReason(execution('grep', { path: join(repoGit, 'config') }), depsOf(readOnly))).toBeUndefined()
  })

  it('follows the live configuration: revoking the name rule lifts the guard', () => {
    let config = nameGitDeny
    const deps: ToolGuardDeps = { readConfig: () => config, warn: vi.fn() }
    expect(guardReason(execution('grep', { path: join(repoGit, 'config') }), deps)).toBeDefined()
    config = normalizeConfig(undefined)
    expect(guardReason(execution('grep', { path: join(repoGit, 'config') }), deps)).toBeUndefined()
  })
})
