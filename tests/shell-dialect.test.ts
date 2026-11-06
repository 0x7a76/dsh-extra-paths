import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyRunner,
  observedShellDialect,
  recordShellDialect,
  resetObservedShellDialect,
  shellCapabilityOf,
  type ShellDialect,
} from '../src/shell-dialect.js'

const seatbelt = (): string[] => ['sandbox-exec', '-p', '(version 1) (allow default) (deny file-write*)', '--', 'bash', '-c', 'ls']
const bwrap = (): string[] => ['bwrap', '--ro-bind', '/', '/', '--bind', '/ws', '/ws', '--', 'bash', '-c', 'ls']
const landlock = (): string[] => ['/opt/dsh/landlock-run', '--ro', '/', '--rw', '/ws', '--', 'bash', '-c', 'ls']
const windowsAcl = (): string[] => ['node', '/opt/dsh/windows-acl/runner.js', '--workspace', 'C:\\ws', '--mode', 'workspace-write', '--', 'bash', '-c', 'ls']

describe('classifyRunner', () => {
  it.each([
    [seatbelt(), 'seatbelt'],
    [bwrap(), 'bwrap'],
    [landlock(), 'landlock'],
    [windowsAcl(), 'windows-acl'],
    [['bash', '-c', 'ls'], 'unknown'],
    [[], 'unknown'],
  ] as const)('classifies %j dialect', (argv, dialect) => {
    expect(classifyRunner(argv)).toBe(dialect)
  })

  it('classifies a Windows launcher given as an absolute path', () => {
    expect(classifyRunner(['C:\\Program Files\\nodejs\\node.exe', 'C:\\dsh\\runner.js', '--workspace', 'C:\\ws', '--mode', 'read-only']))
      .toBe('windows-acl')
  })
})

describe('recordShellDialect', () => {
  it('keeps the last non-unknown observation', () => {
    resetObservedShellDialect()
    expect(observedShellDialect()).toBe('unknown')
    expect(recordShellDialect(bwrap())).toBe('bwrap')
    expect(observedShellDialect()).toBe('bwrap')
    // A danger-full-access call returns the raw argv: it must not erase the fact
    // that the provider is bwrap.
    expect(recordShellDialect(['bash', '-c', 'ls'])).toBe('unknown')
    expect(observedShellDialect()).toBe('bwrap')
  })
})

describe('shellCapabilityOf', () => {
  beforeEach(() => { resetObservedShellDialect() })

  it('promises deny-read only for the dialects that can subtract access', () => {
    expect(shellCapabilityOf('darwin')).toEqual({ shellReadDeny: true, shellWriteDeny: true, shellReadOnly: true, shellDialect: 'seatbelt' })
    expect(shellCapabilityOf('linux', 'bwrap')).toEqual({ shellReadDeny: true, shellWriteDeny: true, shellReadOnly: true, shellDialect: 'bwrap' })
  })

  it('reports landlock and windows-acl as unable to restrict shell access', () => {
    for (const dialect of ['landlock', 'windows-acl'] as const) {
      expect(shellCapabilityOf('linux', dialect)).toMatchObject({
        shellReadDeny: false,
        shellWriteDeny: false,
        shellReadOnly: false,
        shellDialect: dialect,
      })
    }
  })

  it('is conservative before the first confinement on Linux', () => {
    expect(shellCapabilityOf('linux', 'unknown')).toMatchObject({ shellReadDeny: false, shellWriteDeny: false, shellDialect: 'unknown' })
    expect(shellCapabilityOf('win32')).toMatchObject({ shellReadDeny: false, shellDialect: 'windows-acl' })
  })

  it('exposes every dialect as a value the page can localize', () => {
    const dialects: ShellDialect[] = ['seatbelt', 'bwrap', 'landlock', 'windows-acl', 'unknown']
    for (const dialect of dialects) expect(shellCapabilityOf('linux', dialect).shellDialect).toBe(dialect)
  })
})
