/**
 * Client half: contributes the Extra paths configuration page to the settings
 * dialog twice — as a `settings.section` nav row (the settings sidebar) and as
 * the plugin's own card (0.1.5: `settings.plugin.item`, keyed by the settings
 * namespace; 0.2.x: `plugins.item`, a list slot).
 *
 * TWO HOST GENERATIONS, ONE PAGE. The settings scope this page edits moved in
 * 0.2.0: `ctx.settingsScope` (0.1.5) is gone and replaced by `ctx.configForms`
 * — which however exposes the SAME three methods the page was written against
 * (`getSnapshot`/`subscribe`/`set`). So the page keeps its narrow `PageScope`
 * interface and this file supplies whichever implementation the running host
 * has, through a late-bound proxy: the scope may not exist yet when the plugin
 * activates, and listing an absent service in `inject` would leave the plugin
 * waiting forever.
 *
 * Slot keys, register shapes and the module table were taken from the RUNNING
 * version's own official occupants (`dsh-client-ui-settings-plugins`,
 * `dsh-client-ui-settings-agent-loop`) and their published contracts. A slot key
 * that nothing declares is inert under `ctx.slots.inject` (the callback never
 * runs), which is what lets one build register into both generations' cards.
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
import { ExtraPathsPage, type PageScope, type WorkspaceListSurface } from './page'

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
  const page = (): React.ReactElement => React.createElement(ExtraPathsPage, props())

  // A nav row in the settings dialog's left column. `id` is ours, so the row is
  // added beside the shipped sections rather than replacing one; `order` places
  // it after 插件 (15).
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NAMESPACE,
    order: 40,
    // A thunk, like every official registrant: it satisfies both the string and
    // the `() => string` form of `label`, and is re-read on each projection.
    label: () => '额外可写路径',
    locale: NAMESPACE,
    inject: props,
  }, page))

  // The same page as this plugin's card in the 插件 section's configurable tab.
  // 0.1.5 spells this key `settings.plugin.item` and shapes it as a KEYED slot
  // (`key` = the settings namespace the card edits).
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NAMESPACE,
    locale: NAMESPACE,
    inject: props,
  }, page))

  // 0.2.x renamed that slot to `plugins.item` and made it a list slot
  // (id/order/label). An undeclared slot key is inert under `slots.inject`, so
  // both spellings are registered and whichever host is running picks its own;
  // official 0.2.x cards additionally wait for the host to serve the namespace,
  // which `whileServed` does when the service offers it.
  const registerCard = (): (() => void) => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: NAMESPACE,
    order: 40,
    label: () => '额外可写路径',
    locale: NAMESPACE,
    inject: props,
  }, page))
  const forms = ctx.get('configForms', false) as ConfigFormsSurface | undefined
  if (typeof forms?.whileServed === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() => forms.whileServed?.([NAMESPACE], registerCard) ?? registerCard(), 'extra-paths: card while served')
  } else {
    registerCard()
  }
}
