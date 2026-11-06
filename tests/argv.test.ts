/**
 * Runner-dialect widening.
 *
 * The ordering assertions are the security property, not a style check: seatbelt
 * is last-match-wins and bwrap is last-mount-wins, so a deny rule MUST be appended
 * after every allow/grant. landlock and windows-acl cannot express a subtraction
 * at all — the honest answer is "unchanged argv + unsupported dialect", never an
 * invented flag (the windows-acl runner aborts on unknown arguments).
 */
import { describe, expect, it } from 'vitest'
import { widenArgv, type WidenRules } from '../src/argv.js'

/** Build the rule set (every test states only the lists it cares about). */
function rules(grants: readonly string[], readOnly: readonly string[] = [], denied: readonly string[] = []): WidenRules {
  return { grants, readOnly, denied }
}

const roots = ['/data/notes']

/** A seatbelt confinement (the profile is element 2). */
const seatbelt = (profile: string, command: readonly string[]): readonly string[] =>
  ['sandbox-exec', '-p', profile, '--', ...command]

describe('widenArgv grants (existing behavior preserved)', () => {
  it('appends a subpath allow rule to a Seatbelt profile', () => {
    const wrapped = ['echo', 'hi']
    const confined = seatbelt('(version 1) (allow default) (deny file-write*)', wrapped)
    expect(widenArgv(confined, wrapped.length, rules(roots))).toEqual({
      argv: [
        'sandbox-exec', '-p',
        '(version 1) (allow default) (deny file-write*) (allow file-write* (subpath "/data/notes"))',
        '--', ...wrapped,
      ],
    })
  })

  it('escapes quotes and backslashes in the Seatbelt literal', () => {
    const confined = seatbelt('(version 1)', ['echo'])
    expect(widenArgv(confined, 1, rules(['/we"ird\\path']))?.argv[2])
      .toContain('(subpath "/we\\"ird\\\\path")')
  })

  it('binds the root into a bwrap profile', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/ws', '/ws', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, rules(roots))?.argv).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/ws', '/ws',
      '--bind', '/data/notes', '/data/notes', '--', ...wrapped,
    ])
  })

  it('adds a read-write grant to a Landlock launcher invocation', () => {
    const wrapped = ['echo']
    const confined = ['landlock-run', '--ro', '/', '--rw', '/tmp', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, rules(roots))?.argv).toEqual([
      'landlock-run', '--ro', '/', '--rw', '/tmp', '--rw', '/data/notes', '--', ...wrapped,
    ])
  })

  it('finds the separator even when the wrapped command contains --', () => {
    const wrapped = ['bash', '-c', 'echo -- x']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, rules(roots))?.argv.slice(0, 5)).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind',
    ])
  })

  it('returns undefined for an unrecognised dialect (fail closed)', () => {
    const wrapped = ['echo']
    const confined = ['sandbox-ssh', '--host', 'x', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, rules(roots))).toBeUndefined()
  })

  it('returns undefined when the separator is missing', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/'], 1, rules(roots))).toBeUndefined()
  })

  it('appends one grant per root, in the order given', () => {
    const confined = seatbelt('(version 1)', ['echo'])
    expect(widenArgv(confined, 1, rules(['/a', '/b']))?.argv[2])
      .toBe('(version 1) (allow file-write* (subpath "/a")) (allow file-write* (subpath "/b"))')
  })

  it('locates the separator from wrappedLength, including a zero-length command', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/', '--'], 0, rules(['/a']))?.argv)
      .toEqual(['bwrap', '--ro-bind', '/', '/', '--bind', '/a', '/a', '--'])
  })

  it('fails closed when wrappedLength cannot address the separator', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/', '--', 'echo'], 99, rules(['/a']))).toBeUndefined()
    expect(widenArgv(['--'], 0, rules(['/a']))).toBeUndefined()
  })

  it('returns the argv unchanged when there is nothing to add', () => {
    const confined = ['bwrap', '--', 'echo']
    const widened = widenArgv(confined, 1, rules([]))
    expect(widened?.argv).toBe(confined)
    expect(widened?.unsupported).toBeUndefined()
  })

  it('widens the exact argv a 0.2.0 provider produces (fixture taken from rc.2)', () => {
    // Captured by instantiating @deepseek-ai/dsh-sandbox-local@0.2.0-rc.2 and
    // calling confine(): 0.2.x groups every writable root into ONE form, which is
    // why the widening appends a form of its own rather than editing theirs.
    const command = ['/bin/sh', '-c', 'printf ok > /ws/../outside/file.txt']
    const profile =
      '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) '
      + '(allow file-write* (subpath "/ws") (subpath "/private/tmp") (subpath "/private/var/folders/x/T"))'
    const confined = seatbelt(profile, command)
    const widened = widenArgv(confined, command.length, rules(['/outside']))
    expect(widened).toBeDefined()
    expect(widened?.argv[0]).toBe('sandbox-exec')
    expect(widened?.argv[1]).toBe('-p')
    // The provider's own grants survive verbatim; ours is appended.
    expect(widened?.argv[2]).toBe(`${profile} (allow file-write* (subpath "/outside"))`)
    expect(widened?.argv.slice(3)).toEqual(['--', ...command])
  })
})

describe('widenArgv restrictions: seatbelt', () => {
  it('appends grants, then read-only, then deny — deny LAST (SBPL last match wins)', () => {
    const confined = seatbelt('(version 1) (allow default) (deny file-write*)', ['echo'])
    const widened = widenArgv(confined, 1, rules(['/granted'], ['/readonly'], ['/denied']))
    expect(widened?.argv[2]).toBe(
      '(version 1) (allow default) (deny file-write*)'
      + ' (allow file-write* (subpath "/granted"))'
      + ' (deny file-write* (subpath "/readonly"))'
      + ' (deny file-read* (subpath "/denied")) (deny file-write* (subpath "/denied"))',
    )
    const profile = widened?.argv[2] ?? ''
    const order = [
      profile.indexOf('(allow file-write* (subpath "/granted"))'),
      profile.indexOf('(deny file-write* (subpath "/readonly"))'),
      profile.indexOf('(deny file-read* (subpath "/denied"))'),
      profile.indexOf('(deny file-write* (subpath "/denied"))'),
    ]
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // Nothing is inserted into the wrapper's own argv: only the profile changed.
    expect(widened?.argv.slice(3)).toEqual(['--', 'echo'])
  })

  it('appends the deny forms after every host allow when only a deny rule is configured', () => {
    const profile = '(version 1) (allow default) (deny file-write*) (allow file-write* (subpath "/ws"))'
    const widened = widenArgv(seatbelt(profile, ['bash']), 1, rules([], [], ['/secret']))
    expect(widened?.argv[2]).toBe(
      `${profile} (deny file-read* (subpath "/secret")) (deny file-write* (subpath "/secret"))`,
    )
    expect(widened?.argv[2]?.indexOf('(deny file-read* (subpath "/secret"))')).toBeGreaterThan(
      widened?.argv[2]?.indexOf('(allow file-write* (subpath "/ws"))') ?? -1,
    )
  })

  it('appends one restriction form per configured root, in order', () => {
    const widened = widenArgv(seatbelt('(version 1)', ['echo']), 1, rules([], ['/r1', '/r2'], ['/d1', '/d2']))
    const profile = widened?.argv[2] ?? ''
    expect(profile).toContain('(deny file-write* (subpath "/r1")) (deny file-write* (subpath "/r2"))')
    expect(profile).toContain('(deny file-read* (subpath "/d1")) (deny file-write* (subpath "/d1"))')
    expect(profile).toContain('(deny file-read* (subpath "/d2")) (deny file-write* (subpath "/d2"))')
  })
})

describe('widenArgv restrictions: bwrap', () => {
  it('appends --bind, then --ro-bind, then --mask before the caller separator', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--bind', '/ws', '/ws', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, rules(['/granted'], ['/readonly'], ['/denied']))?.argv).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind', '/ws', '/ws',
      '--bind', '/granted', '/granted',
      '--ro-bind', '/readonly', '/readonly',
      '--mask', '/denied',
      '--', ...wrapped,
    ])
  })

  it('keeps --mask after every mount op even when nothing is granted', () => {
    const confined = ['bwrap', '--ro-bind', '/', '/', '--bind', '/ws', '/ws', '--', 'bash']
    const widened = widenArgv(confined, 1, rules([], [], ['/secret']))
    expect(widened?.argv).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind', '/ws', '/ws', '--mask', '/secret', '--', 'bash',
    ])
    expect(widened?.unsupported).toBeUndefined()
  })
})

describe('widenArgv restrictions: dialects that cannot express them', () => {
  it('landlock: appends grants but reports unsupported for a read-only restriction', () => {
    const confined = ['landlock-run', '--ro', '/', '--', 'bash']
    const widened = widenArgv(confined, 1, rules(['/granted'], ['/readonly']))
    expect(widened?.argv).toEqual(['landlock-run', '--ro', '/', '--rw', '/granted', '--', 'bash'])
    expect(widened?.unsupported).toBe('landlock')
    // No invented "deny" flag: an allow-list has no spelling for a subtraction.
    expect(widened?.argv).not.toContain('--deny')
    expect(widened?.argv).not.toContain('--ro-bind')
  })

  it('landlock: reports unsupported for a deny restriction and still adds grants', () => {
    const widened = widenArgv(['landlock-run', '--ro', '/', '--', 'bash'], 1, rules(['/granted'], [], ['/denied']))
    expect(widened?.unsupported).toBe('landlock')
    expect(widened?.argv).toEqual(['landlock-run', '--ro', '/', '--rw', '/granted', '--', 'bash'])
  })

  it('landlock: grants alone are expressible, so no unsupported is reported', () => {
    const widened = widenArgv(['landlock-run', '--ro', '/', '--', 'bash'], 1, rules(['/granted']))
    expect(widened).toEqual({ argv: ['landlock-run', '--ro', '/', '--rw', '/granted', '--', 'bash'] })
  })

  it('windows-acl: returns the argv untouched and reports the dialect (the runner rejects flags)', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['windows-acl-run', '--workspace', '/ws', '--mode', 'workspace-write', '--', ...wrapped]
    const widened = widenArgv(confined, wrapped.length, rules(['/granted'], ['/readonly'], ['/denied']))
    expect(widened?.argv).toBe(confined)
    expect(widened?.unsupported).toBe('windows-acl')
  })

  it('windows-acl: even a grant-only rule set is unsupported (it cannot express anything)', () => {
    const confined = ['windows-acl-run', '--workspace', '/ws', '--mode', 'workspace-write', '--', 'echo']
    expect(widenArgv(confined, 1, rules(['/granted']))?.unsupported).toBe('windows-acl')
  })

  it('an unknown dialect is undefined, not "unsupported", so the caller must not claim any effect', () => {
    expect(widenArgv(['sandbox-ssh', '--', 'echo'], 1, rules([], [], ['/denied']))).toBeUndefined()
  })
})
