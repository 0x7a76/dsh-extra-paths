import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply, lateBoundScope, NAMESPACE, ROW_KEY } from '../src/client/index.js'
import { en, zh, type ExtraPathsLocaleKey, type Translate } from '../src/client/locales.js'
import { ExtraPathsSummary, SAVE_REFUSED_MESSAGE, type PageScope } from '../src/client/page.js'

/**
 * The slot registrations had no test at all, and the plugin list ended up
 * rendering this plugin's whole editor inline because the registration ignored
 * which view the host asked for. These pin the keys (and the bundle#row key the
 * plugin manager matches on) so a host rename cannot silently detach the page.
 */

interface Registered {
  slot: string
  options: Record<string, unknown>
  component: (props?: Record<string, unknown>) => React.ReactElement
}

/** A context that records registrations and the locale dictionaries it saw. */
function fakeContext(configForms?: unknown): {
  ctx: never
  registered: Registered[]
  effects: string[]
  locales: { namespace: string; dictionaries: Record<string, Record<string, string>> }[]
  bound: string[]
} {
  const registered: Registered[] = []
  const effects: string[] = []
  const locales: { namespace: string; dictionaries: Record<string, Record<string, string>> }[] = []
  const bound: string[] = []
  const ctx = {
    // Every looked-up service is absent: the page has to survive that.
    get: (name: string) => (name === 'configForms' ? configForms : undefined),
    inject: () => {},
    effect: (callback: () => unknown, label?: string) => {
      effects.push(label ?? '')
      callback()
    },
    locale: {
      register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => {
        locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind: (namespace: string) => {
        bound.push(namespace)
        return ((key: ExtraPathsLocaleKey) => `t:${key}`) as Translate
      },
    },
    slots: {
      inject: (slot: string, callback: () => unknown) => { callback(); return () => {} },
      register: (options: Record<string, unknown>, component: unknown) => {
        registered.push({
          slot: String(options.name),
          options,
          component: component as Registered['component'],
        })
        return () => {}
      },
    },
  }
  return { ctx: ctx as never, registered, effects, locales, bound }
}

function scope(value: unknown, status: 'ready' | 'loading' = 'ready'): PageScope {
  return {
    getSnapshot: () => ({ status, value: value as never }),
    subscribe: () => () => {},
    set: async () => {},
  }
}

const bySlot = (registered: Registered[], slot: string): Registered | undefined =>
  registered.find(entry => entry.slot === slot)

describe('client slot registrations', () => {
  it('registers the settings row, the 0.1.5 card, and the 0.2.x row page', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx)

    expect(registered.map(entry => entry.slot)).toEqual([
      'settings.section',
      'settings.plugin.item',
      'plugins.row.config',
    ])
    // 0.1.5's card is keyed by the settings namespace; 0.2.x's row page is keyed
    // by `<bundle>#<row id>`.
    expect(bySlot(registered, 'settings.plugin.item')?.options.key).toBe(NAMESPACE)
    expect(bySlot(registered, 'plugins.row.config')?.options.key).toBe(ROW_KEY)
  })

  it('does not register the slot the host reserves for its own plugins', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    // `plugins.item` renders in the built-in plugins group of the Plugins page;
    // a third-party bundle registering there is what buried the list.
    expect(registered.some(entry => entry.slot === 'plugins.item')).toBe(false)
  })

  it('waits for the host to serve the namespace when the service can tell', () => {
    const served: string[][] = []
    const configForms = {
      get: () => ({ getSnapshot: () => ({ status: 'ready', value: undefined }), subscribe: () => () => {}, set: async () => true }),
      whileServed: (namespaces: readonly string[], register: (next: ReadonlySet<string>) => () => void) => {
        served.push([...namespaces])
        register(new Set(namespaces))
        return () => {}
      },
    }
    const { ctx, registered, effects } = fakeContext(configForms)
    apply(ctx)

    expect(served).toEqual([[NAMESPACE]])
    expect(bySlot(registered, 'plugins.row.config')).toBeDefined()
    expect(effects.some(label => label.includes('row page'))).toBe(true)
  })

  it('answers the summary view with one line and the page view with the editor', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const card = bySlot(registered, 'plugins.row.config')?.component
    expect(card).toBeDefined()

    const summary = renderToStaticMarkup(React.createElement(card!, { view: 'summary' }))
    expect(summary).toContain('额外可写路径')
    expect(summary).not.toContain('添加工作区上一层（..）')

    const page = renderToStaticMarkup(React.createElement(card!, { view: 'page' }))
    expect(page).toContain('基准工作区')
    expect(page).toContain('添加工作区上一层（..）')
  })

  it('registers the zh/en dictionaries for its namespace and binds that namespace', () => {
    const { ctx, locales, bound } = fakeContext()
    apply(ctx)
    expect(bound).toEqual([NAMESPACE])
    expect(locales.map(entry => entry.namespace)).toEqual([NAMESPACE])
    const dictionaries = locales[0]?.dictionaries ?? {}
    expect(Object.keys(dictionaries).sort()).toEqual(['en', 'zh'])
    expect(Object.keys(dictionaries.zh ?? {}).length).toBeGreaterThan(30)
    expect(Object.keys(dictionaries.en ?? {}).length).toBe(Object.keys(dictionaries.zh ?? {}).length)
  })

  it('localizes the nav label through the bound translate function', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const label = bySlot(registered, 'settings.section')?.options.label
    expect(typeof label).toBe('function')
    // The fake bind maps every key to `t:<key>`; a hard-coded Chinese label
    // would not change with the host language.
    expect((label as () => string)()).toBe('t:navLabel')
  })

  it('hands the framework t seat down to both views', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const card = bySlot(registered, 'plugins.row.config')?.component
    const t = ((key: ExtraPathsLocaleKey) => `⟦${key}⟧`) as Translate

    // The fake context binds no settings scope, so the summary is in its
    // loading state; any translated key proves the seat reached the component.
    const summary = renderToStaticMarkup(React.createElement(card!, { view: 'summary', t }))
    expect(summary).toContain('⟦summaryLoading⟧')

    const page = renderToStaticMarkup(React.createElement(card!, { view: 'page', t }))
    expect(page).toContain('⟦baseWorkspace⟧')
    expect(page).not.toContain('基准工作区')
  })

  it('keeps every locale dictionary non-empty and complete', () => {
    const { ctx, locales } = fakeContext()
    apply(ctx)
    const dictionaries = locales[0]?.dictionaries ?? {}
    const keys = Object.keys(zh).sort() as ExtraPathsLocaleKey[]
    for (const locale of ['zh', 'en'] as const) {
      expect(Object.keys(dictionaries[locale] ?? {}).sort()).toEqual(keys)
      for (const key of keys) expect((dictionaries[locale] ?? {})[key]?.trim()).not.toBe('')
    }
    // The two baseline dictionaries carry the same keys; `en` is the host's
    // fallback for any other UI language.
    expect(Object.keys(en).sort()).toEqual(keys)
  })

  it('keeps the row key equal to the package name and the patch entry id', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string }
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const rowId = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1]
    expect(rowId).toBeDefined()
    // The plugin manager matches `plugins.row.config` on exactly this string; if
    // the bundle patch ever renames the row, the configure control would vanish.
    expect(ROW_KEY).toBe(`${pkg.name}#${rowId}`)
  })
})

describe('ExtraPathsSummary', () => {
  it('counts the configured paths', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsSummary, {
      scope: scope({ paths: ['..', { path: 'notes', scope: 'always-write' }] }),
    }))
    expect(html).toContain('2 条')
  })

  it('says nothing is configured instead of leaving a blank line', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsSummary, { scope: scope({ paths: [] }) }))
    expect(html).toContain('尚未配置')
  })

  it('reports the loading state rather than a false zero', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsSummary, {
      scope: scope(undefined, 'loading'),
    }))
    expect(html).toContain('读取中')
  })
})

// ── 0.2.2 host refusal → visible error, never a silent snap-back ─────────────
// The config editor REFUSES a settings-page write when a home patch or a
// command-line overlay owns the namespace, and the client API answers `false`
// (no message). The page used to drop that boolean, clear `dirty`, and repaint
// the host value — a deleted row simply reappeared. These pin the propagation.

describe('lateBoundScope save results', () => {
  const boundScope = (set: PageScope['set']): PageScope => {
    const { scope, attach } = lateBoundScope()
    attach({
      getSnapshot: () => ({ status: 'ready', value: { paths: [] } }),
      subscribe: () => () => {},
      set,
    })
    return scope
  }

  it('turns a host refusal (`false`) into a rejection carrying the explanation', async () => {
    const scope = boundScope(async () => false)
    await expect(scope.set('paths', [])).rejects.toThrow(SAVE_REFUSED_MESSAGE)
  })

  it('passes an accepted write through', async () => {
    const scope = boundScope(async () => true)
    await expect(scope.set('paths', [])).resolves.toBe(true)
  })

  it('treats the 0.1.5 scope (resolves void) as accepted', async () => {
    const scope = boundScope(async () => {})
    await expect(scope.set('paths', [])).resolves.toBeUndefined()
  })

  it('resolves without a bound scope, so a page mounted early cannot hang', async () => {
    const { scope } = lateBoundScope()
    await expect(scope.set('paths', [])).resolves.toBeUndefined()
  })
})
