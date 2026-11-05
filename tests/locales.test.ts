import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  en, fallbackTranslate, format, zh, type ExtraPathsLocaleKey, type Translate,
} from '../src/client/locales.js'
import { ExtraPathsSummary, ExtraPathsPage, type PageScope } from '../src/client/page.js'

/**
 * DSH picks the UI language; this plugin registers zh/en dictionaries and lets
 * the framework-injected `t` seat translate every string. These pin the two
 * invariants a translator can break silently: identical key sets between the
 * baseline locales, and identical placeholder sets per key (a `{count}` lost in
 * translation renders a sentence with a hole).
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

  it('fills placeholders and leaves unknown names verbatim', () => {
    expect(format('a {name} b', { name: 'x' })).toBe('a x b')
    expect(format('a {missing} b', { name: 'x' })).toBe('a {missing} b')
    expect(format('no placeholders')).toBe('no placeholders')
  })

  it('falls back to Chinese copy when the host supplies no t seat', () => {
    expect(fallbackTranslate('save')).toBe('保存')
    expect(fallbackTranslate('summaryCount', { count: 2 })).toContain('2 条')
    expect(fallbackTranslate('saveRefused')).toContain('home patch')
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
    expect(html).toContain('Add the workspace parent (..)')
    expect(html).toContain('Save')
    expect(html).toContain('Path 1')
    expect(html).toContain('Resolves to')
    expect(html).not.toContain('基准工作区')
  })

  it('renders the summary in English too', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsSummary, {
      scope: scope({ paths: ['..', 'notes'] }),
      t: enTranslate,
    }))
    expect(html).toContain('Extra writable paths: 2 saved')
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
