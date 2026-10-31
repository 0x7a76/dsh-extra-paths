import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply, NAMESPACE, ROW_KEY } from '../src/client/index.js'
import { ExtraPathsSummary, type PageScope } from '../src/client/page.js'

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

/** A context that records registrations and serves no services at all. */
function fakeContext(configForms?: unknown): { ctx: never; registered: Registered[]; effects: string[] } {
  const registered: Registered[] = []
  const effects: string[] = []
  const ctx = {
    // Every looked-up service is absent: the page has to survive that.
    get: (name: string) => (name === 'configForms' ? configForms : undefined),
    inject: () => {},
    effect: (callback: () => unknown, label?: string) => {
      effects.push(label ?? '')
      callback()
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
  return { ctx: ctx as never, registered, effects }
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
