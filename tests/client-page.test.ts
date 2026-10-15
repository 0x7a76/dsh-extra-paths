import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExtraPathsPage, type PageScope, type WorkspacesHook } from '../src/client/page.js'

/**
 * The page had no rendering test at all, so layout mistakes (a `width: 100%`
 * field overflowing its card because nothing declared `box-sizing`) could only
 * be found by the user looking at the browser. `renderToStaticMarkup` runs the
 * component without a DOM, which is enough to pin the emitted markup, styles and
 * copy, and to catch a render-time crash.
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

describe('ExtraPathsPage', () => {
  it('renders the toolbar, a row, and the resolved column for a relative spelling', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [{ path: '..', scope: 'always-write', surfaces: ['fs'] }] }),
      getWorkspaces,
    }))
    expect(html).toContain('路径 1')
    expect(html).toContain('添加工作区上一层（..）')
    expect(html).toContain('保存')
    // `..` resolved against the base workspace, live and before any save.
    expect(html).toContain('解析为')
    expect(html).toContain('>/home/user/work</code>')
  })

  it('offers the workspace list as a real dropdown, not an invisible datalist', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['notes'] }),
      getWorkspaces,
    }))
    // A `<select>` with the candidate — a datalist only shows up on some
    // browsers' own terms, which is why "可下拉选择" appeared broken.
    expect(html).toContain('<select')
    expect(html).toContain(`value="${WORKSPACE}"`)
    expect(html).toContain(`>${WORKSPACE}</option>`)
  })

  it('prefers the shell hook over the lazy fallback', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['..'] }),
      useWorkspaces,
    }))
    // Adopted from the hook even though no service fallback was passed.
    expect(html).toContain('>/home/user/work</code>')
  })

  it('declares border-box on the fields, so a 100%-wide input cannot overflow its card', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['/home/user/notes'] }),
      getWorkspaces,
    }))
    // Without this the input's padding + border push it past the card edge: the
    // exact defect the page shipped with.
    expect(html).toContain('box-sizing:border-box')
    expect(html).toContain('width:100%')
  })

  it('replaces the shell\'s heavy focus ring with an accent one', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['/home/user/notes'] }),
      getWorkspaces,
    }))
    expect(html).toContain(':focus-visible')
    expect(html).toContain('outline: none')
    expect(html).toContain('xp-input')
  })

  it('says what is missing instead of "preview unavailable" when there is no base', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: ['notes'] }),
    }))
    expect(html).toContain('相对路径需要基准工作区')
    expect(html).toContain('先在上面选择或填写「基准工作区」')
  })

  it('renders the empty state without a row', () => {
    const html = renderToStaticMarkup(React.createElement(ExtraPathsPage, {
      scope: scope({ paths: [] }),
      getWorkspaces,
    }))
    expect(html).toContain('还没有配置路径')
  })
})
