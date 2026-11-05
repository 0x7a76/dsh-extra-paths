/**
 * The Extra paths settings page: one card per configured path, localized copy,
 * a LIVE lexical resolution per row against a base workspace, quick add
 * buttons, and the host's authoritative preview of the DRAFT (unsaved rows).
 *
 * Copy follows the host's own language selection: every string comes from the
 * dictionaries registered by `../client/index` through the framework-injected
 * `t` seat, and the Chinese dictionary is the built-in fallback for a host that
 * supplies no seat at all (0.1.5 slots, unit tests).
 *
 * The base workspace comes from the shell's standard `useWorkspaces` hook when
 * the slot supplies it — a snapshot read once during activation would be
 * `undefined` whenever the registry had not loaded yet, which is exactly how the
 * picker ended up empty. `getWorkspaces` stays as a lazy fallback for
 * compositions that pass no standard props.
 * @module dsh-extra-paths/client/page
 */

import * as React from 'react'
import { fallbackTranslate, zh, type Translate } from './locales'
import { resolveLexically } from './paths'
import { fetchPreview, type PreviewEntry, type PreviewResult } from './preview'
import { css, styles } from './styles'

type Scope = 'write' | 'always-write'
type Surface = 'fs' | 'shell'
type Status = PreviewEntry['status']

/** One editable row. */
interface Row {
  path: string
  scope: Scope
  surfaces: Surface[]
}

/** The settings section this page edits. */
interface Section {
  paths?: readonly (string | { path?: string; scope?: Scope; surfaces?: readonly Surface[] })[]
}

/** The bound settings scope surface (shape from @deepseek-ai/dsh-client-ui-settings). */
export interface PageScope {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: Section | undefined; revision?: number }
  subscribe(listener: () => void): () => void
  /**
   * Persist one field. The 0.2.x host answers `false` when it REFUSES the write
   * (verified refusal: a home patch or command-line overlay owns this
   * namespace — DSH's config editor refuses settings-page writes then); the
   * page must surface that instead of treating the promise as saved. The
   * 0.1.5 scope resolves `void` on success.
   */
  set(field: string, value: unknown): Promise<boolean | void>
}

/**
 * Marker carried by a refusal raised in the late-bound scope. The page maps it
 * to localized copy instead of showing the scope's internal message.
 */
export const SAVE_REFUSED_CODE = 'extra-paths/save-refused'

/**
 * Message carried by that marker error (Chinese). The page shows the localized
 * `saveRefused` copy; this text only reaches logs/tests.
 */
export const SAVE_REFUSED_MESSAGE = zh.saveRefused

/** Build the refusal error the page recognizes. */
export function saveRefusedError(): Error {
  const error = new Error(SAVE_REFUSED_MESSAGE)
  ;(error as Error & { code?: string }).code = SAVE_REFUSED_CODE
  return error
}

/** Whether a rejected save is the host refusing the write. */
export function isSaveRefused(cause: unknown): boolean {
  return (cause as { code?: unknown } | undefined)?.code === SAVE_REFUSED_CODE
}

/** Workspace list surface (the lazy fallback when no standard hook is supplied). */
export interface WorkspaceListSurface {
  list?: { getSnapshot?: () => { items?: readonly { path?: string }[] } }
}

/** The shell's standard snapshot-selector hook for the workspace registry. */
export type WorkspacesHook = (selector: (snapshot: unknown) => unknown) => unknown

// Stable identities: the hook must be called on every render with a selector the
// hook can compare by reference.
const NOOP_HOOK: WorkspacesHook = () => undefined
const IDENTITY = (snapshot: unknown): unknown => snapshot

function itemsOf(value: unknown): readonly { path?: string }[] {
  const items = (value as { items?: unknown } | undefined)?.items
  return Array.isArray(items) ? (items as readonly { path?: string }[]) : []
}

const STATUS_STYLE: Record<Status, React.CSSProperties> = {
  ok: styles.statusOk,
  missing: styles.statusMissing,
  rejected: styles.statusRejected,
}

function rowsOf(section: Section | undefined): Row[] {
  const rows: Row[] = []
  for (const item of section?.paths ?? []) {
    if (typeof item === 'string') rows.push({ path: item, scope: 'write', surfaces: ['fs', 'shell'] })
    else rows.push({ path: item.path ?? '', scope: item.scope ?? 'write', surfaces: [...(item.surfaces ?? ['fs', 'shell'])] })
  }
  return rows
}

function payloadOf(rows: readonly Row[]): unknown[] {
  return rows
    .filter(row => row.path.trim() !== '')
    .map(row => ({ path: row.path.trim(), scope: row.scope, surfaces: [...row.surfaces] }))
}

function useSnapshot(scope: PageScope): { status: string; value: Section | undefined } {
  const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
  React.useEffect(() => scope.subscribe(() => { setSnapshot(scope.getSnapshot()) }), [scope])
  return snapshot
}

/**
 * The one-liner the plugin manager shows in its list (`view: 'summary'`).
 *
 * The manager renders every configuration entry twice: a compact summary in the
 * list, and the full view on the entry's own page. Rendering the editor for both
 * is what used to fill the Plugins page with the whole form, so the summary is a
 * separate component that can never grow one.
 * @param props - the bound settings scope and the host's translate seat.
 */
export function ExtraPathsSummary({ scope, t }: { scope: PageScope; t?: Translate }): React.ReactElement {
  const translate = t ?? fallbackTranslate
  const { status, value } = useSnapshot(scope)
  const rows = rowsOf(value).filter(row => row.path.trim() !== '')
  const text = status === 'loading'
    ? translate('summaryLoading')
    : status === 'unavailable'
      ? translate('summaryUnavailable')
      : rows.length === 0
        ? translate('summaryEmpty')
        : translate('summaryCount', { count: rows.length })
  return <span style={styles.dim}>{text}</span>
}

/**
 * Render the page.
 * @param props - the bound settings scope, the host's translate seat, the
 * standard workspace hook, and the lazy fallback used when the composition
 * supplies no standard props.
 */
export function ExtraPathsPage({ scope, t, getWorkspaces, useWorkspaces }: {
  scope: PageScope
  t?: Translate
  getWorkspaces?: () => WorkspaceListSurface | undefined
  useWorkspaces?: WorkspacesHook
}): React.ReactElement {
  const tr = t ?? fallbackTranslate
  const snapshot = useSnapshot(scope)

  // The hook re-renders this page whenever the registry moves; the fallback is a
  // per-render read so a service that appears later is still picked up. Both run
  // BEFORE the state hooks below so the base can adopt the first candidate in its
  // initializer — an effect alone would leave the first paint (and every
  // server-rendered check) without a base.
  const selectWorkspaces = useWorkspaces ?? NOOP_HOOK
  const fromHook = itemsOf(selectWorkspaces(IDENTITY))
  const items = fromHook.length > 0 ? fromHook : itemsOf(getWorkspaces?.()?.list?.getSnapshot?.())
  const candidates = items
    .map(item => item.path)
    .filter((path): path is string => typeof path === 'string' && path !== '')

  const [rows, setRows] = React.useState<Row[]>(() => rowsOf(snapshot.value))
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [preview, setPreview] = React.useState<PreviewResult | undefined>(undefined)
  const [cwd, setCwd] = React.useState<string>(() => candidates[0] ?? '')
  const [cwdPinned, setCwdPinned] = React.useState(false)
  const [manualBase, setManualBase] = React.useState(false)

  // Adopt host changes only while the user has no staged edits.
  React.useEffect(() => {
    if (!dirty) setRows(rowsOf(snapshot.value))
  }, [snapshot, dirty])

  // The list can arrive AFTER the first render, so the base is adopted when it
  // shows up — unless the user already typed or picked one.
  const first = candidates[0]
  React.useEffect(() => {
    if (!cwdPinned && cwd === '' && first !== undefined) setCwd(first)
  }, [cwdPinned, cwd, first])

  // The base may be spelled with `~` — the host expands it the same way it
  // expands a row. Until the first answer reports the home directory a `~` base
  // resolves to nothing rather than to a wrong path.
  const typedBase = cwd.trim()
  const usableBase = typedBase.startsWith('/') || typedBase === '~' || typedBase.startsWith('~/')
  const base = typedBase.startsWith('~') ? (resolveLexically(typedBase, '', preview?.home) ?? '') : typedBase

  // The host preview answers for the DRAFT (debounced so typing stays cheap):
  // previously it described only the stored document, which made configuring a
  // relative path a guess-until-you-save exercise.
  const request = JSON.stringify(payloadOf(rows))
  React.useEffect(() => {
    if (base === '') return
    let live = true
    const timer = setTimeout(() => {
      const draft = JSON.parse(request) as unknown[]
      void fetchPreview(base, draft).then(result => { if (live) setPreview(result) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [base, request, snapshot])

  const update = (index: number, patch: Partial<Row>): void => {
    setDirty(true)
    setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const toggleSurface = (index: number, surface: Surface): void => {
    const row = rows[index]
    if (row === undefined) return
    const surfaces = row.surfaces.includes(surface)
      ? row.surfaces.filter(item => item !== surface)
      : [...row.surfaces, surface]
    update(index, { surfaces })
  }
  const append = (path: string): void => {
    setDirty(true)
    setRows(current => [...current, { path, scope: 'write', surfaces: ['fs', 'shell'] }])
  }
  const reset = (): void => {
    setRows(rowsOf(snapshot.value))
    setDirty(false)
    setError(undefined)
  }
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    void scope.set('paths', payloadOf(rows))
      .then((accepted) => {
        // `false` is the host's refusal (a legacy 0.1.5 scope resolves void).
        // Treating it as saved is what made a deleted row snap back silently.
        if (accepted === false) setError(tr('saveRefused'))
        else setDirty(false)
      })
      .catch((cause: unknown) => {
        setError(isSaveRefused(cause) ? tr('saveRefused') : cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setBusy(false) })
  }
  const hostEntriesOf = (path: string): readonly PreviewEntry[] =>
    preview?.entries.filter(entry => entry.raw === path.trim()) ?? []
  const hostEntryOf = (path: string): PreviewEntry | undefined => hostEntriesOf(path)[0]

  const picker = !manualBase && candidates.length > 0
  const known = candidates.includes(typedBase)

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <div style={styles.intro}>
        {tr('introBefore')}<strong>{tr('introNoApproval')}</strong>{tr('introAfter')}
        {tr('introRuleBefore')}<strong>{tr('introRuleEmphasis')}</strong>{tr('introRuleAfter')}
      </div>

      <div style={styles.baseRow}>
        <span style={styles.cardTitle}>{tr('baseWorkspace')}</span>
        {picker
          ? (
            <select
              className="xp-select"
              style={styles.baseField}
              value={known ? typedBase : ''}
              onChange={event => { setCwdPinned(true); setCwd(event.target.value) }}
            >
              {known ? null : <option value={typedBase}>{typedBase === '' ? tr('notSelected') : typedBase}</option>}
              {candidates.map(path => <option key={path} value={path}>{path}</option>)}
            </select>
          )
          : (
            <input
              className="xp-input"
              style={styles.baseField}
              value={cwd}
              placeholder={tr('basePlaceholder')}
              onChange={event => { setCwdPinned(true); setCwd(event.target.value) }}
            />
          )}
        {candidates.length > 0
          ? (
            <button type="button" className="xp-link" onClick={() => { setManualBase(!manualBase) }}>
              {picker ? tr('manualBase') : tr('pickBase')}
            </button>
          )
          : null}
        <span style={styles.dim}>{tr('baseHint')}</span>
      </div>

      <div style={styles.toolbar}>
        <button type="button" className="xp-button xp-button-on" disabled={busy || !dirty} onClick={save}>
          {busy ? tr('saving') : tr('save')}
        </button>
        <button type="button" className="xp-button" onClick={() => { append('') }}>{tr('addPath')}</button>
        <button type="button" className="xp-button" onClick={() => { append('..') }}>{tr('addParent')}</button>
        <button type="button" className="xp-button" disabled={!dirty} onClick={reset}>{tr('discard')}</button>
        <span style={styles.dim}>{dirty ? tr('dirty') : tr('synced')}</span>
      </div>

      {rows.length === 0
        ? <div style={styles.dim}>{tr('emptyPaths')}</div>
        : null}

      {rows.map((row, index) => {
        // A pattern row has no single lexical resolution — the HOST expands it by
        // walking the filesystem, so the row reports the match count instead of
        // pretending `**` is a directory name.
        const patternRow = row.path.includes('*')
        const resolved = patternRow ? undefined : resolveLexically(row.path, base, preview?.home)
        const hostMatches = hostEntriesOf(row.path)
        const hostEntry = hostEntryOf(row.path)
        return (
          // The key must NOT contain anything the user is editing: keying by the
          // path itself remounted the card on every keystroke and the input lost
          // focus after the first character. Position is a stable identity here.
          <div style={styles.card} key={index}>
            <div style={styles.cardHead}>
              <span style={styles.cardTitle}>{tr('rowTitle', { index: index + 1 })}</span>
              <span style={styles.cardHeadRight}>
                {hostEntry !== undefined
                  ? (
                    <span style={STATUS_STYLE[hostEntry.status]}>
                      [{tr(hostEntry.status === 'ok' ? 'statusOk' : hostEntry.status === 'missing' ? 'statusMissing' : 'statusRejected')}
                      {hostMatches.length > 1 ? ` ×${hostMatches.length}` : ''}]
                    </span>
                  )
                  : null}
                <button
                  type="button"
                  className="xp-link"
                  onClick={() => { setDirty(true); setRows(current => current.filter((_, i) => i !== index)) }}
                >
                  {tr('delete')}
                </button>
              </span>
            </div>
            <input
              className="xp-input"
              style={styles.pathInput}
              value={row.path}
              placeholder={tr('pathPlaceholder')}
              onChange={event => { update(index, { path: event.target.value }) }}
            />
            <div style={styles.resolvedRow}>
              {patternRow
                ? (
                  <span style={styles.dim}>
                    {tr('patternResolved')}
                    {' '}
                    {hostMatches.length > 0
                      ? tr('patternMatches', { count: hostMatches.length })
                      : tr('patternNoMatches')}
                  </span>
                )
                : resolved === undefined
                ? <span style={styles.dim}>
                  {row.path.trim() === ''
                    ? tr('resolvePendingEmpty')
                    : typedBase === ''
                      ? tr('resolveNeedsBase')
                      : !usableBase
                        ? tr('resolveBaseInvalid')
                        : tr('resolveNeedsHome')}
                </span>
                : (
                  <>
                    <span style={styles.dim}>{tr('resolvedAs')}</span>
                    <code style={styles.code}>{resolved}</code>
                    {hostEntry !== undefined && hostEntry.resolved !== resolved
                      ? <span style={styles.dim}>{tr('hostResolved', { path: hostEntry.resolved })}</span>
                      : null}
                  </>
                )}
            </div>
            <div style={styles.controlsRow}>
              <label style={styles.field}>
                {tr('mode')}
                <select
                  className="xp-select"
                  value={row.scope}
                  onChange={event => { update(index, { scope: event.target.value as Scope }) }}
                >
                  <option value="write">{tr('scopeWrite')}</option>
                  <option value="always-write">{tr('scopeAlways')}</option>
                </select>
              </label>
              <div style={styles.pills}>
                <span style={styles.dim}>{tr('surfaces')}</span>
                <button
                  type="button"
                  className={row.surfaces.includes('fs') ? 'xp-button xp-button-on' : 'xp-button xp-button-off'}
                  onClick={() => { toggleSurface(index, 'fs') }}
                >
                  {tr('surfaceFs')}
                </button>
                <button
                  type="button"
                  className={row.surfaces.includes('shell') ? 'xp-button xp-button-on' : 'xp-button xp-button-off'}
                  onClick={() => { toggleSurface(index, 'shell') }}
                >
                  {tr('surfaceShell')}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {error !== undefined && <div style={styles.warn}>{error}</div>}

      <div style={styles.panel}>
        <div style={styles.panelHead}>
          {tr('previewTitle')}{dirty ? tr('previewDirty') : ''}
          {preview !== undefined ? <span style={styles.dim}>{tr('previewEffective', { count: preview.effective.length })}</span> : null}
        </div>
        {typedBase === ''
          ? <div style={styles.dim}>{tr('previewNoBase')}</div>
          : !usableBase
            ? <div style={styles.dim}>{tr('previewBadBase')}</div>
            : base === ''
              ? <div style={styles.dim}>{tr('previewExpandingHome')}</div>
              : preview === undefined
                ? <div style={styles.dim}>{tr('previewUnavailable')}</div>
                : (
                  <>
                    {preview.entries.length === 0
                      ? <div style={styles.dim}>{tr('previewEmpty')}</div>
                      : preview.entries.map((entry, index) => (
                        <div style={styles.entry} key={`${index}-${entry.raw}`}>
                          <span style={STATUS_STYLE[entry.status]}>
                            [{tr(entry.status === 'ok' ? 'statusOk' : entry.status === 'missing' ? 'statusMissing' : 'statusRejected')}]
                          </span>
                          <code style={styles.code}>{entry.raw}</code>
                          <span style={styles.dim}>→</span>
                          <code style={styles.code}>{entry.resolved === '' ? tr('unresolved') : entry.resolved}</code>
                        </div>
                      ))}
                    {preview.warnings.map(warning => <div style={styles.warn} key={warning}>{warning}</div>)}
                  </>
                )}
      </div>
    </div>
  )
}
