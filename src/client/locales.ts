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
 *
 * `tests/locales.test.ts` pins that both dictionaries carry the SAME key set and
 * the SAME `{placeholder}` set for every key: a translator dropping `{count}`
 * would otherwise render a sentence with a hole.
 * @module dsh-extra-paths/client/locales
 */

/** Every user-facing client string of the plugin. */
export type ExtraPathsLocaleKey =
  | 'navLabel'
  | 'summaryLoading'
  | 'summaryUnavailable'
  | 'summaryEmpty'
  | 'summaryCount'
  | 'introCollapsed'
  | 'expand'
  | 'collapse'
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
  | 'baseForeign'
  | 'baseWaiting'
  | 'save'
  | 'saving'
  | 'dirty'
  | 'synced'
  | 'textMode'
  | 'textModeHint'
  | 'examplesTitle'
  | 'examplesBody'
  | 'editorDefaults'
  | 'textModeInvalid'
  | 'textErrorAtLine'
  | 'textErrorEmptyPath'
  | 'textErrorUnknownAccess'
  | 'textErrorUnknownSurfaces'
  | 'textErrorTooManyFields'
  | 'accessDeny'
  | 'accessRead'
  | 'accessWrite'
  | 'accessAlways'
  | 'statusOk'
  | 'statusMissing'
  | 'statusRejected'
  | 'statusForeign'
  | 'resolveBaseInvalid'
  | 'nameRuleHint'
  | 'nameRuleMatches'
  | 'nameRuleNoMatches'
  | 'previewTitle'
  | 'previewDirty'
  | 'previewEffective'
  | 'previewReadOnly'
  | 'previewDenied'
  | 'previewNoBase'
  | 'previewBadBase'
  | 'previewExpandingHome'
  | 'previewUnavailable'
  | 'previewEmpty'
  | 'unresolved'
  | 'capabilityShellLimit'
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
  introCollapsed: 'Extra writable paths outside the workspace, writable without approval; edit them line by line.',
  expand: 'Show details',
  collapse: 'Hide details',
  introBefore: 'These paths stay writable outside the session workspace, ',
  introNoApproval: 'without approval',
  introAfter: '; each rule\'s access level and surfaces decide what the write tools and the terminal may do.',
  introRuleBefore: 'Relative spellings resolve against the base workspace; enforcement uses ',
  introRuleEmphasis: "each session's own workspace",
  introRuleAfter: ', so one configuration points at different directories in different sessions. deny/read rules win over writable ones.',
  baseWorkspace: 'Base workspace',
  notSelected: '(none selected)',
  basePlaceholder: 'Absolute path (drive letters / UNC included), or start with ~/',
  manualBase: 'Type a path',
  pickBase: 'Pick from list',
  baseHint: 'Preview and inline resolution only',
  baseForeign: 'This host cannot express that base path (platform mismatch); the same configuration still works on a matching host.',
  baseWaiting: 'Waiting for the host platform facts (first preview)…',
  save: 'Save',
  saving: 'Saving…',
  dirty: 'Unsaved changes',
  synced: 'In sync with the configuration',
  textMode: 'Text mode',
  textModeHint: 'One rule per line: path | access | surfaces. The last two may be omitted — they then inherit the defaults shown below. Expand "Examples and supported forms" for the common spellings.',
  editorDefaults: 'Omitted fields use: access = {access}, surfaces = {surfaces} (from the config document: defaultAccess / defaultSurfaces).',
  examplesTitle: 'Examples and supported forms',
  examplesBody: `# fs-tools protection only -> bare name (.git / .env)
# bash must be covered too -> a pattern (**/.git)
# 1-7 below are grouped by purpose; lines starting with # are comments

# 1) writable while the session is workspace-write (fs tools AND bash)
~/projects/notes/home
../../notes/shared | write | fs+shell

# 2) read-only: reads allowed, writes refused (also inside the workspace)
../shared/docs | read

# 3) deny: content reads, listings and writes are refused (fs tools)
~/.ssh | deny

# 4) always writable (even under read-only), fs tools only
<work root>/build | always-write | fs

# 5) bare name = name rule: that component at any depth under the
#    workspace and the configured writable roots (fs tools only)
.git | deny | fs
.env | read | fs

# 6) patterns: * = one level, ** = up to three; both surfaces can be covered
**/.git | read | fs+shell
**/.env | deny | fs+shell
<work root>/*/notes | write | fs

# 7) Windows / WSL spellings are recognised or translated per host
C:\work\shared | write
/mnt/c/work/shared | write

# access: deny | read | write | always-write   (omitted -> defaultAccess, default write)
# surfaces: fs | shell | fs+shell              (omitted -> defaultSurfaces, default fs+shell)
# relative paths resolve against the base workspace; ~ is your home directory;
# lines starting with # and blank lines are ignored`, 
  textModeInvalid: 'The text has errors and was not applied:',
  textErrorAtLine: 'Line {line}: ',
  textErrorEmptyPath: 'the path must not be empty',
  textErrorUnknownAccess: 'unknown access level "{value}" (use deny, read, write or always-write)',
  textErrorUnknownSurfaces: 'unknown surfaces "{value}" (use fs, shell or fs+shell)',
  textErrorTooManyFields: 'too many fields (at most path | access | surfaces)',
  accessDeny: 'Deny access',
  accessRead: 'Read-only',
  accessWrite: 'Writable (follows session)',
  accessAlways: 'Always writable',
  statusOk: 'active',
  statusMissing: 'missing',
  statusRejected: 'rejected',
  statusForeign: 'not applicable on this host',
  resolveBaseInvalid: 'The base workspace must be absolute (a drive or UNC path on Windows too) or start with ~/; a relative path cannot be the base',
  nameRuleHint: 'Name rule: matches this component at any depth under the workspace and all configured writable roots — fs tools only; bash is not restricted by it (use a **/<name> path pattern if bash must be covered)',
  nameRuleMatches: '{count} matches right now',
  nameRuleNoMatches: 'No matches right now (it still applies to paths created later)',
  previewTitle: 'Resolution preview',
  previewDirty: ' (including unsaved changes)',
  previewEffective: '{count} effective writable roots',
  previewReadOnly: '{count} read-only',
  previewDenied: '{count} denied',
  previewNoBase: 'Choose or type a base workspace above and the host\'s effective roots appear here.',
  previewBadBase: 'The base workspace must be absolute or start with ~/; a relative path cannot be the base.',
  previewExpandingHome: 'Expanding ~: the host home directory arrives with the first preview.',
  previewUnavailable: 'Preview unavailable (the host did not offer the route, the connection is not ready, or it rejected the base workspace).',
  previewEmpty: 'Nothing to resolve yet.',
  unresolved: '(unresolved)',
  capabilityShellLimit:
    'The shell sandbox on this host ({dialect}) cannot enforce deny/read rules: bash will not honor them, '
    + 'but the fs tools still enforce them.',
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
  introCollapsed: '工作区之外的额外可写路径，写入无需审批；支持按行批量编辑。',
  expand: '展开',
  collapse: '收起',
  introBefore: '这些路径在会话工作区之外也可以写，',
  introNoApproval: '不需要审批',
  introAfter: '；访问级别与「作用面」决定写工具和终端各自的行为。',
  introRuleBefore: '相对路径按「基准工作区」解析——执法时用的是',
  introRuleEmphasis: '各会话自己的工作区',
  introRuleAfter: '，所以同一份配置在不同会话会指向不同目录。deny/只读规则优先于可写规则。',
  baseWorkspace: '基准工作区',
  notSelected: '（未选择）',
  basePlaceholder: '绝对路径（含 Windows 盘符/UNC），或以 ~/ 开头',
  manualBase: '手填',
  pickBase: '从列表选',
  baseHint: '仅用于预览与行内解析',
  baseForeign: '当前宿主无法表达这个基准路径（平台不匹配）；同一份配置在匹配的宿主上仍然可用。',
  baseWaiting: '正在等待宿主返回平台信息（首次预览）…',
  save: '保存',
  saving: '保存中…',
  dirty: '有未保存的修改',
  synced: '已与配置同步',
  textMode: '文本模式',
  textModeHint: '每行一条规则：路径 | 访问级别 | 作用面。后两段可省略，省略时使用下方显示的默认值。展开「示例与支持的写法」查看常用形式。',
  editorDefaults: '省略字段时的默认值：访问级别 = {access}，作用面 = {surfaces}（来自配置文档的 defaultAccess / defaultSurfaces）。',
  examplesTitle: '示例与支持的写法',
  examplesBody: `# 仅保护 fs 工具 -> 裸名（.git / .env）
# 要让 bash 也受约束 -> 模式（**/.git）
# 下面 1-7 按用途分组；# 开头的行都是注释

# 1) 可写（随会话）：fs 工具与 bash 都放行
~/projects/notes/home
../../notes/shared | write | fs+shell

# 2) 只读：读允许、写拒绝（工作区内的目录也能这样降级）
../shared/docs | read

# 3) 禁止访问：内容读取、目录列举与写入都拒绝（fs 工具）
~/.ssh | deny

# 4) 始终可写（read-only 会话也放行），只作用于 fs 工具
<工作根>/build | always-write | fs

# 5) 裸名 = 名称规则：工作区与可写根内任意深度的同名路径（仅 fs 工具）
.git | deny | fs
.env | read | fs

# 6) 模式：* 一层 / ** 最多三层；可同时覆盖 fs 与 shell
**/.git | read | fs+shell
**/.env | deny | fs+shell
<工作根>/*/notes | write | fs

# 7) Windows / WSL 写法会按当前宿主识别或互译
C:\work\shared | write
/mnt/c/work/shared | write

# 级别：deny | read | write | always-write   （省略 -> defaultAccess，默认 write）
# 作用面：fs | shell | fs+shell              （省略 -> defaultSurfaces，默认 fs+shell）
# 相对路径按「基准工作区」解析；~ 是家目录；# 开头为注释、空行忽略`, 
  textModeInvalid: '文本有误，尚未应用：',
  textErrorAtLine: '第 {line} 行：',
  textErrorEmptyPath: '路径不能为空',
  textErrorUnknownAccess: '未知的访问级别「{value}」（可用 deny、read、write、always-write）',
  textErrorUnknownSurfaces: '未知的作用面「{value}」（可用 fs、shell、fs+shell）',
  textErrorTooManyFields: '字段过多（最多 path | access | surfaces 三段）',
  accessDeny: '禁止访问',
  accessRead: '只读',
  accessWrite: '可写（随会话）',
  accessAlways: '始终可写',
  statusOk: '生效',
  statusMissing: '缺失',
  statusRejected: '已拒绝',
  statusForeign: '当前平台不适用',
  resolveBaseInvalid: '基准工作区需要绝对路径（含 Windows 盘符/UNC），或以 ~/ 开头；相对路径不能当基准用',
  nameRuleHint: '名称规则：工作区与所有可写根内任意深度匹配（仅 fs 工具；bash 不受此规则约束；要让 bash 也生效请改用 **/<名字> 模式）',
  nameRuleMatches: '当前匹配 {count} 处',
  nameRuleNoMatches: '当前暂无匹配（对新建路径仍生效）',
  previewTitle: '解析预览',
  previewDirty: '（含未保存修改）',
  previewEffective: '生效根 {count} 条',
  previewReadOnly: '只读 {count} 条',
  previewDenied: '禁止 {count} 条',
  previewNoBase: '先在上面选择或填写「基准工作区」，这里就会显示宿主解析出的生效根。',
  previewBadBase: '基准工作区需要绝对路径，或以 ~/ 开头；相对路径不能当基准用。',
  previewExpandingHome: '正在展开 ~：宿主的家目录会在第一次预览返回后给出。',
  previewUnavailable: '预览不可用（宿主没提供该路由、连接还没就绪，或基准工作区被宿主拒绝）。',
  previewEmpty: '还没有可解析的路径。',
  unresolved: '（未解析）',
  capabilityShellLimit: '当前 shell 沙箱（{dialect}）无法执行「禁止访问/只读」规则：bash 不受该限制，但 fs 工具仍按规则拦截。',
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
