import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { format, en, zh, type Translate } from '../src/client/locales.js'
import {
  CapabilityBanner,
  ExtraPathsPage,
  ExtraPathsSummary,
  PreviewPanel,
  TextModeEditor,
  textErrorMessage,
  type PageScope,
  type WorkspacesHook,
} from '../src/client/page.js'
import { resolveBase, hostViewOf, type Rule, type TextError } from '../src/client/paths.js'
import type { PreviewCapabilities, PreviewEntry, PreviewResult } from '../src/client/preview.js'

/**
 * The page renders in two places (the plugin row's page view and the settings
 * section), and its text editor/save/preview wiring is easy to break silently.
 * `renderToStaticMarkup` runs the components without a DOM, which is enough to
 * pin the single-editor layout, the defaults/examples copy, the localized
 * strings, the preview panel and the capability banner, and to catch a
 * render-time crash.
 *
 * Interaction (typing, toggling, applying text) is covered where it belongs: the
 * pure rule/text functions in `client-paths.test.ts` plus the small presentational
 * components rendered directly here.
 */

function scope(value: unknown): PageScope {
  return {
    getSnapshot: () => ({ status: 'ready', value: value as never }),
    subscribe: () => () => {},
    set: async () => {},
  }
}

const WORKSPACE = '/home/user/work/example-repo'

/** The lazy service fallback the plugin passes when the shell supplies no hook. */
const getWorkspaces = () => ({
  list: { getSnapshot: () => ({ items: [{ path: WORKSPACE }] }) },
})

/** The shell's standard hook, as a settings section receives it. */
const useWorkspaces: WorkspacesHook = (select) => select({ items: [{ path: WORKSPACE }] })

const enTranslate: Translate = (key, params) => format(en[key], params)
const zhTranslate: Translate = (key, params) => format(zh[key], params)

const RULE = (path: string, access: Rule['access'] = 'write', surfaces: Rule['surfaces'] = ['fs', 'shell']): Rule =>
  ({ path, access, surfaces })

describe('ExtraPathsPage — one text editor, one Save', () => {
  it('renders every rule as a text line in a single textarea (no row list, no mode switch)', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [
        { path: '/Users/someone/.dsh', access: 'write' },
        { path: '.git', access: 'deny', surfaces: ['fs'] },
      ] }),
      getWorkspaces,
    }))
    expect(html).toContain('class="xp-textarea"')
    // The stored rules are the editor content, in the explicit three-field form.
    expect(html).toContain('/Users/someone/.dsh | write | fs+shell')
    expect(html).toContain('.git | deny | fs')
    // No row editor, no add row, no mode toggle: the textarea IS the editor.
    expect(html).not.toContain('class="xp-rule"')
    expect(html).not.toContain('aria-label="添加路径"')
    expect(html).not.toContain('>文本模式</button>')
    expect(html).not.toContain('列表模式')
  })

  it('keeps Save as the only page action (plus the collapsible trimmings)', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [RULE('~/a')] }),
      getWorkspaces,
    }))
    expect(html).toContain('>保存</button>')
    expect(html).toContain('disabled')
    expect(html).not.toContain('放弃修改')
    expect(html).not.toContain('添加工作区上一层')
    expect(html).not.toContain('>应用</button>')
    expect(html).not.toContain('>取消</button>')
  })

  it('states what omitted fields default to (live values, from the config document)', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [] }),
      getWorkspaces,
    }))
    expect(html).toContain('省略字段时的默认值')
    expect(html).toContain('write')
    expect(html).toContain('fs+shell')
    expect(html).toContain('defaultAccess')
  })

  it('shows the syntax hint, including the access vocabulary and the bare-name rule', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [] }),
      getWorkspaces,
    }))
    expect(html).toContain('每行一条规则')
    expect(html).toContain('deny')
    expect(html).toContain('always-write')
    expect(html).toContain('fs+shell')
    expect(html).toContain('名称规则')
    // An empty configuration still shows the editor; there is no separate
    // "empty state" that would hide the only input.
    expect(html).toContain('class="xp-textarea"')
  })

  it('collapses the intro to one line and keeps the full explanation behind expand', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [] }),
      getWorkspaces,
    }))
    expect(html).toContain('工作区之外的额外可写路径')
    expect(html).toContain('>展开</button>')
    expect(html).not.toContain('不需要审批')
  })

  it('replaces the shell\'s heavy focus ring with an accent one (textarea included)', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [] }),
      getWorkspaces,
    }))
    expect(html).toContain(':focus-visible')
    expect(html).toContain('outline: none')
    expect(html).toContain('xp-textarea')
  })
})

describe('ExtraPathsPage — base workspace', () => {
  it('offers the workspace list as a real dropdown, not an invisible datalist', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['notes'] }),
      getWorkspaces,
    }))
    expect(html).toContain('<select')
    expect(html).toContain(`value="${WORKSPACE}"`)
    expect(html).toContain(`>${WORKSPACE}</option>`)
  })

  it('prefers the shell hook over the lazy fallback for the candidate list', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['sub/notes'] }),
      useWorkspaces,
    }))
    expect(html).toContain(`value="${WORKSPACE}"`)
    expect(html).toContain(`>${WORKSPACE}</option>`)
  })

  it('warns when the typed base is not usable instead of silently previewing nothing', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['sub/notes'] }),
      getWorkspaces,
    }))
    // A base is picked automatically, so no warning here; the hint copy exists.
    expect(html).toContain('仅用于预览与行内解析')
  })
})

describe('CapabilityBanner — honest shell limitation', () => {
  const landlock: PreviewCapabilities = {
    shellReadDeny: false,
    shellWriteDeny: false,
    shellReadOnly: false,
    shellDialect: 'landlock',
  }
  const seatbelt: PreviewCapabilities = {
    shellReadDeny: true,
    shellWriteDeny: true,
    shellReadOnly: true,
    shellDialect: 'seatbelt',
  }
  const render = (capabilities: PreviewCapabilities | undefined, rows: readonly Rule[], t?: Translate): string =>
    renderToStaticMarkup(React.createElement(CapabilityBanner, { capabilities, rows, t }))

  it('warns that bash cannot enforce deny/read while fs tools still do', () => {
    const html = render(landlock, [RULE('~/.ssh', 'deny', ['shell'])])
    expect(html).toContain('landlock')
    expect(html).toContain('bash')
    expect(html).toContain('fs 工具仍按规则拦截')
  })

  it('stays silent when the host dialect can enforce it', () => {
    expect(render(seatbelt, [RULE('~/.ssh', 'deny', ['shell'])])).toBe('')
  })

  it('stays silent when the restricted rule does not target the shell', () => {
    expect(render(landlock, [RULE('~/.ssh', 'deny', ['fs'])])).toBe('')
    expect(render(landlock, [RULE('~/cache', 'write')])).toBe('')
  })

  it('claims nothing before the host reports its capabilities', () => {
    expect(render(undefined, [RULE('~/.ssh', 'deny', ['shell'])])).toBe('')
  })

  it('localizes the warning into English', () => {
    const html = render(landlock, [RULE('~/.ssh', 'deny', ['shell'])], enTranslate)
    expect(html).toContain('bash will not honor them')
    expect(html).toContain('landlock')
  })
})

describe('TextModeEditor — bulk editing', () => {
  const render = (value: string, errors?: readonly TextError[]): string =>
    renderToStaticMarkup(React.createElement(TextModeEditor, { tr: (key, params) => enTranslate(key, params), value, errors }))

  it('renders the current rules in the textarea, with the syntax hint and NO actions of its own', () => {
    const html = render('~/a\n../b | read')
    expect(html).toContain('xp-textarea')
    expect(html).toContain('~/a\n../b | read')
    expect(html).toContain('One rule per line')
    // Built-in examples document the supported forms right next to the input.
    expect(html).toContain('Examples and supported forms')
    expect(html).toContain('**/.git')
    expect(html).toContain('always-write')
    expect(html).toContain('Windows / WSL')
    // The toolbar owns Save; the editor must not duplicate the action.
    expect(html).not.toContain('<button')
  })

  it('lists per-line errors and does not claim the text was applied', () => {
    const html = render('ok\nbad | nope', [
      { line: 2, code: 'unknown-access', value: 'nope' },
    ])
    expect(html).toContain('The text has errors and was not applied')
    expect(html).toContain('Line 2: ')
    expect(html).toContain('nope')
  })

  it('formats a parser error with its line number', () => {
    expect(textErrorMessage((key, params) => format(en[key], params), { line: 7, code: 'empty-path' }))
      .toBe('Line 7: the path must not be empty')
    expect(textErrorMessage((key, params) => format(en[key], params), { line: 3, code: 'too-many-fields' }))
      .toContain('Line 3: ')
  })
})

describe('PreviewPanel — host answer, collapsed by default', () => {
  const base = resolveBase('/home/user/work/example-repo', hostViewOf(undefined))
  const preview: PreviewResult = {
    workspaceCwd: '/home/user/work/example-repo',
    home: '/home/user',
    platform: { platform: 'linux', wsl: false, wslMountRoot: '/mnt', dialect: 'posix' },
    capabilities: { shellReadDeny: true, shellWriteDeny: true, shellReadOnly: true, shellDialect: 'seatbelt' },
    entries: [
      { raw: '~/a', resolved: '/home/user/a', access: 'write', surfaces: ['fs', 'shell'], status: 'ok' },
      { raw: '~/b', resolved: '/home/user/b', access: 'read', surfaces: ['fs'], status: 'ok' },
    ],
    writable: ['/home/user/a'],
    readOnly: ['/home/user/b'],
    denied: [],
    warnings: [],
  }

  it('renders the header only while collapsed', () => {
    const html = renderToStaticMarkup(React.createElement(PreviewPanel, {
      tr: enTranslate,
      expanded: false,
      typedBase: '/home/user/work/example-repo',
      base,
      preview,
      dirty: false,
    }))
    expect(html).toContain('Resolution preview')
    expect(html).toContain('1 effective writable roots')
    expect(html).not.toContain('/home/user/a')
  })

  it('shows the host entries plus the read-only aggregation when expanded', () => {
    const html = renderToStaticMarkup(React.createElement(PreviewPanel, {
      tr: enTranslate,
      expanded: true,
      typedBase: '/home/user/work/example-repo',
      base,
      preview,
      dirty: true,
    }))
    expect(html).toContain('~/a')
    expect(html).toContain('/home/user/a')
    expect(html).toContain('1 read-only')
    expect(html).toContain('including unsaved changes')
  })

  it('explains a name-rule entry instead of calling it unresolved', () => {
    // The host sends `resolved: ''` for a name rule (there is no single path);
    // the panel must show what the rule means and how many paths match, not
    // "（未解析）", which would read like a broken entry.
    const namePreview: PreviewResult = {
      ...preview,
      entries: [{ raw: '.git', resolved: '', access: 'deny', surfaces: ['fs', 'shell'], status: 'ok', matches: 2 }],
      writable: [],
      readOnly: [],
      denied: ['/home/user/work/example-repo/.git', '/home/user/work/example-repo/packages/a/.git'],
    }
    const html = renderToStaticMarkup(React.createElement(PreviewPanel, {
      tr: enTranslate,
      expanded: true,
      typedBase: '/home/user/work/example-repo',
      base,
      preview: namePreview,
      dirty: false,
    }))
    expect(html).toContain('Name rule: matches this component at any depth')
    expect(html).toContain('2 matches right now')
    expect(html).not.toContain('(unresolved)')
  })

  it('says what state the page is in when it has no base or no preview yet', () => {
    const noBase = renderToStaticMarkup(React.createElement(PreviewPanel, {
      tr: enTranslate,
      expanded: true,
      typedBase: '',
      base: resolveBase('', hostViewOf(undefined)),
      dirty: false,
    }))
    expect(noBase).toContain('Choose or type a base workspace')

    const noPreview = renderToStaticMarkup(React.createElement(PreviewPanel, {
      tr: enTranslate,
      expanded: true,
      typedBase: '/home/user/work/example-repo',
      base,
      dirty: false,
    }))
    expect(noPreview).toContain('Preview unavailable')
  })
})

describe('ExtraPathsSummary', () => {
  it('stays a one-liner and never renders the editor', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsSummary, {
      scope: scope({ paths: ['~/a', { path: '~/b', access: 'deny' }] }),
    }))
    expect(html).toContain('2 条')
    expect(html).not.toContain('添加工作区上一层')
    expect(html).not.toContain('class="xp-rule"')
  })
})
