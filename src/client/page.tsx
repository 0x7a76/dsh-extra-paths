/**
 * The Extra paths settings page: one card per configured path, Chinese labels,
 * a LIVE lexical resolution per row against a base workspace, quick add
 * buttons, and the host's authoritative preview of the DRAFT (unsaved rows).
 *
 * The base workspace comes from the shell's standard `useWorkspaces` hook when
 * the slot supplies it — a snapshot read once during activation would be
 * `undefined` whenever the registry had not loaded yet, which is exactly how the
 * picker ended up empty. `getWorkspaces` stays as a lazy fallback for
 * compositions that pass no standard props.
 * @module dsh-extra-paths/client/page
 */

import * as React from 'react'
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
  set(field: string, value: unknown): Promise<void>
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

const STATUS_LABEL: Record<Status, string> = { ok: '生效', missing: '目录不存在', rejected: '已拒绝' }
const STATUS_STYLE: Record<Status, React.CSSProperties> = {
  ok: styles.statusOk,
  missing: styles.statusMissing,
  rejected: styles.statusRejected,
}

const SCOPE_LABEL: Record<Scope, string> = {
  write: '随会话模式（read-only 下拒绝）',
  'always-write': '始终可写（read-only 下也允许）',
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
 * Render the page.
 * @param props - the bound settings scope, the standard workspace hook, and the
 * lazy fallback used when the composition supplies no standard props.
 */
export function ExtraPathsPage({ scope, getWorkspaces, useWorkspaces }: {
  scope: PageScope
  getWorkspaces?: () => WorkspaceListSurface | undefined
  useWorkspaces?: WorkspacesHook
}): React.ReactElement {
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
      .then(() => { setDirty(false) })
      .catch((cause: unknown) => { setError(String(cause)) })
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
        这些路径在会话工作区之外也可以写，<strong>不需要审批</strong>；写工具与终端都按下面的「作用面」生效。
        相对路径按「基准工作区」解析——执法时用的是<strong>各会话自己的工作区</strong>，所以同一份配置在不同会话会指向不同目录。
      </div>

      <div style={styles.baseRow}>
        <span style={styles.cardTitle}>基准工作区</span>
        {picker
          ? (
            <select
              className="xp-select"
              style={styles.baseField}
              value={known ? typedBase : ''}
              onChange={event => { setCwdPinned(true); setCwd(event.target.value) }}
            >
              {known ? null : <option value={typedBase}>{typedBase === '' ? '（未选择）' : typedBase}</option>}
              {candidates.map(path => <option key={path} value={path}>{path}</option>)}
            </select>
          )
          : (
            <input
              className="xp-input"
              style={styles.baseField}
              value={cwd}
              placeholder="绝对路径，或以 ~/ 开头（例如 ~/projects）"
              onChange={event => { setCwdPinned(true); setCwd(event.target.value) }}
            />
          )}
        {candidates.length > 0
          ? (
            <button type="button" className="xp-link" onClick={() => { setManualBase(!manualBase) }}>
              {picker ? '手填' : '从列表选'}
            </button>
          )
          : null}
        <span style={styles.dim}>仅用于预览与行内解析</span>
      </div>

      <div style={styles.toolbar}>
        <button type="button" className="xp-button xp-button-on" disabled={busy || !dirty} onClick={save}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button type="button" className="xp-button" onClick={() => { append('') }}>添加路径</button>
        <button type="button" className="xp-button" onClick={() => { append('..') }}>添加工作区上一层（..）</button>
        <button type="button" className="xp-button" disabled={!dirty} onClick={reset}>放弃修改</button>
        <span style={styles.dim}>{dirty ? '有未保存的修改' : '已与配置同步'}</span>
      </div>

      {rows.length === 0
        ? <div style={styles.dim}>还没有配置路径：用上面的「添加路径」或「添加工作区上一层（..）」开始。</div>
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
              <span style={styles.cardTitle}>路径 {index + 1}</span>
              <span style={styles.cardHeadRight}>
                {hostEntry !== undefined
                  ? (
                    <span style={STATUS_STYLE[hostEntry.status]}>
                      [{STATUS_LABEL[hostEntry.status]}{hostMatches.length > 1 ? ` ×${hostMatches.length}` : ''}]
                    </span>
                  )
                  : null}
                <button
                  type="button"
                  className="xp-link"
                  onClick={() => { setDirty(true); setRows(current => current.filter((_, i) => i !== index)) }}
                >
                  删除
                </button>
              </span>
            </div>
            <input
              className="xp-input"
              style={styles.pathInput}
              value={row.path}
              placeholder="~/projects/notes/home、../某仓库、..（上一层）、~/projects/**/.worktrees/..（模式）"
              onChange={event => { update(index, { path: event.target.value }) }}
            />
            <div style={styles.resolvedRow}>
              {patternRow
                ? (
                  <span style={styles.dim}>
                    模式：由宿主按目录结构展开
                    {' '}
                    {hostMatches.length > 0
                      ? `当前命中 ${hostMatches.length} 个目录（见下方预览）`
                      : '（暂无命中，或被展开上限拦截）'}
                  </span>
                )
                : resolved === undefined
                ? <span style={styles.dim}>
                  {row.path.trim() === ''
                    ? '填入路径后这里会显示解析结果'
                    : typedBase === ''
                      ? '相对路径需要基准工作区：请在上面选择或填写'
                      : !usableBase
                        ? '基准工作区需要绝对路径，或以 ~/ 开头（例如 ~/projects）'
                        : '~ 需要宿主的家目录（第一次预览返回后即可解析）'}
                </span>
                : (
                  <>
                    <span style={styles.dim}>解析为</span>
                    <code style={styles.code}>{resolved}</code>
                    {hostEntry !== undefined && hostEntry.resolved !== resolved
                      ? <span style={styles.dim}>（宿主解析：{hostEntry.resolved}）</span>
                      : null}
                  </>
                )}
            </div>
            <div style={styles.controlsRow}>
              <label style={styles.field}>
                生效模式
                <select
                  className="xp-select"
                  value={row.scope}
                  onChange={event => { update(index, { scope: event.target.value as Scope }) }}
                >
                  <option value="write">{SCOPE_LABEL.write}</option>
                  <option value="always-write">{SCOPE_LABEL['always-write']}</option>
                </select>
              </label>
              <div style={styles.pills}>
                <span style={styles.dim}>作用面</span>
                <button
                  type="button"
                  className={row.surfaces.includes('fs') ? 'xp-button xp-button-on' : 'xp-button xp-button-off'}
                  onClick={() => { toggleSurface(index, 'fs') }}
                >
                  写工具
                </button>
                <button
                  type="button"
                  className={row.surfaces.includes('shell') ? 'xp-button xp-button-on' : 'xp-button xp-button-off'}
                  onClick={() => { toggleSurface(index, 'shell') }}
                >
                  终端
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {error !== undefined && <div style={styles.warn}>{error}</div>}

      <div style={styles.panel}>
        <div style={styles.panelHead}>
          解析预览{dirty ? '（含未保存修改）' : ''}
          {preview !== undefined ? <span style={styles.dim}>生效根 {preview.effective.length} 条</span> : null}
        </div>
        {typedBase === ''
          ? <div style={styles.dim}>先在上面选择或填写「基准工作区」，这里就会显示宿主解析出的生效根。</div>
          : !usableBase
            ? <div style={styles.dim}>基准工作区需要绝对路径，或以 ~/ 开头（例如 ~/projects）；相对路径不能当基准用。</div>
            : base === ''
              ? <div style={styles.dim}>正在展开 ~：宿主的家目录会在第一次预览返回后给出。</div>
              : preview === undefined
                ? <div style={styles.dim}>预览不可用（宿主没提供该路由、连接还没就绪，或基准工作区被宿主拒绝）。</div>
                : (
                  <>
                    {preview.entries.length === 0
                      ? <div style={styles.dim}>还没有可解析的路径。</div>
                      : preview.entries.map((entry, index) => (
                        <div style={styles.entry} key={`${index}-${entry.raw}`}>
                          <span style={STATUS_STYLE[entry.status]}>[{STATUS_LABEL[entry.status]}]</span>
                          <code style={styles.code}>{entry.raw}</code>
                          <span style={styles.dim}>→</span>
                          <code style={styles.code}>{entry.resolved === '' ? '（未解析）' : entry.resolved}</code>
                        </div>
                      ))}
                    {preview.warnings.map(warning => <div style={styles.warn} key={warning}>{warning}</div>)}
                  </>
                )}
      </div>
    </div>
  )
}
