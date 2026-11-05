/**
 * The page's copy, in both baseline locales. DSH's own locale selection picks
 * the active language: the client half registers these dictionaries under the
 * plugin's namespace, and the framework-injected `t` seat re-renders slot
 * entries when the selection changes.
 *
 * `en` is the host's documented fallback for every shipped language other than
 * Chinese, so a Japanese/French/German UI shows the English copy rather than
 * raw keys. The Chinese dictionary stays the built-in fallback for a host that
 * gives the page no `t` seat at all (0.1.5 slots, unit tests).
 * @module dsh-extra-paths/client/locales
 */

/** Every user-facing client string of the plugin. */
export type ExtraPathsLocaleKey =
  | 'navLabel'
  | 'summaryLoading'
  | 'summaryUnavailable'
  | 'summaryEmpty'
  | 'summaryCount'
  | 'introBefore'
  | 'introNoApproval'
  | 'introAfter'
  | 'introRuleBefore'
  | 'introRuleEmphasis'
  | 'introRuleAfter'
  | 'baseWorkspace'
  | 'notSelected'
  | 'basePlaceholder'
  | 'manualBase'
  | 'pickBase'
  | 'baseHint'
  | 'save'
  | 'saving'
  | 'addPath'
  | 'addParent'
  | 'discard'
  | 'dirty'
  | 'synced'
  | 'emptyPaths'
  | 'rowTitle'
  | 'delete'
  | 'pathPlaceholder'
  | 'patternResolved'
  | 'patternMatches'
  | 'patternNoMatches'
  | 'resolvePendingEmpty'
  | 'resolveNeedsBase'
  | 'resolveBaseInvalid'
  | 'resolveNeedsHome'
  | 'resolvedAs'
  | 'hostResolved'
  | 'mode'
  | 'surfaces'
  | 'surfaceFs'
  | 'surfaceShell'
  | 'scopeWrite'
  | 'scopeAlways'
  | 'statusOk'
  | 'statusMissing'
  | 'statusRejected'
  | 'previewTitle'
  | 'previewDirty'
  | 'previewEffective'
  | 'previewNoBase'
  | 'previewBadBase'
  | 'previewExpandingHome'
  | 'previewUnavailable'
  | 'previewEmpty'
  | 'unresolved'
  | 'saveRefused'

/** A translate function with the host's `{name}` placeholder syntax. */
export type Translate = (key: ExtraPathsLocaleKey, params?: Record<string, unknown>) => string

/** English copy — the fallback locale for every non-Chinese UI language. */
export const en: Record<ExtraPathsLocaleKey, string> = {
  navLabel: 'Extra writable paths',
  summaryLoading: 'Extra writable paths: loading…',
  summaryUnavailable: 'Extra writable paths: not offered by this host',
  summaryEmpty: 'Extra writable paths: not configured yet',
  summaryCount: 'Extra writable paths: {count} saved · writing needs no approval',
  introBefore: 'These paths stay writable outside the session workspace, ',
  introNoApproval: 'without approval',
  introAfter: '; both the write tools and the terminal honor the surfaces below.',
  introRuleBefore: 'Relative spellings resolve against the base workspace; enforcement uses ',
  introRuleEmphasis: "each session's own workspace",
  introRuleAfter: ', so one configuration points at different directories in different sessions.',
  baseWorkspace: 'Base workspace',
  notSelected: '(none selected)',
  basePlaceholder: 'Absolute path, or start with ~/ (for example ~/projects)',
  manualBase: 'Type a path',
  pickBase: 'Pick from list',
  baseHint: 'Preview and inline resolution only',
  save: 'Save',
  saving: 'Saving…',
  addPath: 'Add path',
  addParent: 'Add the workspace parent (..)',
  discard: 'Discard changes',
  dirty: 'Unsaved changes',
  synced: 'In sync with the configuration',
  emptyPaths: 'No paths configured yet: start with "Add path" or "Add the workspace parent (..)" above.',
  rowTitle: 'Path {index}',
  delete: 'Remove',
  pathPlaceholder: '~/projects/notes/home, ../some-repo, .. (parent), ~/projects/**/.worktrees/.. (pattern)',
  patternResolved: 'Pattern: the host expands it along the directory structure',
  patternMatches: '{count} directories match (see the preview below)',
  patternNoMatches: '(no matches yet, or capped by the expansion limit)',
  resolvePendingEmpty: 'The resolved path appears here once you type a path',
  resolveNeedsBase: 'A relative path needs a base workspace: choose or type one above',
  resolveBaseInvalid: 'The base workspace must be an absolute path or start with ~/ (for example ~/projects)',
  resolveNeedsHome: '~ needs the host home directory (available after the first preview)',
  resolvedAs: 'Resolves to',
  hostResolved: '(host resolves: {path})',
  mode: 'Applies under',
  surfaces: 'Surfaces',
  surfaceFs: 'Write tools',
  surfaceShell: 'Terminal',
  scopeWrite: 'Follows the session mode (denied under read-only)',
  scopeAlways: 'Always writable (allowed under read-only too)',
  statusOk: 'active',
  statusMissing: 'missing',
  statusRejected: 'rejected',
  previewTitle: 'Resolution preview',
  previewDirty: ' (including unsaved changes)',
  previewEffective: '{count} effective roots',
  previewNoBase: 'Choose or type a base workspace above and the host\'s effective roots appear here.',
  previewBadBase: 'The base workspace must be absolute or start with ~/ (for example ~/projects); a relative path cannot be the base.',
  previewExpandingHome: 'Expanding ~: the host home directory arrives with the first preview.',
  previewUnavailable: 'Preview unavailable (the host did not offer the route, the connection is not ready, or it rejected the base workspace).',
  previewEmpty: 'Nothing to resolve yet.',
  unresolved: '(unresolved)',
  saveRefused:
    'The host refused the save: this configuration may be overridden by a home patch or a command-line overlay '
    + '(the settings page only writes the profile cordis.patch.yml). Remove the same-id override from '
    + '~/.dsh/cordis.patch.yml, or edit the profile patch and restart.',
}

/** Simplified Chinese copy. */
export const zh: Record<ExtraPathsLocaleKey, string> = {
  navLabel: '额外可写路径',
  summaryLoading: '额外可写路径：读取中…',
  summaryUnavailable: '额外可写路径：宿主未提供该设置',
  summaryEmpty: '额外可写路径：尚未配置',
  summaryCount: '额外可写路径：{count} 条 · 保存即生效，写入无需审批',
  introBefore: '这些路径在会话工作区之外也可以写，',
  introNoApproval: '不需要审批',
  introAfter: '；写工具与终端都按下面的「作用面」生效。',
  introRuleBefore: '相对路径按「基准工作区」解析——执法时用的是',
  introRuleEmphasis: '各会话自己的工作区',
  introRuleAfter: '，所以同一份配置在不同会话会指向不同目录。',
  baseWorkspace: '基准工作区',
  notSelected: '（未选择）',
  basePlaceholder: '绝对路径，或以 ~/ 开头（例如 ~/projects）',
  manualBase: '手填',
  pickBase: '从列表选',
  baseHint: '仅用于预览与行内解析',
  save: '保存',
  saving: '保存中…',
  addPath: '添加路径',
  addParent: '添加工作区上一层（..）',
  discard: '放弃修改',
  dirty: '有未保存的修改',
  synced: '已与配置同步',
  emptyPaths: '还没有配置路径：用上面的「添加路径」或「添加工作区上一层（..）」开始。',
  rowTitle: '路径 {index}',
  delete: '删除',
  pathPlaceholder: '~/projects/notes/home、../某仓库、..（上一层）、~/projects/**/.worktrees/..（模式）',
  patternResolved: '模式：由宿主按目录结构展开',
  patternMatches: '当前命中 {count} 个目录（见下方预览）',
  patternNoMatches: '（暂无命中，或被展开上限拦截）',
  resolvePendingEmpty: '填入路径后这里会显示解析结果',
  resolveNeedsBase: '相对路径需要基准工作区：请在上面选择或填写',
  resolveBaseInvalid: '基准工作区需要绝对路径，或以 ~/ 开头（例如 ~/projects）',
  resolveNeedsHome: '~ 需要宿主的家目录（第一次预览返回后即可解析）',
  resolvedAs: '解析为',
  hostResolved: '（宿主解析：{path}）',
  mode: '生效模式',
  surfaces: '作用面',
  surfaceFs: '写工具',
  surfaceShell: '终端',
  scopeWrite: '随会话模式（read-only 下拒绝）',
  scopeAlways: '始终可写（read-only 下也允许）',
  statusOk: '生效',
  statusMissing: '目录不存在',
  statusRejected: '已拒绝',
  previewTitle: '解析预览',
  previewDirty: '（含未保存修改）',
  previewEffective: '生效根 {count} 条',
  previewNoBase: '先在上面选择或填写「基准工作区」，这里就会显示宿主解析出的生效根。',
  previewBadBase: '基准工作区需要绝对路径，或以 ~/ 开头（例如 ~/projects）；相对路径不能当基准用。',
  previewExpandingHome: '正在展开 ~：宿主的家目录会在第一次预览返回后给出。',
  previewUnavailable: '预览不可用（宿主没提供该路由、连接还没就绪，或基准工作区被宿主拒绝）。',
  previewEmpty: '还没有可解析的路径。',
  unresolved: '（未解析）',
  saveRefused:
    '保存被宿主拒绝：该配置可能被 home patch 或命令行覆盖（设置页只写 profile 的 cordis.patch.yml）。'
    + '请删掉 ~/.dsh/cordis.patch.yml 里同 id 的覆盖，或直接改 profile patch 后重启。',
}

/** Fill `{name}` placeholders; unknown names stay verbatim, like the host seat. */
export function format(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/**
 * The built-in translate function: Chinese copy, `{name}` placeholders.
 * Used when the host supplies no locale seat (0.1.5 slots, unit tests).
 */
export const fallbackTranslate: Translate = (key, params) => format(zh[key], params)
