/**
 * The Extra paths settings page: ONE plain-text editor for every rule
 * (`path | access | surfaces` per line, with an always-visible defaults line and
 * a collapsible examples block), the base-workspace picker used only for the
 * preview, and the host's authoritative preview of the DRAFT.
 *
 * Why the page looks like this: rows and mode switches were removed after the
 * third round of UI feedback — the text form is the single source of truth, and
 * Save is the only action. Saving always writes the structured
 * `{path, access, surfaces}` array; the editor is only a view of it.
 *
 * Copy follows the host's own language selection: every string comes from the
 * dictionaries registered by `./index` through the framework-injected `t` seat,
 * and the Chinese dictionary is the built-in fallback for a host that supplies
 * no seat at all (0.1.5 slots, unit tests).
 *
 * The base workspace comes from the shell's standard `useWorkspaces` hook when
 * the slot supplies it — a snapshot read once during activation would be
 * `undefined` whenever the registry had not loaded yet, which is exactly how the
 * picker ended up empty. `getWorkspaces` stays as a lazy fallback for
 * compositions that pass no standard props.
 * @module dsh-extra-paths/client/page
 */

import * as React from 'react'
import type { Access } from '../config'
import { fallbackTranslate, zh, type ExtraPathsLocaleKey, type Translate } from './locales'
import {
  defaultsOf,
  hostViewOf,
  isNameRulePath,
  parseRules,
  payloadOf,
  previewBaseOf,
  resolveBase,
  rowsOf,
  serializeRules,
  type BaseResult,
  type Rule,
  type Section,
  type TextError,
  type TextErrorCode,
} from './paths'
import {
  fetchPreview,
  type PreviewCapabilities,
  type PreviewEntry,
  type PreviewResult,
} from './preview'
import { css, styles } from './styles'

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

const ACCESS_LABEL: Record<Access, ExtraPathsLocaleKey> = {
  deny: 'accessDeny',
  read: 'accessRead',
  write: 'accessWrite',
  'always-write': 'accessAlways',
}

const STATUS_LABEL: Record<PreviewEntry['status'], ExtraPathsLocaleKey> = {
  ok: 'statusOk',
  missing: 'statusMissing',
  rejected: 'statusRejected',
  foreign: 'statusForeign',
}

const STATUS_STYLE: Record<PreviewEntry['status'], React.CSSProperties> = {
  ok: styles.statusOk,
  missing: styles.statusMissing,
  rejected: styles.statusRejected,
  foreign: styles.statusForeign,
}

const TEXT_ERROR_LABEL: Record<TextErrorCode, ExtraPathsLocaleKey> = {
  'empty-path': 'textErrorEmptyPath',
  'unknown-access': 'textErrorUnknownAccess',
  'unknown-surfaces': 'textErrorUnknownSurfaces',
  'too-many-fields': 'textErrorTooManyFields',
}

function itemsOf(value: unknown): readonly { path?: string }[] {
  const items = (value as { items?: unknown } | undefined)?.items
  return Array.isArray(items) ? (items as readonly { path?: string }[]) : []
}

/**
 * Localized one-line message for a rejected text-mode line.
 * @param tr - the host's translate seat (or the Chinese fallback).
 * @param error - one parser error with its 1-based line number.
 * @returns `第 n 行：…` / `Line n: …`.
 */
export function textErrorMessage(tr: Translate, error: TextError): string {
  const params = error.value === undefined ? undefined : { value: error.value }
  return `${tr('textErrorAtLine', { line: error.line })}${tr(TEXT_ERROR_LABEL[error.code], params)}`
}

/**
 * The tooltip of a NAME RULE row: what the spelling means, plus — once the
 * host's preview has walked the scope roots — how many paths currently match
 * (zero is a valid answer: the rule still applies to paths created later).
 * @param tr - the host's translate seat (or the Chinese fallback).
 * @param hostEntry - the host's preview entry for this row, when it has arrived.
 * @returns the localized one-line explanation.
 */
function nameRuleText(tr: Translate, hostEntry?: PreviewEntry): string {
  const hint = tr('nameRuleHint')
  const matches = hostEntry?.matches
  if (matches === undefined) return hint
  return `${hint} · ${matches > 0 ? tr('nameRuleMatches', { count: matches }) : tr('nameRuleNoMatches')}`
}

/**
 * Whether the shell surface cannot enforce a configured restriction on this host.
 * Before the host reports capabilities (undefined) nothing is claimed.
 * @param capabilities - the host's shell capability matrix.
 * @param rows - the current rules.
 * @returns true when a deny/read rule targets a shell that cannot honor it.
 */
export function needsShellLimitWarning(
  capabilities: PreviewCapabilities | undefined,
  rows: readonly Rule[],
): boolean {
  if (capabilities === undefined) return false
  const restricted = rows.some(row => (row.access === 'deny' || row.access === 'read') && row.surfaces.includes('shell'))
  if (!restricted) return false
  return !capabilities.shellReadDeny || !capabilities.shellWriteDeny
}

/**
 * The honesty banner: a deny/read rule that targets `shell` on a dialect that
 * cannot subtract permissions (landlock, Windows ACL) is still enforced for the
 * fs tools — but bash will not honor it. The page must say that out loud.
 * @param props - capability matrix, current rules and the translate seat.
 */
export function CapabilityBanner({ capabilities, rows, t }: {
  capabilities?: PreviewCapabilities
  rows: readonly Rule[]
  t?: Translate
}): React.ReactElement | null {
  const tr = t ?? fallbackTranslate
  if (!needsShellLimitWarning(capabilities, rows)) return null
  return (
    <div style={styles.capability} role="status">
      {tr('capabilityShellLimit', { dialect: capabilities?.shellDialect ?? 'unknown' })}
    </div>
  )
}

/**
 * The rule editor: the syntax hint, the live defaults line, the collapsible
 * examples, a monospace textarea and per-line errors. It owns NO action — Save
 * lives in the page toolbar and parses the whole draft (all-or-nothing), so the
 * editor can never disagree with the stored configuration.
 * @param props - editor content, parser errors, defaults copy and the change hook.
 */
export function TextModeEditor({ tr, value, errors, defaultsText, onChange }: {
  tr: Translate
  value: string
  errors?: readonly TextError[]
  /** The live "omitted fields use …" line, so custom defaults are not lied about. */
  defaultsText?: string
  onChange?: (value: string) => void
}): React.ReactElement {
  return (
    <div style={styles.textEditor}>
      <div style={styles.dim}>{tr('textModeHint')}</div>
      {defaultsText === undefined ? null : <div style={styles.dim}>{defaultsText}</div>}
      <details style={styles.examples}>
        <summary style={styles.examplesSummary}>{tr('examplesTitle')}</summary>
        <pre style={styles.examplesBody}>{tr('examplesBody')}</pre>
      </details>
      <textarea
        className="xp-textarea"
        style={styles.textarea}
        rows={12}
        spellCheck={false}
        value={value}
        aria-label={tr('textMode')}
        onChange={event => { onChange?.(event.target.value) }}
      />
      {errors !== undefined && errors.length > 0
        ? (
          <div style={styles.textErrors}>
            <div style={styles.warn}>{tr('textModeInvalid')}</div>
            {errors.map(error => (
              <div style={styles.warn} key={`${error.line}-${error.code}`}>{textErrorMessage(tr, error)}</div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}

/** Why the base field cannot be used yet, localized (undefined when it is fine). */
function baseProblemText(tr: Translate, base: BaseResult): string | undefined {
  if (base.ok) return undefined
  switch (base.problem) {
    case 'empty':
      return undefined
    case 'relative':
      return tr('resolveBaseInvalid')
    case 'waiting':
      return tr('baseWaiting')
    case 'foreign':
      return tr('baseForeign')
  }
}

/**
 * The host's resolution report, collapsed by default: the text editor is the
 * main view, and the preview is the authoritative detail when the user wants it.
 * @param props - expansion state, the base outcome, the preview payload and dirty flag.
 */
export function PreviewPanel({ tr, expanded, onToggle, typedBase, base, preview, dirty }: {
  tr: Translate
  expanded: boolean
  onToggle?: () => void
  typedBase: string
  base: BaseResult
  preview?: PreviewResult
  dirty: boolean
}): React.ReactElement {
  const writable = preview?.writable ?? preview?.effective ?? []
  const readOnly = preview?.readOnly ?? []
  const denied = preview?.denied ?? []
  let body: React.ReactNode
  if (typedBase === '') {
    body = <div style={styles.dim}>{tr('previewNoBase')}</div>
  } else if (!base.ok) {
    body = (
      <div style={styles.dim}>
        {base.problem === 'relative'
          ? tr('previewBadBase')
          : base.problem === 'waiting'
            ? tr('previewExpandingHome')
            : tr('baseForeign')}
      </div>
    )
  } else if (preview === undefined) {
    body = <div style={styles.dim}>{tr('previewUnavailable')}</div>
  } else if (preview.entries.length === 0 && readOnly.length === 0 && denied.length === 0) {
    body = <div style={styles.dim}>{tr('previewEmpty')}</div>
  } else {
    body = (
      <>
        {preview.entries.map((entry, index) => (
          <div className="xp-entry" key={`${index}-${entry.raw}`}>
            <span style={STATUS_STYLE[entry.status]}>[{tr(STATUS_LABEL[entry.status])}]</span>
            <span style={styles.dim}>{entry.access === undefined ? '' : tr(ACCESS_LABEL[entry.access])}</span>
            <span className="xp-entry-paths">
              <code style={styles.code}>{entry.raw}</code>
              <span style={styles.dim}>→</span>
              <code style={styles.code}>
                {entry.resolved !== ''
                  ? entry.resolved
                  : isNameRulePath(entry.raw) ? nameRuleText(tr, entry) : tr('unresolved')}
              </code>
            </span>
          </div>
        ))}
        {readOnly.length > 0
          ? (
            <div style={styles.entry}>
              <span style={styles.dim}>{tr('previewReadOnly', { count: readOnly.length })}</span>
              {readOnly.map(path => <code key={path} style={styles.code}>{path}</code>)}
            </div>
          )
          : null}
        {denied.length > 0
          ? (
            <div style={styles.entry}>
              <span style={styles.dim}>{tr('previewDenied', { count: denied.length })}</span>
              {denied.map(path => <code key={path} style={styles.code}>{path}</code>)}
            </div>
          )
          : null}
        {preview.warnings.map(warning => <div style={styles.warn} key={warning}>{warning}</div>)}
      </>
    )
  }
  return (
    <div style={styles.panel}>
      <div style={styles.panelHead}>
        <span>
          {tr('previewTitle')}
          {dirty ? tr('previewDirty') : ''}
        </span>
        <span style={styles.panelHeadRight}>
          {preview === undefined
            ? null
            : <span style={styles.dim}>{tr('previewEffective', { count: writable.length })}</span>}
          <button type="button" className="xp-link" onClick={onToggle}>
            {expanded ? tr('collapse') : tr('expand')}
          </button>
        </span>
      </div>
      {expanded ? body : null}
    </div>
  )
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

  const defaults = defaultsOf(snapshot.value)
  const [rows, setRows] = React.useState<Rule[]>(() => rowsOf(snapshot.value))
  const [text, setText] = React.useState<string>(() => serializeRules(rowsOf(snapshot.value)))
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [textErrors, setTextErrors] = React.useState<readonly TextError[] | undefined>(undefined)
  const [preview, setPreview] = React.useState<PreviewResult | undefined>(undefined)
  const [cwd, setCwd] = React.useState<string>(() => candidates[0] ?? '')
  const [cwdPinned, setCwdPinned] = React.useState(false)
  const [manualBase, setManualBase] = React.useState(false)
  const [introExpanded, setIntroExpanded] = React.useState(false)
  const [previewExpanded, setPreviewExpanded] = React.useState(false)

  // Adopt host changes only while the user has no unsaved edits. When the text
  // still describes exactly what is stored, keep it verbatim (hand-written
  // comments survive); otherwise re-render the canonical lines.
  React.useEffect(() => {
    if (dirty) return
    const nextRows = rowsOf(snapshot.value)
    const parsed = parseRules(text, defaultsOf(snapshot.value))
    const sameAsStored = parsed.ok
      && JSON.stringify(payloadOf(parsed.rules)) === JSON.stringify(payloadOf(nextRows))
    setRows(nextRows)
    if (!sameAsStored) {
      setText(serializeRules(nextRows))
      setTextErrors(undefined)
    }
  }, [snapshot, dirty, text])

  // The list can arrive AFTER the first render, so the base is adopted when it
  // shows up — unless the user already typed or picked one.
  const first = candidates[0]
  React.useEffect(() => {
    if (!cwdPinned && cwd === '' && first !== undefined) setCwd(first)
  }, [cwdPinned, cwd, first])

  // The host's platform facts arrive with the first preview; until then the
  // preview base cannot be resolved.
  const host = hostViewOf(preview)
  const base = resolveBase(cwd, host)
  // `~` may travel raw: the host expands it with the REAL home directory, which
  // is also how the page learns the platform facts from a `~` base.
  const previewBase = previewBaseOf(cwd, base)

  // The host preview answers for the DRAFT (debounced so typing stays cheap).
  // `rows` is the last text state that PARSED, so a half-typed line does not
  // turn the preview into an error flash.
  const request = JSON.stringify(payloadOf(rows))
  React.useEffect(() => {
    if (previewBase === '') {
      setPreview(undefined)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      const draft = JSON.parse(request) as unknown[]
      void fetchPreview(previewBase, draft).then(result => { if (live) setPreview(result) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [previewBase, request, snapshot])

  /**
   * Edit the one text form. A parse failure is reported per line and the last
   * VALID rows stay in place for the preview; Save refuses until it parses.
   */
  const change = (value: string): void => {
    setDirty(true)
    setText(value)
    setError(undefined)
    const parsed = parseRules(value, defaults)
    if (parsed.ok) {
      setRows(parsed.rules)
      setTextErrors(undefined)
    } else {
      setTextErrors(parsed.errors)
    }
  }

  /**
   * The page's only action: parse the whole text (all-or-nothing) and write the
   * structured `paths` array. A host refusal keeps the text intact.
   */
  const save = (): void => {
    const parsed = parseRules(text, defaults)
    if (!parsed.ok) {
      setTextErrors(parsed.errors)
      return
    }
    setBusy(true)
    setError(undefined)
    void scope.set('paths', payloadOf(parsed.rules))
      .then((accepted) => {
        // `false` is the host's refusal (a legacy 0.1.5 scope resolves void).
        if (accepted === false) setError(tr('saveRefused'))
        else {
          setRows(parsed.rules)
          setDirty(false)
          setTextErrors(undefined)
        }
      })
      .catch((cause: unknown) => {
        setError(isSaveRefused(cause) ? tr('saveRefused') : cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setBusy(false) })
  }

  const picker = !manualBase && candidates.length > 0
  const known = candidates.includes(cwd.trim())
  const baseNotice = baseProblemText(tr, base)

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <div style={styles.introLine}>
        <span style={styles.intro}>{tr('introCollapsed')}</span>
        <button type="button" className="xp-link" onClick={() => { setIntroExpanded(!introExpanded) }}>
          {introExpanded ? tr('collapse') : tr('expand')}
        </button>
      </div>
      {introExpanded
        ? (
          <div style={styles.intro}>
            {tr('introBefore')}<strong>{tr('introNoApproval')}</strong>{tr('introAfter')}
            {tr('introRuleBefore')}<strong>{tr('introRuleEmphasis')}</strong>{tr('introRuleAfter')}
          </div>
        )
        : null}

      <div style={styles.baseRow}>
        <span style={styles.label}>{tr('baseWorkspace')}</span>
        {picker
          ? (
            <select
              className="xp-select"
              style={styles.baseField}
              value={known ? cwd.trim() : ''}
              onChange={event => { setCwdPinned(true); setCwd(event.target.value) }}
            >
              {known ? null : <option value={cwd.trim()}>{cwd.trim() === '' ? tr('notSelected') : cwd.trim()}</option>}
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
            <button
              type="button"
              className="xp-link"
              onClick={() => { setCwdPinned(true); setManualBase(!manualBase) }}
            >
              {picker ? tr('manualBase') : tr('pickBase')}
            </button>
          )
          : null}
        <span style={styles.dim}>{tr('baseHint')}</span>
      </div>
      {baseNotice === undefined ? null : <div style={styles.dim}>{baseNotice}</div>}

      {/* ONE action: Save. The textarea below is the whole editor. */}
      <div className="xp-toolbar" style={styles.toolbar}>
        <button type="button" className="xp-button xp-button-on" disabled={busy || !dirty} onClick={save}>
          {busy ? tr('saving') : tr('save')}
        </button>
        <span style={styles.dim}>{dirty ? tr('dirty') : tr('synced')}</span>
      </div>

      <CapabilityBanner capabilities={preview?.capabilities} rows={rows} t={tr} />

      <TextModeEditor
        tr={tr}
        value={text}
        errors={textErrors}
        defaultsText={tr('editorDefaults', { access: defaults.access, surfaces: defaults.surfaces.join('+') })}
        onChange={change}
      />

      {error !== undefined ? <div style={styles.danger}>{error}</div> : null}

      <PreviewPanel
        tr={tr}
        expanded={previewExpanded}
        onToggle={() => { setPreviewExpanded(!previewExpanded) }}
        typedBase={cwd.trim()}
        base={base}
        preview={preview}
        dirty={dirty}
      />
    </div>
  )
}
