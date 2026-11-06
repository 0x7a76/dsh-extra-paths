/**
 * The refusal vocabulary every enforcement surface shares: which rule covers a
 * target, and what the user sees when it fires.
 *
 * The containment assertions run through `resolveRoots` so the rules are the REAL
 * ones the enforcement layers receive, not hand-built fakes.
 */
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import {
  ACCESS_DENIED_CODE,
  AccessDeniedError,
  matchDenied,
  matchReadOnly,
  readDenied,
  toolAccessDenied,
  writeDenied,
  writeReadOnly,
} from '../src/denial.js'
import type { PlatformFacts } from '../src/paths.js'
import { resolveRoots, type ResolvedRule } from '../src/resolve.js'

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
// Multi-component relative fixtures: a bare name is a NAME RULE now, so a
// single-segment relative spelling would no longer mean `<workspace>/<name>`.
mkdirSync(join(base, 'sub', 'secrets'), { recursive: true })
mkdirSync(join(base, 'sub', 'notes'), { recursive: true })

/** Resolve a configuration against the fixture workspace with deterministic facts. */
function rulesOf(paths: readonly unknown[], workspaceRoot = base) {
  return resolveRoots(normalizeConfig({ paths }), workspaceRoot)
}

describe('AccessDeniedError', () => {
  it('is an ordinary Error carrying the stable code', () => {
    const error = new AccessDeniedError('nope')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AccessDeniedError)
    expect(error.name).toBe('AccessDeniedError')
    expect(error.code).toBe(ACCESS_DENIED_CODE)
    expect(error.message).toBe('nope')
  })

  it('is mutable-free in the sense a consumer relies on: String() shows the message', () => {
    expect(String(new AccessDeniedError('cannot read "/secret"'))).toContain('cannot read "/secret"')
  })
})

describe('matchDenied', () => {
  it('matches the configured root itself and every descendant', () => {
    const report = rulesOf([{ path: 'sub/secrets', access: 'deny' }])
    const root = join(base, 'sub', 'secrets')
    expect(matchDenied(report.denied, 'fs', root)).toMatchObject({ access: 'deny', raw: 'sub/secrets' })
    expect(matchDenied(report.denied, 'fs', join(root, 'a', 'b.txt'))?.root).toBe(root)
  })

  it('does not match a prefix-string sibling; no false positives', () => {
    const report = rulesOf([{ path: 'sub/secrets', access: 'deny' }])
    expect(matchDenied(report.denied, 'fs', join(base, 'secrets-backup', 'a.txt'))).toBeUndefined()
    expect(matchDenied(report.denied, 'fs', join(base, 'sub', 'notes', 'a.txt'))).toBeUndefined()
  })

  it('filters by surface: an fs rule never answers for the shell and vice versa', () => {
    const report = rulesOf([
      { path: 'sub/notes', access: 'deny', surfaces: ['fs'] },
      { path: 'sub/secrets', access: 'deny', surfaces: ['shell'] },
    ])
    expect(matchDenied(report.denied, 'fs', join(base, 'sub', 'notes'))).toBeDefined()
    expect(matchDenied(report.denied, 'shell', join(base, 'sub', 'notes'))).toBeUndefined()
    expect(matchDenied(report.denied, 'shell', join(base, 'sub', 'secrets'))).toBeDefined()
    expect(matchDenied(report.denied, 'fs', join(base, 'sub', 'secrets'))).toBeUndefined()
  })

  it('ignores read rules: only matchDenied calls are hard denials', () => {
    const report = rulesOf([{ path: 'sub/notes', access: 'read' }])
    expect(matchDenied(report.readOnly, 'fs', join(base, 'sub', 'notes'))).toBeUndefined()
    expect(matchDenied(report.denied, 'fs', join(base, 'sub', 'notes'))).toBeUndefined()
  })

  it('matches a canonical Windows target case-insensitively with injected facts', () => {
    const win: PlatformFacts = { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' }
    const rules: readonly ResolvedRule[] = [
      { raw: 'C:\\Work\\secret', root: 'C:\\Work\\secret', access: 'deny', surfaces: ['fs'] },
    ]
    expect(matchDenied(rules, 'fs', 'c:\\work\\secret\\a.txt', win)).toBeDefined()
    expect(matchDenied(rules, 'fs', 'D:\\Work\\secret\\a.txt', win)).toBeUndefined()
  })
})

describe('matchReadOnly', () => {
  it('matches only read rules, and a deny rule is never a downgrade', () => {
    const read = rulesOf([{ path: 'sub/notes', access: 'read' }])
    expect(matchReadOnly(read.readOnly, 'fs', join(base, 'sub', 'notes', 'x'))?.raw).toBe('sub/notes')
    const denied = rulesOf([{ path: 'sub/notes', access: 'deny' }])
    expect(matchReadOnly(denied.denied, 'fs', join(base, 'sub', 'notes', 'x'))).toBeUndefined()
  })

  it('filters by surface like matchDenied', () => {
    const report = rulesOf([{ path: 'sub/notes', access: 'read', surfaces: ['shell'] }])
    expect(matchReadOnly(report.readOnly, 'shell', join(base, 'sub', 'notes'))).toBeDefined()
    expect(matchReadOnly(report.readOnly, 'fs', join(base, 'sub', 'notes'))).toBeUndefined()
  })
})

describe('message helpers', () => {
  const rule: ResolvedRule = { raw: '~/.ssh', root: '/home/someone/.ssh', access: 'deny', surfaces: ['fs'] }
  const readRule: ResolvedRule = { raw: 'generated', root: '/ws/sub/generated', access: 'read', surfaces: ['fs'] }

  it('explains a read denial with the path and the rule spelling', () => {
    const message = readDenied('/home/someone/.ssh/id_ed25519', rule).message
    expect(message).toBe(
      'cannot read "/home/someone/.ssh/id_ed25519": denied by the extra-paths rule "~/.ssh"',
    )
  })

  it('explains a write denial with the path, the rule and the deny level', () => {
    const message = writeDenied('/home/someone/.ssh/known_hosts', rule).message
    expect(message).toContain('cannot write "/home/someone/.ssh/known_hosts"')
    expect(message).toContain('"~/.ssh"')
    expect(message).toContain('access: deny')
  })

  it('explains a read-only downgrade as a configuration decision', () => {
    const message = writeReadOnly('/ws/generated/x.js', readRule).message
    expect(message).toContain('cannot write "/ws/generated/x.js"')
    expect(message).toContain('configured read-only')
    expect(message).toContain('"generated"')
    expect(message).toContain('access: read')
  })

  it('names the tool, the argument path and the rule in a tool-layer reason', () => {
    const reason = toolAccessDenied('grep', '~/secrets/keys', rule)
    expect(reason).toContain('grep')
    expect(reason).toContain('"~/secrets/keys"')
    expect(reason).toContain('"~/.ssh"')
    expect(reason).toContain('access: deny')
  })
})
