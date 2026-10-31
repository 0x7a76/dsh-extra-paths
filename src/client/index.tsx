/**
 * Client half: contributes the Extra paths configuration page to the settings
 * dialog and to the plugin manager.
 *
 * THREE ENTRY POINTS, ONE PAGE — and the plugin manager asks for two different
 * views of it. `view: 'summary'` is the one-liner it lays out in its list;
 * anything else is the editor (`view: 'page'` on the entry's own page). Ignoring
 * that split is what used to render the whole form inline in the plugin list,
 * under the built-in plugins group, and pushed everything else off screen.
 *
 * - `settings.section` — a nav row in the settings dialog's left column. Declared
 *   by both host generations, so this is the entry point that always exists.
 * - 0.2.x `plugins.row.config` — a KEYED slot spelled `<bundle name>#<entry id>`.
 *   Our own row inside the `dsh-extra-paths` bundle gains a 配置 control that
 *   opens this page in the plugin manager. Present in every 0.2.x release
 *   (checked against 0.2.0-rc.2 and 0.2.1-rc.5).
 * - 0.1.5 `settings.plugin.item` — the keyed card of the older settings dialog,
 *   keyed by the settings namespace.
 *
 * The 0.2.x `plugins.item` slot is deliberately NOT registered: the shipped
 * contract reserves it for the host's own plugins ("用于官方插件", rendered in the
 * 内置插件配置 group). A third-party bundle belongs on its own row instead.
 *
 * TWO HOST GENERATIONS, ONE SCOPE. The settings scope this page edits moved in
 * 0.2.0: `ctx.settingsScope` (0.1.5) is gone and replaced by `ctx.configForms`
 * — which however exposes the SAME three methods the page was written against
 * (`getSnapshot`/`subscribe`/`set`). So the page keeps its narrow `PageScope`
 * interface and this file supplies whichever implementation the running host
 * has, through a late-bound proxy: the scope may not exist yet when the plugin
 * activates, and listing an absent service in `inject` would leave the plugin
 * waiting forever.
 *
 * Slot keys, register shapes and the module table were taken from the RUNNING
 * version's own official occupants (`dsh-client-ui-settings-agent-loop`,
 * `dsh-client-ui-settings-shell`) and their published contracts. A slot key that
 * nothing declares is inert under `ctx.slots.inject` (the callback never runs),
 * which is what lets one build register into both generations.
 *
 * Every @deepseek-ai/* import here is TYPE-ONLY (erased): the runtime services
 * arrive through cordis, and react resolves from the page's module table
 * (see dsh.client in package.json).
 * @module dsh-extra-paths/client
 */

import * as React from 'react'
// Type-only: documents where the two scope shapes come from. The installed apps
// do not necessarily carry these types, and this file declares what it uses.
import type {} from '@deepseek-ai/dsh-client-ui-settings'
import {
  ExtraPathsPage,
  ExtraPathsSummary,
  type PageScope,
  type WorkspacesHook,
  type WorkspaceListSurface,
} from './page'

/**
 * Client services this half needs.
 *
 * Only `slots`: the settings scope is fetched late-bound below, because the
 * 0.1.5 (`settingsScope`) and 0.2.x (`configForms`) providers differ and an
 * `inject` entry for a service that never appears would block activation.
 */
export const inject = ['slots']

/** The settings namespace this page edits — the one the host half registers. */
export const NAMESPACE = 'extra-paths'

/**
 * The plugin manager's key for our row: `<bundle name>#<entry id>`.
 *
 * The bundle name is the package name and the row id is the entry this repo's
 * `cordis.patch.yml` inserts; `tests/client-slots.test.ts` pins it against both
 * files so a rename cannot silently detach the config control.
 */
export const ROW_KEY = 'dsh-extra-paths#extra-paths'

/** The bound-settings scope 0.1.5 exposes. */
interface LegacySettingsScope {
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): PageScope
}

/** One form of the 0.2.x client settings service (`ctx.configForms`). */
interface ConfigForm<T> {
  getSnapshot(): PageScope extends { getSnapshot(): infer S } ? S : never
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

/** The 0.2.x client settings service (`ctx.configForms`). */
interface ConfigFormsSurface {
  get<T>(namespace: string): ConfigForm<T>
  whileServed?(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/** Minimal client context surface (the real types come from the merges above). */
interface ClientContext {
  get(name: string, strict?: boolean): unknown
  inject(names: readonly string[], callback: (scope: never) => void): unknown
  effect?(callback: () => unknown, label?: string): unknown
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: Record<string, unknown>, component: () => unknown): () => void
  }
}

/** The settings scope as 0.1.5 hands it over. */
interface LegacyScopeSurface {
  settingsScope: LegacySettingsScope
}

/** The 0.2.x settings service carrier. */
interface ConfigFormsCarrier {
  configForms: ConfigFormsSurface
}

/** What the plugin manager may hand a slot component besides the injected props. */
interface SlotProps {
  /** `summary` asks for the one-liner; `page` (and anything else) for the editor. */
  view?: string
  /** The shell's standard workspace hook, when the slot supplies one. */
  useWorkspaces?: unknown
}

/**
 * A `PageScope` that forwards to whichever real scope arrives.
 *
 * Subscribers are held here rather than on the real scope so a page that mounted
 * before the service appeared still repaints once it does.
 * @returns a stable scope plus its attach hook.
 */
export function lateBoundScope(): { scope: PageScope; attach: (next: PageScope | undefined) => void } {
  const listeners = new Set<() => void>()
  let real: PageScope | undefined
  let unsubscribe: (() => void) | undefined
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  return {
    scope: {
      getSnapshot: () => real?.getSnapshot() ?? { status: 'loading', value: undefined },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (field, value) => real?.set(field, value) ?? Promise.resolve(),
    },
    attach: (next) => {
      if (next === undefined) return
      unsubscribe?.()
      real = next
      unsubscribe = next.subscribe(notify)
      notify()
    },
  }
}

/**
 * Client entry.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  const { scope, attach } = lateBoundScope()

  // 0.1.5: a scope bound to our namespace by the settings UI package.
  ctx.inject(['settingsScope'], (child) => {
    const { settingsScope } = child as unknown as LegacyScopeSurface
    attach(settingsScope.bind({ namespace: NAMESPACE }))
  })

  // 0.2.x: the settings form controller, whose getSnapshot/subscribe/set are the
  // same three methods the page already used.
  ctx.inject(['configForms'], (child) => {
    const { configForms } = child as unknown as ConfigFormsCarrier
    attach({
      getSnapshot: () => configForms.get(NAMESPACE).getSnapshot(),
      subscribe: (listener) => configForms.get(NAMESPACE).subscribe(listener),
      set: (field, value) => configForms.get(NAMESPACE).set(field, value).then(() => undefined),
    })
  })

  // LAZY on purpose: reading `workspaces` once here happens before the registry
  // service necessarily exists, and a captured `undefined` would leave the base
  // workspace picker empty forever. The page calls this on every render, and
  // prefers the shell's own `useWorkspaces` standard prop when it is supplied.
  const getWorkspaces = (): WorkspaceListSurface | undefined =>
    ctx.get('workspaces', false) as WorkspaceListSurface | undefined
  const props = (): { scope: PageScope; getWorkspaces: () => WorkspaceListSurface | undefined } =>
    ({ scope, getWorkspaces })

  /** The editor, forwarding the shell's workspace hook when the slot carries one. */
  const renderPage = (slotProps?: SlotProps): React.ReactElement => React.createElement(ExtraPathsPage, {
    scope,
    getWorkspaces,
    // A non-function at that key must never reach a hook call.
    useWorkspaces: typeof slotProps?.useWorkspaces === 'function'
      ? slotProps.useWorkspaces as WorkspacesHook
      : undefined,
  })

  /** The slot component: one line for `summary`, the editor for every other view. */
  const card = (slotProps?: SlotProps): React.ReactElement =>
    slotProps?.view === 'summary'
      ? React.createElement(ExtraPathsSummary, { scope })
      : renderPage(slotProps)

  // A nav row in the settings dialog's left column. `id` is ours, so the row is
  // added beside the shipped sections rather than replacing one; `order` places
  // it after 插件 (15). `label` is a thunk, like every official registrant: it
  // satisfies both the string and the `() => string` form.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NAMESPACE,
    order: 40,
    label: () => '额外可写路径',
    locale: NAMESPACE,
    inject: props,
  }, card))

  // 0.1.5's settings dialog card: a KEYED slot, keyed by the settings namespace.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NAMESPACE,
    locale: NAMESPACE,
    inject: props,
  }, card))

  // 0.2.x: our own row inside the `dsh-extra-paths` bundle. The row gains a 配置
  // control that opens this page, instead of the editor sitting in the list.
  const registerRow = (): (() => void) => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: ROW_KEY,
    locale: NAMESPACE,
    inject: props,
  }, card))

  // Only while the host actually serves our namespace: a configure control for a
  // plugin that is not loaded would open a page with nothing behind it.
  const forms = ctx.get('configForms', false) as ConfigFormsSurface | undefined
  if (typeof forms?.whileServed === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() => forms.whileServed?.([NAMESPACE], registerRow) ?? registerRow(), 'extra-paths: row page while served')
  } else {
    registerRow()
  }
}
