import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACCESS,
  defaultsOf,
  hostViewOf,
  isNameRulePath,
  parseRules,
  payloadOf,
  previewBaseOf,
  resolveBase,
  rowsOf,
  serializeRules,
  surfacesText,
  type HostView,
  type Rule,
} from '../src/client/paths.js'

/**
 * The rule model and the browser-side lexical resolution. The path arithmetic
 * itself is `src/platform.ts` (shared with the host half, unit-tested there);
 * this file pins the client layer that decides WHICH outcome to show: stored
 * shapes with the legacy `scope`, the bulk-text grammar, and the "wait for the
 * host platform facts" rule (a Windows spelling is never claimed to resolve
 * before the host has reported its platform).
 */

const rule = (
  path: string,
  access: Rule['access'] = 'write',
  surfaces: Rule['surfaces'] = ['fs', 'shell'],
): Rule => ({ path, access, surfaces })

const WAITING: HostView = hostViewOf(undefined)
const POSIX: HostView = {
  known: true,
  facts: { platform: 'linux', wsl: false, wslMountRoot: '/mnt', home: '/home/user' },
}
const MAC: HostView = { ...POSIX, facts: { ...POSIX.facts, platform: 'darwin' } }
const WSL: HostView = {
  known: true,
  facts: { platform: 'linux', wsl: true, wslMountRoot: '/mnt', home: '/home/user' },
}
const WINDOWS: HostView = {
  known: true,
  facts: { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' },
}

describe('rowsOf / payloadOf', () => {
  it('accepts bare strings and applies the section defaults', () => {
    expect(rowsOf({ paths: ['notes', '../shared/docs'] })).toEqual([
      rule('notes'),
      rule('../shared/docs'),
    ])
    expect(rowsOf({ paths: ['notes'], defaultAccess: 'read', defaultSurfaces: ['shell'] })).toEqual([
      rule('notes', 'read', ['shell']),
    ])
  })

  it('maps the legacy scope onto the access vocabulary', () => {
    expect(rowsOf({
      paths: [
        { path: 'a', scope: 'always-write' },
        { path: 'b', scope: 'write', surfaces: ['fs'] },
      ],
    })).toEqual([
      rule('a', 'always-write'),
      rule('b', 'write', ['fs']),
    ])
  })

  it('reads the new access/surfaces shape and prefers access over scope', () => {
    expect(rowsOf({
      paths: [
        { path: '~/.ssh', access: 'deny', surfaces: ['fs', 'shell'] },
        { path: 'generated', access: 'read', surfaces: ['shell'] },
        { path: 'both', access: 'always-write', scope: 'write', surfaces: ['fs'] },
      ],
    })).toEqual([
      rule('~/.ssh', 'deny'),
      rule('generated', 'read', ['shell']),
      rule('both', 'always-write', ['fs']),
    ])
  })

  it('accepts the legacy defaultScope alias', () => {
    expect(defaultsOf({ defaultScope: 'always-write' }).access).toBe('always-write')
    // The new spelling wins when both are present, like the host normalisation.
    expect(defaultsOf({ defaultAccess: 'deny', defaultScope: 'write' }).access).toBe('deny')
  })

  it('falls back to the plugin defaults on unknown vocabulary instead of crashing', () => {
    const rows = rowsOf({ paths: [{ path: 'x', access: 'bogus', surfaces: [] }] })
    expect(rows).toEqual([rule('x', DEFAULT_ACCESS, ['fs', 'shell'])])
  })

  it('writes the structured payload: trimmed paths, access, surfaces, no legacy scope', () => {
    const payload = payloadOf([
      { path: '  ~/notes  ', access: 'deny', surfaces: ['fs'] },
      { path: '   ', access: 'write', surfaces: ['fs', 'shell'] },
      { path: '../docs', access: 'always-write', surfaces: ['shell', 'fs'] },
    ])
    expect(payload).toEqual([
      { path: '~/notes', access: 'deny', surfaces: ['fs'] },
      { path: '../docs', access: 'always-write', surfaces: ['shell', 'fs'] },
    ])
    expect(payload.some(entry => 'scope' in entry)).toBe(false)
  })
})

describe('text mode', () => {
  const defaults = defaultsOf({})

  it('renders the current rows as FULL explicit lines (access + surfaces are never hidden)', () => {
    // The list view let the user set access/surfaces, so the text view must show
    // them even when they equal the plugin defaults — a bare path looked like the
    // settings had been dropped on the way in.
    const text = serializeRules([
      rule('~/a'),
      rule('../b', 'read'),
      rule('C:\\work', 'always-write', ['fs']),
      rule('~/.ssh', 'deny', ['shell']),
    ])
    expect(text.split('\n')).toEqual([
      '~/a | write | fs+shell',
      '../b | read | fs+shell',
      'C:\\work | always-write | fs',
      '~/.ssh | deny | shell',
    ])
  })

  it('round-trips the rows through text and back', () => {
    const rows = [
      rule('~/projects/notes/home'),
      rule('../shared/docs', 'read'),
      rule('~/.ssh', 'deny'),
      rule('C:\\work\\some-repo', 'always-write', ['fs']),
      rule('~/generated', 'read', ['shell']),
    ]
    const parsed = parseRules(serializeRules(rows), defaults)
    expect(parsed).toEqual({ ok: true, rules: rows })
  })

  it('parses the documented sample, ignoring comments and blank lines', () => {
    const text = [
      '# comments are ignored',
      '',
      '~/projects/notes/home',
      '   # indented comment',
      '../shared/docs | read',
      '~/.ssh | deny | fs+shell',
      '/work/some-repo | always-write | fs',
    ].join('\r\n')
    expect(parseRules(text, defaults)).toEqual({
      ok: true,
      rules: [
        rule('~/projects/notes/home'),
        rule('../shared/docs', 'read'),
        rule('~/.ssh', 'deny'),
        rule('/work/some-repo', 'always-write', ['fs']),
      ],
    })
  })

  it('inherits the plugin defaults for the omitted fields', () => {
    expect(parseRules('notes', defaults)).toEqual({ ok: true, rules: [rule('notes')] })
    expect(parseRules('notes | deny', defaults)).toEqual({ ok: true, rules: [rule('notes', 'deny')] })
    expect(parseRules('notes | deny | fs', { access: 'read', surfaces: ['shell'] })).toEqual({
      ok: true,
      rules: [rule('notes', 'deny', ['fs'])],
    })
  })

  it('rejects the whole text with per-line errors, keeping the line numbers', () => {
    const parsed = parseRules([
      'ok/one',
      'bad | nope',
      'bad | read | fs+network',
      'too | read | fs | extra',
      ' | read',
    ].join('\n'), defaults)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.map(error => [error.line, error.code])).toEqual([
      [2, 'unknown-access'],
      [3, 'unknown-surfaces'],
      [4, 'too-many-fields'],
      [5, 'empty-path'],
    ])
    // The offending field value travels with the error so the page can show it.
    expect(parsed.errors[0]?.value).toBe('nope')
    expect(parsed.errors[1]?.value).toBe('fs+network')
  })

  it('canonicalizes the surface spelling', () => {
    expect(surfacesText(['shell'])).toBe('shell')
    expect(surfacesText(['shell', 'fs'])).toBe('fs+shell')
    expect(surfacesText([])).toBe('')
    expect(parseRules('x | read | shell+fs', defaults)).toEqual({ ok: true, rules: [rule('x', 'read')] })
  })

  it('drops not-yet-typed rows from the rendered text', () => {
    expect(serializeRules([rule('~/a'), rule('   ')])).toBe('~/a | write | fs+shell')
  })

  it('round-trips a bare name unchanged: `.git | deny | fs+shell`', () => {
    // A name rule is written exactly like any other rule in text mode — the
    // serialiser must not helpfully "fix" it into a path (e.g. `./.git`).
    const rows = [rule('.git', 'deny', ['fs', 'shell']), rule('.env', 'read', ['fs'])]
    const text = serializeRules(rows)
    expect(text).toBe('.git | deny | fs+shell\n.env | read | fs')
    expect(parseRules(text, defaults)).toEqual({ ok: true, rules: rows })
  })
})

describe('isNameRulePath', () => {
  it('classifies a separator-free component as a name rule', () => {
    for (const path of ['.git', '.env', 'node_modules', '.gitignore', 'secrets', '  .env  ']) {
      expect({ path, nameRule: isNameRulePath(path) }).toEqual({ path, nameRule: true })
    }
  })

  it('never classifies a path, a pattern, the relative specials, ~ or a drive spelling as a name rule', () => {
    for (const path of [
      '', '.', '..', './.git', './notes', '../.git', 'a/b', 'a\\b', '~/x', '~foo',
      '*.git', '.git*', 'C:foo', 'C:\\x', '/abs/x', '\\\\server\\share\\x',
    ]) {
      expect({ path, nameRule: isNameRulePath(path) }).toEqual({ path, nameRule: false })
    }
  })
})

describe('host facts', () => {
  it('has no facts before the first preview and never pretends otherwise', () => {
    const host = hostViewOf(undefined)
    expect(host.known).toBe(false)
    expect(host.facts.home).toBe('')
    expect(host.facts.platform).toBe('unknown')
  })

  it('adopts the platform report sent by the host', () => {
    expect(hostViewOf({
      platform: { platform: 'linux', wsl: true, wslMountRoot: '/mnt/wsl', dialect: 'posix' },
      home: '/home/user',
    })).toEqual({
      known: true,
      facts: { platform: 'linux', wsl: true, wslMountRoot: '/mnt/wsl', home: '/home/user' },
    })
  })
})

describe('resolveBase', () => {
  it('refuses relative and empty spellings', () => {
    expect(resolveBase('', POSIX)).toEqual({ ok: false, problem: 'empty' })
    expect(resolveBase('relative/ws', POSIX)).toEqual({ ok: false, problem: 'relative' })
  })

  it('waits for the host home directory before expanding ~', () => {
    expect(resolveBase('~', WAITING)).toEqual({ ok: false, problem: 'waiting' })
    expect(resolveBase('~/notes', WAITING)).toEqual({ ok: false, problem: 'waiting' })
  })

  it('uses a POSIX-ish heuristic for POSIX absolute spellings before the first preview', () => {
    expect(resolveBase('/home/user/work/', WAITING)).toEqual({ ok: true, base: '/home/user/work' })
  })

  it('never claims a Windows base resolves before the host reports its platform', () => {
    expect(resolveBase('C:\\work', WAITING)).toEqual({ ok: false, problem: 'waiting' })
    expect(resolveBase('\\\\server\\share\\x', WAITING)).toEqual({ ok: false, problem: 'waiting' })
  })

  it('accepts host-dialect absolute spellings, including drive, UNC and ~', () => {
    expect(resolveBase('C:\\Users\\someone\\work', WINDOWS)).toEqual({
      ok: true,
      base: 'C:\\Users\\someone\\work',
    })
    expect(resolveBase('C:/Users/someone/work/', WINDOWS)).toEqual({
      ok: true,
      base: 'C:\\Users\\someone\\work',
    })
    expect(resolveBase('\\\\server\\share\\x\\y', WINDOWS)).toEqual({
      ok: true,
      base: '\\\\server\\share\\x\\y',
    })
    expect(resolveBase('~\\notes', WINDOWS)).toEqual({ ok: true, base: 'C:\\Users\\someone\\notes' })
    expect(resolveBase('~/notes', MAC)).toEqual({ ok: true, base: '/home/user/notes' })
  })

  it('translates the same base across Windows and WSL, and calls it foreign elsewhere', () => {
    expect(resolveBase('C:\\work', WSL)).toEqual({ ok: true, base: '/mnt/c/work' })
    expect(resolveBase('/mnt/c/work', WINDOWS)).toEqual({ ok: true, base: 'C:\\work' })
    expect(resolveBase('C:\\work', POSIX)).toEqual({
      ok: false,
      problem: 'foreign',
      reason: expect.stringContaining('only understood on a Windows host'),
    })
  })
})

describe('previewBaseOf', () => {
  it('sends the resolved host-native base when it is usable', () => {
    expect(previewBaseOf('/home/user/work/', resolveBase('/home/user/work/', POSIX))).toBe('/home/user/work')
    expect(previewBaseOf('C:\\work', resolveBase('C:\\work', WSL))).toBe('/mnt/c/work')
  })

  it('sends raw absolute spellings while waiting, so the host can prove its platform', () => {
    // `~`: the host expands it with the real home directory.
    expect(previewBaseOf('~', resolveBase('~', WAITING))).toBe('~')
    expect(previewBaseOf('  ~/projects  ', resolveBase('~/projects', WAITING))).toBe('~/projects')
    // A Windows workspace candidate must reach the host: on a Windows/WSL host the
    // host accepts (or translates) it and the page finally learns the facts.
    expect(previewBaseOf('C:\\work', resolveBase('C:\\work', WAITING))).toBe('C:\\work')
    expect(previewBaseOf('\\\\server\\share\\x', resolveBase('\\\\server\\share\\x', WAITING)))
      .toBe('\\\\server\\share\\x')
  })

  it('sends nothing for empty/relative spellings and for a base the host already refused', () => {
    expect(previewBaseOf('', resolveBase('', POSIX))).toBe('')
    expect(previewBaseOf('relative', resolveBase('relative', POSIX))).toBe('')
    expect(previewBaseOf('C:\\work', resolveBase('C:\\work', POSIX))).toBe('')
  })
})
