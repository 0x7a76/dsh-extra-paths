import { describe, expect, it } from 'vitest'
import { widenArgv } from '../src/argv.js'

const roots = ['/data/notes']

describe('widenArgv', () => {
  it('appends a subpath allow rule to a Seatbelt profile', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['sandbox-exec', '-p', '(version 1) (allow default) (deny file-write*)', '--', ...wrapped]
    const widened = widenArgv(confined, wrapped.length, roots)
    expect(widened).toEqual([
      'sandbox-exec', '-p',
      '(version 1) (allow default) (deny file-write*) (allow file-write* (subpath "/data/notes"))',
      '--', ...wrapped,
    ])
  })

  it('escapes quotes and backslashes in the Seatbelt literal', () => {
    const wrapped = ['echo']
    const confined = ['sandbox-exec', '-p', '(version 1)', '--', ...wrapped]
    expect(widenArgv(confined, 1, ['/we"ird\\path'])?.[2]).toContain('(subpath "/we\\"ird\\\\path")')
  })

  it('binds the root into a bwrap profile', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/ws', '/ws', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/ws', '/ws',
      '--bind', '/data/notes', '/data/notes', '--', ...wrapped,
    ])
  })

  it('adds a read-write grant to a Landlock launcher invocation', () => {
    const wrapped = ['echo']
    const confined = ['landlock-run', '--ro', '/', '--rw', '/tmp', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)).toEqual([
      'landlock-run', '--ro', '/', '--rw', '/tmp', '--rw', '/data/notes', '--', ...wrapped,
    ])
  })

  it('finds the separator even when the wrapped command contains --', () => {
    const wrapped = ['bash', '-c', 'echo -- x']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)?.slice(0, 5)).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind',
    ])
  })

  it('returns undefined for an unrecognised dialect (fail closed)', () => {
    const wrapped = ['echo']
    const confined = ['windows-acl-run', '--workspace', '/ws', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)).toBeUndefined()
  })

  it('returns undefined when the separator is missing', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/'], 1, roots)).toBeUndefined()
  })

  it('appends one grant per root, in the order given', () => {
    const wrapped = ['echo']
    const confined = ['sandbox-exec', '-p', '(version 1)', '--', ...wrapped]
    expect(widenArgv(confined, 1, ['/a', '/b'])?.[2])
      .toBe('(version 1) (allow file-write* (subpath "/a")) (allow file-write* (subpath "/b"))')
  })

  it('locates the separator from wrappedLength, including a zero-length command', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/', '--'], 0, ['/a']))
      .toEqual(['bwrap', '--ro-bind', '/', '/', '--bind', '/a', '/a', '--'])
  })

  it('fails closed when wrappedLength cannot address the separator', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/', '--', 'echo'], 99, ['/a'])).toBeUndefined()
    expect(widenArgv(['--'], 0, ['/a'])).toBeUndefined()
  })

  it('returns the argv unchanged when there is nothing to grant', () => {
    const confined = ['bwrap', '--', 'echo']
    expect(widenArgv(confined, 1, [])).toBe(confined)
  })

  it('widens the exact argv a 0.2.0 provider produces (fixture taken from rc.2)', () => {
    // Captured by instantiating @deepseek-ai/dsh-sandbox-local@0.2.0-rc.2 and
    // calling confine(): 0.2.x groups every writable root into ONE form, which is
    // why the widening appends a form of its own rather than editing theirs.
    const command = ['/bin/sh', '-c', 'printf ok > /ws/../outside/file.txt']
    const profile =
      '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) '
      + '(allow file-write* (subpath "/ws") (subpath "/private/tmp") (subpath "/private/var/folders/x/T"))'
    const confined = ['sandbox-exec', '-p', profile, '--', ...command]
    const widened = widenArgv(confined, command.length, ['/outside'])
    expect(widened).toBeDefined()
    expect(widened?.[0]).toBe('sandbox-exec')
    expect(widened?.[1]).toBe('-p')
    // The provider's own grants survive verbatim; ours is appended.
    expect(widened?.[2]).toBe(`${profile} (allow file-write* (subpath "/outside"))`)
    expect(widened?.slice(3)).toEqual(['--', ...command])
  })
})
