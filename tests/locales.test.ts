import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  en, fallbackTranslate, format, zh, type ExtraPathsLocaleKey, type Translate,
} from '../src/client/locales.js'
import { CapabilityBanner, ExtraPathsSummary, ExtraPathsPage, type PageScope } from '../src/client/page.js'

/**
 * DSH picks the UI language; this plugin registers zh/en dictionaries and lets
 * the framework-injected `t` seat translate every string. These pin the two
 * invariants a translator can break silently: identical key sets between the
 * baseline locales, and identical placeholder sets per key (a `{count}` lost in
 * translation renders a sentence with a hole). They also pin the 0.3.0 copy the
 * contract fixes verbatim: the four access levels and the foreign/capability
 * wording.
 */

const keys = Object.keys(zh).sort() as ExtraPathsLocaleKey[]

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()

const enTranslate: Translate = (key, params) => format(en[key], params)

function scope(value: unknown): PageScope {
  return {
    getSnapshot: () => ({ status: 'ready', value: value as never }),
    subscribe: () => () => {},
    set: async () => {},
  }
}

const getWorkspaces = () => ({
  list: { getSnapshot: () => ({ items: [{ path: '/home/user/work/example-repo' }] }) },
})

describe('locale dictionaries', () => {
  it('carries the same keys in both baseline locales', () => {
    expect(Object.keys(en).sort()).toEqual(keys)
    expect(keys.length).toBeGreaterThan(30)
  })

  it('keeps the same {placeholder} set for every key', () => {
    for (const key of keys) {
      expect({ key, placeholders: placeholders(en[key]) }).toEqual({ key, placeholders: placeholders(zh[key]) })
      expect(en[key].trim()).not.toBe('')
      expect(zh[key].trim()).not.toBe('')
    }
  })

  it('fixes the four access-level labels in both languages', () => {
    expect({
      en: [en.accessDeny, en.accessRead, en.accessWrite, en.accessAlways],
      zh: [zh.accessDeny, zh.accessRead, zh.accessWrite, zh.accessAlways],
    }).toEqual({
      en: ['Deny access', 'Read-only', 'Writable (follows session)', 'Always writable'],
      zh: ['禁止访问', '只读', '可写（随会话）', '始终可写'],
    })
  })

  it('carries the foreign-state and capability wording in both languages', () => {
    expect(zh.statusForeign).toBe('当前平台不适用')
    expect(en.statusForeign).toBe('not applicable on this host')
    for (const dictionary of [zh, en]) {
      expect(dictionary.capabilityShellLimit).toContain('bash')
      expect(dictionary.capabilityShellLimit).toContain('fs')
    }
  })

  it('carries the name-rule wording, match count and no-match note in both languages', () => {
    expect(zh.nameRuleHint).toContain('名称规则')
    expect(zh.nameRuleHint).toContain('任意深度')
    expect(en.nameRuleHint).toContain('Name rule')
    expect(en.nameRuleHint).toContain('any depth')
    // `{count}` must exist in both translations with the same placeholder set.
    expect(placeholders(zh.nameRuleMatches)).toEqual(['count'])
    expect(placeholders(en.nameRuleMatches)).toEqual(['count'])
    expect(format(zh.nameRuleMatches, { count: 3 })).toContain('3 处')
    expect(format(en.nameRuleMatches, { count: 3 })).toBe('3 matches right now')
    expect(zh.nameRuleNoMatches).toContain('暂无匹配')
    expect(zh.nameRuleNoMatches).toContain('新建路径仍生效')
    expect(en.nameRuleNoMatches).toContain('No matches right now')
    // The text-mode syntax hint teaches the spelling too.
    expect(zh.editorDefaults).toContain('{access}')
    expect(zh.editorDefaults).toContain('{surfaces}')
    expect(en.editorDefaults).toContain('{access}')
    expect(zh.examplesBody).toContain('仅保护 fs 工具')
    expect(zh.examplesBody).toContain('要让 bash 也受约束')
    expect(en.examplesBody).toContain('fs-tools protection only')
    expect(en.examplesBody).toContain('bash must be covered too')
    expect(zh.examplesBody).toContain('裸名')
    expect(en.examplesBody).toContain('bare name')
    expect(zh.examplesBody).toContain('**/.git')
    expect(en.examplesBody).toContain('**/.env')
  })

  it('fills placeholders and leaves unknown names verbatim', () => {
    expect(format('a {name} b', { name: 'x' })).toBe('a x b')
    expect(format('a {missing} b', { name: 'x' })).toBe('a {missing} b')
    expect(format('no placeholders')).toBe('no placeholders')
  })

  it('falls back to Chinese copy when the host supplies no t seat', () => {
    expect(fallbackTranslate('save')).toBe('保存')
    expect(fallbackTranslate('summaryCount', { count: 2 })).toContain('2 条')
    expect(fallbackTranslate('saveRefused')).toContain('home patch')
    expect(fallbackTranslate('statusForeign')).toBe('当前平台不适用')
    expect(fallbackTranslate('textErrorAtLine', { line: 4 })).toContain('第 4 行')
  })
})

describe('rendering in the host language', () => {
  it('renders the editor in English when the host selects a non-Chinese locale', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [{ path: '..', scope: 'always-write', surfaces: ['fs'] }] }),
      t: enTranslate,
      getWorkspaces,
    }))
    expect(html).toContain('Base workspace')
    expect(html).toContain('Save')
    expect(html).toContain('One rule per line')
    expect(html).toContain('deny')
    expect(html).toContain('Text mode')
    expect(html).not.toContain('基准工作区')
  })

  it('renders the editor hint in English, access vocabulary included', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [{ path: '~/.ssh', access: 'deny', surfaces: ['fs'] }] }),
      t: enTranslate,
      getWorkspaces,
    }))
    expect(html).toContain('name rule')
    expect(html).toContain('always-write')
    expect(html).toContain('fs+shell')
    expect(html).toContain('.ssh | deny | fs')
    expect(html).not.toContain('名称规则')
  })

  it('renders the summary in English too', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsSummary, {
      scope: scope({ paths: ['..', 'notes'] }),
      t: enTranslate,
    }))
    expect(html).toContain('Extra writable paths: 2 saved')
  })

  it('renders the capability banner in both languages', () => {
    const capabilities = { shellReadDeny: false, shellWriteDeny: false, shellReadOnly: false, shellDialect: 'landlock' }
    const rows = [{ path: '~/.ssh', access: 'deny' as const, surfaces: ['fs', 'shell'] as ('fs' | 'shell')[] }]
    const english = renderToStaticMarkup(React.createElement(CapabilityBanner, {
      capabilities,
      rows,
      t: enTranslate,
    }))
    expect(english).toContain('bash will not honor them')
    expect(english).toContain('landlock')
    const chinese = renderToStaticMarkup(React.createElement(CapabilityBanner, { capabilities, rows }))
    expect(chinese).toContain('bash 不受该限制')
    expect(chinese).toContain('fs 工具仍按规则拦截')
  })

  it('keeps the Chinese copy when the host gives the page no seat', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['..'] }),
      getWorkspaces,
    }))
    expect(html).toContain('基准工作区')
    expect(html).not.toContain('Base workspace')
  })
})
