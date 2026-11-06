# 访问级别（deny/read/write/always-write）与跨平台路径（Unix/Windows/WSL）设计

> 路径占位符：`$REPO` = 本仓库检出目录，`<工作根>` = 使用者放项目的上层目录，`~` = 宿主家目录。
> 本文档是 0.3.0 的实现契约：类型、语义、平台能力矩阵、预览载荷、UI 规格与验收标准。
> 实现记录/踩坑回填到本文档末尾，不往 README 堆机制细节。

## 1. 目标（三个需求）

1. **紧凑配置页**：路径多时不再一张卡一行；列表改为单行紧凑规则行，并新增「文本模式」：
   一个 textarea 直接编辑全部规则（每行一条），与列表双向同步。
2. **访问级别**：每条路径一个 `access`：`deny`（禁止访问）/ `read`（只读）/ `write`（随会话可写）/
   `always-write`（始终可写）。取代原来的 `scope`，旧配置自动兼容。
3. **跨平台路径**：识别 Windows 盘符 / UNC / 两种分隔符；在 WSL 与 Windows 之间自动互译
   （`C:\x` ↔ `/mnt/c/x`）；当前平台无法表达的条目变为 inactive + 明确警告，而不是保存失败。

## 2. 访问级别语义

| `access` | fs 工具 读 | fs 工具 写 | shell 读 | shell 写 |
|---|---|---|---|---|
| `deny` | **拒绝**（read/read_image/present/API 等 `ctx.fs` 读方法抛错） | **拒绝** | 平台支持时拒绝（见 §5） | 平台支持时拒绝 |
| `read` | 允许 | **拒绝**（即使在工作区内也降级为只读） | 允许 | 平台支持时拒绝（只读降级） |
| `write` | 允许 | 允许（仅 `workspace-write` 会话） | 允许 | 允许（仅 `workspace-write`） |
| `always-write` | 允许 | 允许（`read-only` 会话也放行） | 允许 | 允许（`read-only` 也放行） |

- `read` 的用途：把工作区内本来可写的目录降级为只读（例如 `.git`、`node_modules`、生成物）。
- `deny` 的用途：禁止 fs 工具读取/列出/写入该路径（密钥、凭据目录等）。
- **优先级：deny > read > write/always-write**（对同一目标，最严规则胜出，不做"更具体路径覆盖"；
  这样既有授权不会被一条更窄的规则意外放大）。`write` 与 `always-write` 合并时取更宽的 `always-write`。
- 表面（`surfaces`）继续存在：`fs` = `ctx.fs` 工具族；`shell` = `ctx.sandbox` 限制的子进程。
  一条规则只在列出的表面上生效；`fs` 的 deny 不会阻止 shell 读（反之亦然）。默认 `["fs","shell"]`。
- `deny` / `read` 规则即使会话处于 `danger-full-access` 也生效（用户显式写的硬规则）；
  但 shell 在 `danger-full-access` 下没有沙箱层可注入，只能由 fs 半保证（见 §5）。
- 读的元数据边界：`resolve` / `stat` / `lstat` / `contains` 等**不读内容**的方法不拦截（保留宿主内部
  路径探测能力），因此被禁路径的"存在性/大小"这类元数据仍可能被观察到；内容读取、目录列举、
  字节读取、`watch` 被拦截。文档必须如实写这条边界。

## 3. 配置词汇与迁移

```yaml
extra-paths:
  defaultAccess: write          # 新字段，默认 write；旧 defaultScope 仍被接受
  defaultSurfaces: [fs, shell]
  paths:
    - <工作根>/notes/home                     # 字符串 = defaultAccess
    - path: ~/.ssh
      access: deny
      surfaces: [fs, shell]
    - path: ../shared/docs
      access: read
    - path: <工作根>/some-repo
      access: always-write
      surfaces: [fs]
```

- `PathEntry`：`{ path, access, surfaces }`；`access` 在规范化后必有值。
- 兼容：条目可继续写 `scope: write|always-write`（映射到同名 access）；同时写 `access` 与 `scope`
  且不一致 → 抛错（避免歧义）。`defaultScope` 作为 `defaultAccess` 的旧别名继续接受。
- 校验（`validateConfig`，保存时）在原有规则上增加：
  - 盘符相对路径（`C:foo`）明确拒绝（Windows 上歧义；两个平台都不可靠）。
  - 卷根：`/`、`C:`、`C:\`、UNC 共享根 `\\server\share`、WSL 盘根 `/mnt/c`（按宿主平台判断）→ 拒绝。
  - 重复路径（规范化后）维持拒绝，不看 access 是否相同（同路径两种访问级别是配置错误）。
- 配置页写结构化数组（`paths`），不写文本 blob；文本模式只是编辑同一数组的另一种视图。

## 4. 路径方言（Windows / Unix / WSL）

新模块 `src/platform.ts`：**纯函数**（不碰 fs），宿主事实通过 `PlatformFacts` 注入，便于单测。

```ts
export interface PlatformFacts {
  platform: string          // process.platform：'darwin' | 'linux' | 'win32' | ...
  wsl: boolean              // 宿主是否跑在 WSL 里
  wslMountRoot: string      // Windows 盘在 WSL 的挂载根，默认 '/mnt'（可用 /proc/mounts 探测）
  home: string              // 宿主原生家目录绝对路径
}
export type PathDialect = 'posix' | 'windows'
export type Spelling =
  | { kind: 'posix-absolute' } | { kind: 'windows-absolute' } | { kind: 'home' }
  | { kind: 'relative' } | { kind: 'drive-relative' }
| { kind: 'foreign'; reason: string }
```

### 4.1 分类（与平台无关的拼写识别）

- Windows 绝对：`^[A-Za-z]:[\\/]`、UNC `^\\\\`、扩展前缀 `\\?\` / `\\?\UNC\`（剥前缀后按同规则）。
- 盘符相对：`^[A-Za-z]:(?![\\/])` → 非法（保存时拒绝）。
- 家目录：`~`、`~/`、`~\`（后两者在两种方言都接受）。
- POSIX 绝对：以 `/` 开头（`//` 亦按 POSIX 处理，交给卷根校验）。
- Windows 单反斜杠/单斜杠开头（`\foo`、win32 上的 `/foo`）是"当前盘"形式：win32 宿主上判为
  无法表达 → inactive；POSIX 宿主上 `\foo` 是合法文件名字符，保持 relative 字面量。

### 4.2 互译（"同一份配置跨平台"）

翻译只在 **host half** 做（浏览器拿不到平台事实；WSL 下浏览器是 Windows Chrome，客户端推断必错）。
`src/preview.ts` 把平台事实与每条目的解析结果一起送给页面；页面只显示宿主答案。

| 拼写 \ 宿主 | POSIX (macOS/Linux) | WSL (Linux + WSL 标记) | Windows |
|---|---|---|---|
| `~/x`、`/abs/x` | 原生 | 原生 | `~` 原生；`/mnt/<l>/…`→`<L>:\…`；`/<l>/…`→`<L>:\…`；其它 POSIX 绝对 → foreign |
| `C:\x`、`C:/x` | foreign（告警，条目 inactive） | `wslMountRoot/c/x` | 原生（两种分隔符都接受） |
| `\\server\share\x` | foreign | foreign | 原生 UNC |
| `C:foo` | 拒绝 | 拒绝 | 拒绝 |
| 相对拼写 | 原生（`/` 分隔） | 原生 | 原生（`\` 或 `/` 都接受） |

- **翻译后交给真实解析（realpath/存在性）验证**，不信任词法翻译：翻译结果不存在 → `missing`；
  纯 POSIX 宿主遇到 Windows 拼写、或 Windows 宿主遇到无法映射的 POSIX 拼写 → 新状态 `foreign`，
  带一条警告（不阻断保存，同一份配置仍可保存/同步）。
- WSL 挂载根探测：读 `/proc/mounts`，从 `C:`/`drvfs` 类挂载点（如 `/mnt/c`）反推根；失败回落 `/mnt`。
- 卷根判定在翻译后做：WSL 上 `C:\` → `/mnt/c` 必须按"盘根"拒绝；Windows 上 `/mnt/c` → `C:\` 同理。
- Windows 宿主把 `/mnt/<l>/…` 视作 WSL 路径翻译；`/<l>/…` 视作 MSYS/git-bash 形式翻译，仅当该盘根
  存在（由解析期存在性检查兜底）时才生效，否则 missing/foreign。

### 4.3 路径运算

`src/paths.ts` 的所有算术按方言选 `node:path` 的 `posix` / `win32` 实现（用注入的 `PlatformFacts`，
使 win32 逻辑可在 macOS 单测）：

- `expandPath(raw, workspaceRoot, facts)`：分类 → 互译 → `~` 展开 → 绝对/相对解析。
  返回 `{ path } | { foreign: reason }`。
- `canonicalizeRoot(path, facts)`：沿用"最深存在祖先 realpath + 未存在后缀"；win32 用 `win32` 算术。
- `isUnder(targetKey, root, facts)`：win32 大小写不敏感（用 `win32.relative` 的语义）；POSIX 保持
  大小写敏感。**新增身份兜底**（镜像宿主 `fs-sandbox/containment.ts`）：词法不中时，stat 根与目标
  现有祖先，`dev+ino` 相同即算包含（解决 WSL/drvfs 大小写别名与 Windows 8.3 别名）。兜底只读、
  只在词法失败时执行。
- 模式（`pattern.ts`）：先按方言把 Windows 分隔符归一成 `/` 再解析；锚点仍要求"绝对 + 至少两层
  字面量 + 不是卷根 + 不包含家目录"；`**`/`*`/结尾 `..` 语法不变。模式只匹配**目录**（文件用字面路径）。

## 5. 执法矩阵（fs / shell × 平台）

| 能力 | fs 工具（`ctx.fs` 代理） | shell：macOS seatbelt | shell：Linux bwrap | shell：Linux landlock | shell：Windows ACL |
|---|---|---|---|---|---|
| deny 读 | ✅ 代理读方法抛错 | ✅ 追加 `(deny file-read* (subpath …))` | ✅ 追加 `--mask` | ❌ 只读允许表无法扣减 | ❌ |
| deny 写 | ✅ | ✅ 追加 `(deny file-write* (subpath …))` | ✅ 追加 `--ro-bind`（或 `--mask`） | ❌（工作区内减不掉） | ❌ |
| read 降级（只读） | ✅ | ✅ 追加 `(deny file-write* (subpath …))` | ✅ 追加 `--ro-bind path path` | ❌ | ❌ |
| write/always-write 授权 | ✅ 现行逻辑 | ✅ 追加 allow | ✅ 追加 `--bind` | ✅ 追加 `--rw` | ❌（宿主 0.2.2 架构不允许，现状已 fail-closed） |

- seatbelt 规则顺序：SBPL **后匹配的规则胜出**（宿主自己的 `(allow default)` + `(deny file-write*)` +
  逐根 `(allow …)` 就依赖这一语义，其 e2e 测试钉住了行为）。因此我们的 deny 规则必须追加在
  宿主 allow 与我们自己的 allow 之后。
- bwrap：mount 操作**后者覆盖前者**，`--mask`/`--ro-bind` 追加在授权 bind 之后。`--mask` 需要路径
  存在且非符号链接目标（先 canonicalize；不存在/无法 mask 时跳过并告警——此时该规则在 shell 侧
  无法保证，必须在日志与页面能力提示里体现）。
- landlock / Windows ACL：**不能**表达 deny（allow-list / write-restricted token，追加 flag 会被
  runner 拒绝）。插件在检测到这些方言且配置了 deny/read 规则时：
  - 不阻断命令（否则这些平台的 bash 直接不可用），但**每个方言只告警一次**，并记录到能力状态；
  - 设置页按宿主平台显示"shell 侧不可拦截"的能力徽标（`capabilities`，见 §7）；
  - README/已知边界如实写明。
- 无法覆盖的读通道（v1 文档化，不做假承诺）：`grep`/`glob`（宿主用打包的 ripgrep 子进程直读，
  不经 `ctx.fs`）、bash（平台不支持时）、LSP/MCP 子进程、`ctx.get('fs')` 旁路消费者、
  宿主在加载期缓存 `ctx.fs` 的服务（如 lsp-stdio）。补充一道工具层守卫：
  `ctx.tools.guard(...)` 对参数里出现 `path`/`file_path`/`target`/… 的工具调用做 deny 判定；
  对 `grep`/`glob` 的显式 `path` 参数可靠拦截（默认搜索工作区时的泄漏在文档中列为边界）。

## 6. 解析报告（`resolveRoots` 的新形状）

```ts
export interface ResolvedRoot { raw: string; root: string; scope: Scope; surfaces: Surface[] }  // 可写授权（现行结构不变）
export interface ResolvedRule { raw: string; root: string; access: 'read' | 'deny'; surfaces: Surface[] }
export interface EntryResolution {
  raw: string; resolved: string; access: Access; surfaces: Surface[]
  status: 'ok' | 'missing' | 'rejected' | 'foreign'
}
export interface ResolveReport {
  roots: ResolvedRoot[]        // write/always-write：grantFor / context / preview 沿用
  readOnly: ResolvedRule[]     // read：写降级
  denied: ResolvedRule[]       // deny：读写都拦
  entries: EntryResolution[]
  warnings: string[]
}
```

- 同一根（canonical）多条规则合并：deny > read；无 deny/read 时 write+always-write 取 always-write。
  按 surface 分别聚合（一个根可以 fs 可写、shell 只读）。
- 模式展开、缺失、根/卷根拒绝、home/workspace 包含告警等既有逻辑保持不变；新增 foreign 状态与警告。

## 7. 预览载荷（host ⇄ 页面契约）

`GET /extra-paths/resolved?cwd=…&paths=<JSON>`（草稿替换存储）返回：

```ts
interface PreviewResponse {
  workspaceCwd: string
  home: string
  platform: { platform: string; wsl: boolean; dialect: 'posix' | 'windows' }
  capabilities: { shellReadDeny: boolean; shellWriteDeny: boolean; shellReadOnly: boolean; shellDialect: string }
  entries: EntryResolution[]
  writable: string[]      // 原 effective；保留 effective 兼容字段也行
  readOnly: string[]
  denied: string[]
  warnings: string[]
}
```

- `capabilities` 由 `process.platform` + WSL 标记 + 实际观察到的 shell 方言（wrap-sandbox 在每次
  confine 时记录 `confined.argv[0]` 归类 seatbelt/bwrap/landlock/windows-acl）推导；未观察到时按平台
  默认值 + `unknown`。
- 页面渲染：宿主解析结果为准；行内词法解析只用于"还没保存/还没预览回来"时给 POSIX/原生拼写做即时
  提示（用 `platform.dialect`），foreign 条目显示"当前平台不适用"。

## 8. 设置页规格（紧凑 + 文本模式）

- 页面自上而下：简介（默认折叠成一行，可展开）→ 基准工作区行 → 工具栏 → 规则列表 → 预览（默认折叠）。
- **规则列表**：一行一条规则（约 32px），列：`访问级别下拉 | 路径输入(自适应宽度) | fs/shell 双切换 |
  状态徽标 | 删除`。列表容器 `max-height: 46vh; overflow:auto`，50 条也不撑爆页面。
- **文本模式**：工具栏「文本模式」切换；textarea（等宽字体、`rows≈12`）每行一条规则：
  ```
  # 注释行与空行忽略
  ~/projects/notes/home
  ../shared/docs | read
  ~/.ssh | deny | fs+shell
  <工作根>/some-repo | always-write | fs
  ```
  语法：`path` 后可选 `| access` 与 `| surfaces`（`fs`、`shell`、`fs+shell`）；缺省沿用插件默认。
  解析错误带行号显示，不覆盖列表；最终版把「应用/取消」统一成编辑器内的「保存 / 返回列表」：文本模式打开时隐藏
  列表工具栏，「保存」一步解析整段文本并写入配置（被拒则留在编辑器、文本不丢），「返回列表」丢弃草稿。
  （实现记录：早期版本先「应用」成规则行再点工具栏「保存」，与「放弃修改」语义重叠，已按用户反馈合并。）
  打开文本模式时用当前列表渲染文本，保证双向一致。
- 访问级别下拉文案：禁止访问 / 只读 / 可写（随会话）/ 始终可写。
- 状态徽标沿用 `[生效]/[缺失]/[已拒绝]`，新增 `[当前平台不适用]`；deny/read 行用危险/警告色点。
- 保存仍只写 `paths` 结构化数组；页面在保存前对完全无效的文本编辑拒绝应用。
- 保持既有：`settings.section` + `plugins.row.config`（0.2.x）+ `settings.plugin.item`（0.1.5）三入口、
  summary 一行、保存被拒（`false`）显示 `saveRefused`、文案跟随宿主语言（zh/en 字典键集一致）。

## 9. 文件归属（写作用域，供并行实现）

| 任务 | 文件 | 依赖 |
|---|---|---|
| 契约/基础（Lead） | `docs/…/2026-11-06-access-and-platform.md`、`src/platform.ts`、`src/config.ts` | — |
| host-core | `src/schema.ts`、`src/paths.ts`、`src/pattern.ts`、`src/resolve.ts`、`src/grant.ts`、`src/context.ts`、`src/preview.ts`、`src/index.ts` + 对应 tests | 契约 |
| enforce | `src/wrap-fs.ts`、`src/argv.ts`、`src/wrap-sandbox.ts`、新 `src/denial.ts`、新 `src/shell-dialect.ts`、新 `src/tool-guard.ts` + 对应 tests | host-core 的 `resolveRoots` 形状（契约固定） |
| client-ui | `src/client/page.tsx`、`src/client/paths.ts`、`src/client/preview.ts`、`src/client/locales.ts`、`src/client/styles.ts`、`src/client/index.tsx` + 对应 tests | 契约 §7 §8 |
| docs | `README.md`、`README.zh.md`、`AGENTS.md` 版本表、`package.json` 版本（0.3.0） | 行为定稿后 |

## 10. 验收标准

1. `typecheck`（`tsc -p tsconfig.json --noEmit` + `tsc -p tsconfig.client.json --noEmit`）全绿。
2. `vitest run` 全绿；新增覆盖至少：
   - config：access 规范化/兼容 scope/冲突报错/盘符相对与卷根校验；
   - platform：分类、Windows↔WSL 互译、foreign、UNC、两分隔符、模式分段；
   - paths：win32 大小写不敏感包含、身份兜底（POSIX 上用真实临时目录模拟 dev/ino 别名）、foreign；
   - resolve：readOnly/denied 聚合与 per-surface、deny>read>write 优先级、foreign 状态、模式展开；
   - wrap-fs：读方法 deny 抛错、写方法 deny/read 降级先于 base、grant 不受影响、move 两端；
   - argv：seatbelt deny/read-only 规则顺序、bwrap `--mask`/`--ro-bind` 顺序、landlock/windows 返回
     未增强并告警（fail-closed 语义不变）；
   - tool-guard：grep/glob 显式 path 在 deny 下被拒、允许路径不受影响；
   - preview：新载荷字段（platform/capabilities/readOnly/denied/writable）；
   - client：文本模式解析/渲染、紧凑行、access 下拉、i18n 键集一致、slot 键不变。
3. `build`（tsc + tsdown）通过，`lib/` 与 `src/` 同步（CI 会核对）。
4. `check:sanitized` 通过（文档不得含本机路径/用户名/主机名）。
5. 旧配置（只有 `scope`、字符串路径）行为不变；只读/禁用路径的语义与 §2、§5 一致。

## 11. 已知边界（写进 README）

- shell 侧 deny/只读仅在 macOS seatbelt 与 Linux bwrap 可保证；Linux landlock（含未装 bwrap 的 WSL）
  与 Windows ACL 无法扣减读权限：fs 工具仍可靠，shell 不保证（页面能力徽标与本条如实展示）。
- `grep`/`glob` 用宿主打包的 ripgrep 子进程直读：显式 `path` 被工具层守卫拦截，默认搜索整个工作区时
  工作区内的被禁子目录仍可能出现在结果里；敏感数据请放在工作区之外并 deny（bash 在支持平台上会拦）。
- 元数据（`stat`/`lstat`/`resolve`）不拦截（见 §2）。
- `ctx.get('fs')` 旁路消费者、LSP/MCP 子进程、加载期缓存了 `ctx.fs` 的宿主服务不受代理约束。
- Windows 的 shell 侧授权本来就不支持（宿主 0.2.2 架构），0.3.0 不改变这一点。

## 12. 执法实现注记（enforce 任务契约，供实现者）

已取证（DSH 0.2.2-rc.1 源码）：

- `ctx.fs` 读方法：`readText` / `streamText` / `readBytes` / `readByteRange` / `listDir` / `watch`
  是读内容/列举的入口；`stat` / `lstat` / `resolve` / `contains` / `processPath` / `fileUrl` 只给元数据，
  按 §2 不拦。工具错误面：工具体抛出的普通 `Error` 会在结果里显示 `Error: <message>`；宿主没有读方法的
  remediation 层，所以消息要自解释（`cannot read "<path>": denied by the extra-paths rule "<raw>"`）。
- `grep`/`glob` 不经过 `ctx.fs`（`tool-fs-search` 用打包好的 ripgrep `ctx.subprocess.spawn`），
  bash/LSP/MCP 也是旁路；`ctx.get('fs')` 不触发 `internal/get`；lsp-stdio 在加载期缓存 `ctx.fs`。
  这些是 §11 的边界，不做假承诺。`ctx.tools.guard(guard)`（`core/tools`）是工具层的补充缝隙：
  对参数中出现路径的工具调用（如 `grep`/`glob` 的显式 `path`）可以可靠拒绝。
- `src/argv.ts` 新 API：`widenArgv(confined, wrappedLength, {grants, readOnly, denied})` →
  `{argv, unsupported?: ShellDialect} | undefined`（`undefined` = 方言无法识别，调用方必须按"不授权"处理）。
  seatbelt 追加顺序：grants(`allow file-write*`) → readOnly(`deny file-write*`) → denied(`deny file-read*` +
  `deny file-write*`)；bwrap：grants(`--bind`) → readOnly(`--ro-bind x x`) → denied(`--mask x`)；
  landlock：只追加 `--rw`，有 readOnly/denied 时 `unsupported:'landlock'`；windows-acl：原样返回并
  `unsupported:'windows-acl'`；其余返回 `undefined`。宿主 SBPL 规则序是"后匹配者胜"，bwrap 是
  "后挂载者覆盖"，deny 必须排在最后。
- `src/wrap-sandbox.ts`：每次 confine 用 `recordShellDialect(confined.argv)` 记录方言；`danger-full-access`
  直接原样返回（没有 runner 可注入）；warn 用 "方言 + 规则签名" 去重，避免每条命令刷日志。
- `src/wrap-fs.ts`：读方法只在 `typeof inner.<method> === 'function'` 时才覆盖（stub/旧宿主保持透明）；
  命中 `denied`（fs surface）即抛 `AccessDeniedError`。写方法顺序：deny → readOnly →（danger 直接 delegate）
  → 现有授权翻译；`moveFile` 两端都要查 deny/readOnly。读方法的相对规则基准：`fallbackPolicy()?.workspaceRoot
  ?? process.cwd()`（读调用本身不带 policy；相对 deny 规则对纯 API 消费者是 best effort，工具层由
  tool-guard 用会话 cwd 精确判）。
- `src/tool-guard.ts`：纯函数 `guardReason(execution, deps)` + 注册器；从 `execution.arguments` 提取
  `path/file_path/filePath/target/targets/paths/directory/dir/cwd/workdir/files` 里的字符串，用
  `expandConfiguredPath` + `canonicalizeRoot` 归一后比对 denied(fs)；`cwd` 取
  `execution.agent?.session?.header?.cwd`。注册在 `ctx.inject(['tools'])` 里并 feature-detect
  `typeof ctx.tools.guard === 'function'`（0.1.5 可能没有）。
- `src/denial.ts`：`AccessDeniedError`（普通 `Error` + `code = 'EXTRA_PATHS_ACCESS_DENIED'`，插件不得
  运行时 import `@deepseek-ai/*` 的 FsError）、`matchDenied` / `matchReadOnly`（按 surface 过滤 +
  `isUnder`）与消息构造。
- 工具守卫与 `index.ts` 的装配由 Lead 在集成阶段完成（enforce 只导出 `installToolGuard`，不改 index.ts）。

## 13. 验收补充（enforce）

- seatbelt：deny 规则字符串出现在 profile 末尾、且排在 allow 之后；bwrap：`--mask` / `--ro-bind` 出现在
  grants 之后、`--` 之前；landlock/windows-acl：不产生无法识别的 flag，返回 unsupported 并告警一次。
- 读 deny：`readText`/`streamText`/`readBytes`/`readByteRange`/`listDir`/`watch` 全部抛
  `EXTRA_PATHS_ACCESS_DENIED`；`stat`/`resolve` 不受影响。
- 写 deny/只读：先于 base 拒绝（inner 未被调用）；`danger-full-access` 下 deny/只读仍拒绝；既有授权翻译
  的测试全部保持绿色（含 move 两端、symlink 逃逸、revocation）。
- `resolveRoots` 的 readOnly/denied 列表按 surface 过滤；同一目标 deny > read > write。
- 全量 `node_modules/.bin/vitest run` 与 `node_modules/.bin/tsc -p tsconfig.json --noEmit` 绿。

## 14. 实现记录（0.3.0 交付回填）

**交付内容**（20 个测试文件 / 465 条，宿主 + 客户端两侧 typecheck 绿，lib 可复现）：

- 访问级别：`src/config.ts`（`Access` 词表、`access`/`scope` 兼容与冲突拒绝、`defaultAccess`/`defaultScope`）、
  `src/resolve.ts`（`roots` / `readOnly` / `denied`，按 canonical root + surface 聚合，deny > read > write，
  read/deny 不会被更宽授权放大）、`src/schema.ts`（两代 schema 都接受新旧拼写，access 别名不带 schema 默认值——
  0.2.x 框架会**物化** schema 默认值，带默认值会让"base 的 defaultAccess + 用户旧 defaultScope"在
  normalizeConfig 里被判定为冲突而整份配置失效；`write` 默认由 normalizer 提供）。
- fs 执法：`src/wrap-fs.ts` + 新 `src/denial.ts`——六个读方法（readText/streamText/readBytes/readByteRange/
  listDir/watch）在 deny 下抛 `EXTRA_PATHS_ACCESS_DENIED`；写方法顺序 deny → read →（`danger-full-access` 直接
  delegate）→ 既有授权翻译；硬规则在 `danger-full-access` 下仍生效；`moveFile` 两端都查；`stat`/`lstat`/`resolve`
  等元数据方法刻意不拦（README 已写）。读方法没有 per-call policy，相对规则的基准取
  `fallbackPolicy()?.workspaceRoot ?? process.cwd()`，工具层的 guard 用会话 cwd 精确判。
- shell 执法：`src/argv.ts` + `src/wrap-sandbox.ts` + `src/shell-dialect.ts`——seatbelt 追加
  `allow → deny file-write* → deny file-read*+file-write*`（SBPL 后匹配者胜）；bwrap 追加
  `--bind → --ro-bind x x → --mask x`（后挂载者覆盖）；landlock 只能加 `--rw`、windows-acl 不能加任何 flag，
  两者都只告警一次（`unsupported`），命令继续执行；`danger-full-access` 原样返回；每次 confine 记录实际方言
  供设置页能力徽标。**已如实写进 README 已知边界**：WSL 未装 bwrap（landlock）与 Windows ACL 上 bash 不保证。
- 工具层补充：`src/tool-guard.ts`——`ctx.tools.guard`（feature-detect；0.1.5 无此 API 时静默跳过）对
  `grep`/`glob` 的显式 `path` 参数可靠拒绝；默认工作区搜索仍是文档化边界。
- 跨平台路径：`src/platform.ts`（纯函数：分类、分隔符、盘符/UNC、WSL mount root 探测、`C:\x ↔ /mnt/c/x` 互译）、
  `src/paths.ts`（facts 注入的 expand/canonicalize/isUnder；win32 大小写不敏感 + dev/ino 身份兜底，镜像宿主
  `fs-sandbox/containment.ts`）、`src/pattern.ts`（Windows 分隔符归一后解析、foreign 锚点与宿主方言一致）。
  foreign 条目/模式 = `[not applicable on this host]` + 一条警告，**不阻断保存**（同一份配置跨机器共用）。
- 设置页：紧凑单行规则列表（访问级别下拉、路径、fs/shell、状态徽标、删除；46vh 滚动）、文本模式
  （`path | access | surfaces`，`#` 注释，按行报错、全有或全无）、能力告警横幅、折叠的简介/预览；
  文案 zh/en 键集与占位符一致；三个 slot 入口与 summary 一行不变。
- `src/index.ts` 集成：tool guard 装配；0.1.5 `base` 不再携带 access 别名（避免 base+旧 `defaultScope` 冲突），
  设置值读取失败降级为"保留上一份配置"而不是从注入回调里抛出。

**验证（本机，直接跑二进制；`pnpm run` 因 pnpm 依赖状态检查在本机不可用，CI 会跑标准三件套）**：

- `node_modules/.bin/tsc -p tsconfig.json --noEmit` → 0；`tsc -p tsconfig.client.json --noEmit` → 0。
- `node_modules/.bin/vitest run` → 20 files / 465 tests passed。
- `node_modules/.bin/tsc -p tsconfig.json && node_modules/.bin/tsdown` → 成功；连续两次构建后 `lib/` 逐文件
  shasum 相同（可复现，CI 的 lib 漂移检查通过的前提）。
- `node scripts/check-sanitized.mjs` → 106 tracked files clean。
- 真实宿主冒烟（scratch，不碰用户 `~/.dsh`）：`DSH_HOME=/tmp/dsh-smoke-xp`、`--from-default-profile headless` 建
  profile、`dsh plugin add <repo>` 链接本仓库 → `--dump-config` 组合树含 `extra-paths` 行、`--dump-config-schema`
  含 `deny/read/access/defaultAccess` 字段、headless 应用 `--help` 正常启动退出（插件加载无报错）。
  ⚠️ 按仓库约定，本会话里无法对 bash 侧做真实 `sandbox-exec` e2e（嵌套沙箱被拒）；argv 行为由真实 provider
  形状的夹具测试钉住。

**已知取舍 / 后续可做**：

1. `ResolvedRoot.scope` 是"该根所有可写 surface 中最宽的 level"（旧字段形状兼容）：同一 canonical root 在
   fs 配 `write`、shell 配 `always-write` 时，fs 会被一起提升为 always-write。旧版本合并多条同路径条目时已有同样
   的"取最宽"行为，0.3.0 未回归；若将来需要严格按 surface 区分 scope，可把 roots 按 (root, scope) 拆成多条。
2. 模式展开缓存 key 已加上 workspaceRoot（防御性；当前语法下相对锚点的模式本来就会被拒绝）。
3. 工具层守卫只认参数里显式的路径；默认工作区搜索、LSP/MCP 子进程与 `ctx.get('fs')` 旁路是文档化边界。
4. shell 限制在 landlock/windows-acl 不可表达：选择"命令继续 + 告警一次 + 页面横幅"，而不是让这些平台的 bash
   完全不可用；fs 侧始终可靠。

## 15. 名称规则（裸名）契约（0.3.0 追加特性）

需求：配置里只写 `.git` / `.env` / `node_modules`（单段、无 `/`、无 `*`、不是 `.`/`..`、不以 `~` 开头）
时视为**名称规则**：匹配「会话工作区 + 所有配置的可写根」内**任意深度**的同名组件（文件或目录），
含其整棵子树。`./notes` 是"工作区内字面相对路径"的写法（含分隔符，语义不变）。

已实现的基础（Lead，已冻结）：`src/platform.ts#isBareNameSpelling`、新 `src/name-rule.ts`
（`NAME_RULE_LIMITS`、`scopeRootsOf`、`findNameComponent` 纯词法匹配、`expandNameMatches` 有界遍历 +
`complete` 判定）、`src/config.ts#validateConfig`（裸名只做重复校验，四种 access 都合法；文档推荐 deny/read）。

### 15.1 `resolve.ts` 追加（host-core 任务）

```ts
export interface ResolvedNameRule { raw: string; name: string; access: Access; surfaces: readonly Surface[] }
export interface NameMatch { rule: ResolvedNameRule; root: string }
export interface ResolveReport {
  /* …既有字段… */
  nameRules: readonly ResolvedNameRule[]      // 恒有：所有裸名条目（按配置顺序、去重后）
  nameMatches: readonly NameMatch[]           // 仅 expandNameRules 时填充
}
export function resolveRoots(config, workspaceRoot, facts?, options?: { expandNameRules?: boolean }): ResolveReport
export function nameScopeRoots(report: ResolveReport, workspaceRoot: string, facts: PlatformFacts): readonly string[]
```

- `expandNameRules` 默认 false（fs 热路径零额外开销）。为 true 时：scope roots =
  `scopeRootsOf(workspaceRoot, report.roots.map(r => r.root), facts)`；对每条裸名规则调用
  `expandNameMatches`；结果缓存 30s（key = scopeRoots+name+facts，`clearNameRuleCache()` 供测试）。
- **部分覆盖策略（真机反馈后修订）**：枚举不完整时，**已找到的匹配仍然进入 `nameMatches` 并生效**
  （多拒绝具体路径总是安全的），同时在 `warnings` 里写一条含 rule raw、原因（cap/深度截断/跳过符号链接）与
  **未走完的 scope roots** 的警告。原因：第一版"整条不生效"在真机上被 `~/.dsh` 里 >12 层的运行时目录
  触发，导致工作区里的 `.git` 规则只保护了 fs 工具、shell 完全失效——单一深层可写根不能连坐其它根。
  `NameExpansion.incompleteRoots` 记录未完成的根，`complete` 仅在全部根都走完时为 true。
- 裸名条目的 `EntryResolution`：单条 `{raw, resolved:'', access, surfaces, status:'ok'}`；
  展开时附 `matches: number`（`EntryResolution.matches?: number`）。匹配 0 处仍为 ok（fs 侧实时生效）。
- `preview.ts#buildPreview` 用 `expandNameRules: true`：`denied` / `readOnly` / `writable(effective)`
  数组按 access 并入匹配路径；`capabilities` 等其余字段不变。

### 15.2 执法（enforce 任务）

- `wrap-fs.ts`：读写方法在现有字面规则检查之外，用 `findNameComponent(String(targetKey), name,
  nameScopeRoots(...), facts)` 做**逐段实时匹配**（读调用基准仍是 `fallbackPolicy()?.workspaceRoot ?? process.cwd()`，
  写调用用 policy.workspaceRoot）：
  - deny 命中 → readDenied/writeDenied（构造 `ResolvedRule`-like 传消息；`root` 用命中的组件路径）；
  - read 命中 → writeReadOnly；
  - 授权：deny/read 检查之后、字面 grant 匹配失败时，命中 write/always-write 名称规则 →
    `syntheticPolicy(effective, 命中组件路径)`（write 只在 workspace-write 下生效，always-write 任何模式；
    `danger-full-access` 照旧 delegate）；`moveFile` 两端都查。
- `wrap-sandbox.ts`：`resolveRoots(..., {expandNameRules: true})`；把 `nameMatches` 并入 widen 规则：
  deny→denied、read→readOnly、write/always-write→grants（write 仅 workspace-write，always-write 任何模式）；
  路径去重；report.warnings 中名称规则不完整的警告用现有 warnOnce 机制按签名只告警一次。
- `tool-guard.ts`：除字面 denied 外，对参数里显式路径做 `findNameComponent` 检查（deny、fs surface），
  命中即拒绝（`grep/glob/read` 的显式 path 因此也受名称规则约束）。

### 15.3 客户端 + 文档

- `client/paths.ts`：`isNameRulePath`（复用 `platform.isBareNameSpelling`）；`RuleResolution` 增加
  `'name-rule'` 分支（无需词法解析）。
- `client/preview.ts`：`PreviewEntry.matches?: number`。
- `page.tsx` `RuleRow`：名称规则行显示「名称规则 · 匹配 N 处 / 暂无匹配（对新建目录仍生效）」，
  状态徽标沿用；`locales.ts` 新增键（zh/en 键集与占位符一致）。
- README（en/zh 等价）：新增「名称规则（裸名）」小节：语义、作用范围、`.git`/`.env` 示例、
  `./notes` 逃生写法、四种 access 都合法但推荐 deny/read、shell 侧枚举 + 上限/30s 缓存 + 不完整时
  fs 仍精确而 shell 降级告警。AGENTS 0.3.0 版本行补一句「裸名规则」。

### 15.4 验收

- `tsc`（host+client）绿；全量 vitest 绿；新增覆盖：`isBareNameSpelling`/`findNameComponent`/
  `expandNameMatches`（含 cap、深度截断、符号链接跳过、scope 去重）、config 裸名校验、resolve 的
  nameRules/nameMatches/不完整告警、preview 并入数组、wrap-fs 读写 deny/read/grant、wrap-sandbox
  合并后 argv、tool-guard 命中、client 行渲染与文本模式序列化（`.git | deny | fs+shell`）。
- `lib/` 重建、`check:sanitized` 干净；真机：配置 `.git | deny` 后 read/写 `.git` 被拒、bash 访问被拒
  （macOS seatbelt），删除规则后恢复。

## 16. 名称规则实现记录（回填）

**交付**：`src/platform.ts#isBareNameSpelling`（浏览器安全的分类器）；`src/name-rule.ts`（scope 去重、
`findNameComponent` 纯词法匹配、`expandNameMatches` 有界遍历 + `complete` 判定 + 可注入 limits）；
`config.ts` 裸名只做重复校验（四种 access 都合法；重复按名字拒绝）；
`resolve.ts` 报告新增 `nameRules`（恒有）/ `nameMatches`（`{ expandNameRules: true }` 时，30s 缓存、
不完整则整条不产生匹配并警告一次）、`EntryResolution.matches`、`nameScopeRoots`；
`preview.ts` 合并 deny/read/write 匹配并回传 matches；`wrap-fs.ts` 每次调用做词法检测（读/写 deny、
read 降级、名称授权落在命中组件路径、move 两端），不产生目录遍历；`wrap-sandbox.ts` 把展开的匹配并入
seatbelt/bwrap/landlock 的规则（不完整时 shell 侧跳过并只告警一次）；`tool-guard.ts` 对显式参数路径做同样
检测（含 grep/glob）；`context.ts` 系统提示新增「Denied names / Read-only names」段；客户端识别名称规则行并
显示匹配计数；README/AGENTS 增补名称规则章节与迁移说明。

**用户拍板的语义**：作用范围 = 会话工作区 + 所有配置的可写根；shell 侧枚举匹配后注入；四种 access 都允许，
文档推荐 deny/read。单段相对路径（`notes`）因此改为名称规则，`./notes` 是字面相对路径的逃生写法（README
迁移小节已写明）。

**验证**：host/client typecheck 绿；vitest 21 文件 / 547 条全绿；`check:sanitized` 干净；
名称规则新增用例覆盖：分类器、lexical 匹配（含 Windows 大小写）、有界遍历（cap/深度截断/符号链接跳过/
node_modules 剪枝）、resolve nameRules/nameMatches/缓存/不完整告警、preview 合并、fs 读写 deny/read/授权、
shell 合并与不完整告警、tool-guard、context 提示、客户端行渲染与文本模式 round-trip。

### 16.1 真机反馈后的修正：per-root 完整性（2026-11-06）

首版按"整条规则不完整即不生效"实现后，真机验收发现：桌面机的可写根含 `~/.dsh`，其中有超过 12 层的运行时
目录，导致 `.git` 名称规则的枚举被判为 incomplete，于是**整个 shell 侧被跳过**——工作区里 `read .git/config`
被拒，但 `bash cat .git/HEAD` 照常成功。

修正：`NameExpansion` 增加 `incompleteRoots`，遍历按 scope root 分别记完整性；**已找到的匹配仍然进入
`nameMatches` 并生效**（多拒绝具体路径总是安全的），只有未走完的根才通过一条警告点名（原因 + 根 + 已生效计数）。
`complete` 仅在全部根走完时为 true。实测修正后同一配置得到
`nameMatches = [<workspace>/.git, <obsidian>/.git]` 与一条点名 `~/.dsh` 未完成的警告。
教训：以"安全"为名的全有全无策略在真实目录结构下会把保护降为零；**部分覆盖 + 明确告警**才是可用的折中。

### 16.2 最终决定：名称规则只做 fs，shell 不做枚举（2026-11-06）

真机复盘与用户讨论后确定：**去掉裸名规则的 shell 侧枚举，只保留 fs 拦截**。

理由：fs 侧匹配是**纯词法**的（只沿目标路径的路径段与 scope roots 比较，`O(path depth)`，零 `readdir/stat`），
不存在"大量枚举扫描"的问题；所有扫描/缓存/上限/部分覆盖的复杂度都只来自 shell——因为 sandbox profile 只能写
具体路径，必须把名称展开成"当前匹配到的路径列表"。该展开被真实目录结构证明代价高、滞后、且只能部分覆盖。

最终行为：
- 名称规则**只作用于 fs 工具**（`read`/`write`/`edit`/apply_patch/delete/move + `grep`/`glob` 显式参数守卫），
  逐次实时、精确、零遍历；
- `surfaces` 里即使写了 `shell`，shell 也不会枚举或约束它：宿主**每个规则集只告警一次**，
  页面行提示「仅 fs 工具；bash 不受此规则约束」，README 明确写清；要让 shell 受约束请用具体路径或 `*` 模式
  （字面/模式规则在 shell 侧仍是精确的）；
- `resolve` 的 `nameMatches` 只服务于**设置页展示**（"当前匹配 N 处"，每规则一次有界遍历、30s 缓存、
  不完整时只影响这个计数并告警），**执法路径不再遍历**；`preview` 不再把名称匹配并入 effective/denied 数组；
- 已删除 wrap-sandbox 中所有名称枚举/合并/partial-warning 代码与对应测试，改为 fs-only 的 argv 不变 +
  一次性提示测试。

## 17. 模式能力补强（相对锚点 + 文件末段）与文档引导（2026-11-06）

用户拍板"1、2、3 一步到位"后落地：

1. **文档/页面引导**：名称规则行 tooltip 与 README（en/zh）明确「仅 fs 工具；要让 bash 也生效请改用
   `**/<名字>` 模式」；README 给出 `.git`/`.env` 的等价模式写法。宿主侧：名称规则若声明了 `shell` 作用面，
   仍只告警一次（fs 工具照常保护，bash 不受约束）。
2. **工作区相对模式**：`parsePatternOutcome` / `validateConfig` 现在接受相对锚点——以通配符开头（`**/.git`）
   或带字面量前缀（`services/**/notes`、`../**/.git`）的模式锚定在**会话工作区**；绝对/`~` 锚点保持原有
   "至少两层字面量 + 非卷根"规则；纯 `**` / `**/*` 这类"扫全工作区"的纯通配在保存期拒绝。绝对性判定改为看
   `*` 之前的**原始**前缀（`/**` 会被 strip 成空锚点，必须仍按绝对根拒绝——这是实现中差点漏掉的一个回归）。
3. **文件末段匹配**：模式的最后一段是**字面量**时现在也匹配文件（`**/.env`）；`*` 末段保持"只匹配目录"的历史
   语义。为此重构 pattern 遍历：`listChildren` 返回目录+文件且**包含**被剪枝的名字（`node_modules`/`.git`），
   剪枝只作用于"下降"，不再妨碍把 `.git` 本身匹配为末段；`**` 分支继续跳过隐藏目录和剪枝名。
   fs/shell 两侧无需特殊处理：命中文件路径与命中目录同样进入 `ResolvedRoot`/denied 集合（seatbelt 的
   `subpath`、bwrap 的 `--mask`/`--ro-bind` 都能作用于文件路径；真机验证见下）。

验证：host/client typecheck 绿；vitest **21 文件 / 552 条全绿**（新增：相对模式解析/展开、父级相对锚点、
纯通配拒绝、`.git` 末段可匹配但不下降、文件末段匹配、resolve 的相对模式与文件模式、config 保存期校验）；
`lib/` 重建可复现，sanitized 干净。真机验收待重启后进行：`**/.git` + `**/.env` 两条临时规则，验证
shell 侧（macOS seatbelt）同样生效。

### 17.1 真机验收结果（相对模式 + 文件末段，macOS seatbelt）

重启后（临时规则：profile 追加 `**/.git | deny | fs+shell` 与 `**/.env | deny | fs+shell`；仓库根临时放一个
`.env` 文件），6 项全部通过：

| # | 测试 | 结果 |
|---|---|---|
| 1 | fs `read .git/config` | ✅ 拒绝：`denied by the extra-paths rule "**/.git"` |
| 2 | `bash cat .git/HEAD` | ✅ `Operation not permitted`（相对模式展开后注入 seatbelt） |
| 3 | fs `read .env`（文件模式） | ✅ 拒绝：`denied by the extra-paths rule "**/.env"` |
| 4 | `bash cat .env` | ✅ `Operation not permitted`（seatbelt `subpath` 对文件路径生效） |
| 5 | fs `write .env` | ✅ 拒绝（工具层守卫 + fs 代理） |
| 6 | `bash` 写 `.git/.env` | ✅ 均 `Operation not permitted`（写路径同样被注入规则覆盖） |

恢复：配置文件按备份**逐字节还原**（`cmp` 通过），等待热重载后 `cat .git/HEAD`、`read .env`、`git status`
全部恢复正常；临时 `.env` 与测试备份已删除。运行时上下文中的 `Denied paths` 段落随规则移除而消失，证明配置
热重载双向生效。

### 17.2 设置页交互收口（用户反馈后，2026-11-06）

反馈：文本模式与列表模式的按钮不一致（文本模式里有「应用/取消」，列表模式有「保存/添加路径/添加工作区上一层/
放弃修改/文本模式」），两套动作语义重叠。最终 UI：

- **两种模式共用同一条工具栏、按钮位置不变**：`文本模式 ⇄ 返回列表` → `保存` → 同步状态。没有「应用/取消」，
  也没有「添加路径/添加工作区上一层/放弃修改」。
- **列表模式**：规则列表底部一条虚线 `+` 行用于新增规则（自动聚焦路径输入框）；删除仍用行尾 `×`。
- **文本模式**：编辑器只有 textarea + 语法提示 + 按行错误；「保存」直接解析整段文本并写入配置（错误时不保存、
  留在编辑器），切回列表丢弃文本草稿。
- 代码：`TextModeEditor` 不再自带动作行；`RuleRow` 增加 `autoFocus`；工具栏统一渲染；`+` 行样式
  （`.xp-add`）加入 stylesheet。测试同步更新（工具栏文案、编辑器无按钮、`+` 行 aria-label）。

### 17.3 模式切换改为始终可见的页签（2026-11-06）

用户反馈：「不用写返回列表，默认列表模式，点击进入文本模式即可（要有可点击的提示/文案，不然别人不知道可以点）」。
最终实现：工具栏最前面是一组**始终可见、都可点击的页签** `[列表模式] [文本模式]`（同款按钮、等宽文案；`aria-pressed` 标记当前模式）——
默认列表模式；点「文本模式」进入批量编辑，点「列表模式」回到列表（丢弃未保存的文本草稿）。不再出现「返回列表」字样，
也不需要用户猜测哪里能点。文案键 `listMode` 改为「列表模式 / List mode」、新增 `modeSwitch`（页签组的 aria-label）。

### 17.4 去掉冗余的「列表模式」页签（2026-11-06）

用户反馈：「不需要列表模式，有点多余了，去掉吧」。最终：栏里只有一个模式按钮——列表模式下显示「文本模式」（点击进入
批量编辑），文本模式下同一位置显示「退出文本模式」（tooltip 说明会丢弃未保存草稿；保存成功后也会自动回到列表）。
不再有「列表模式」页签/按钮，因为列表本来就是默认视图。文案键：新增 `exitTextMode`，移除 `listMode` / `modeSwitch`；
README（中英）同步。

### 17.5 最终形态：页面只保留纯文本编辑器（2026-11-06）

用户最终确认：「直接用这个（textarea）来配置路径即可，不用列表来配置了，所以只需要一个保存按钮」。页面因此收敛为：

- **唯一的编辑界面**是那个 textarea（每行 `路径 | 访问级别 | 作用面`，显式三段、`#` 注释、裸名=名称规则）；
- 工具栏只剩 **保存** + 同步状态；没有模式切换、没有列表、没有 `+` 行；
- 保存 = 解析整段文本（全有或全无）并写入 `paths`；解析错误按行提示且不写；宿主拒绝时明确显示；
- 基准工作区仅用于预览；解析预览按「最后一次成功解析的草稿」展示，文本半途写错不会让预览闪错误；
- 清掉页面不再使用的列表容器样式与无引用的工具栏/模式文案键；README（中英）设置页章节改写为
  「一个纯文本编辑器，一个保存按钮」。（当时保留的规则行组件 `RuleRow` 与解析辅助函数随后在 17.8 全部删除。）

### 17.6 编辑区内置示例（2026-11-06）

用户指出原来的单段语法说明不够——需要「示例 / 说明支持配置的方式」。实现：编辑器上方一行简短提示 +
可折叠的 **「示例与支持的写法 / Examples and supported forms」**（`<details>` + `<pre>`，等宽、只读、可滚动），
内容随宿主语言（zh/en 字典里的 `examplesBody`）覆盖：

1. 可写（随会话，fs+shell）；2. 只读降级；3. deny；4. always-write + 只作用 fs；
5. 裸名名称规则（`.git`/`.env`，仅 fs 工具）；6. 模式（`*`/`**`，可注入 shell）；7. Windows/WSL 写法；
末尾附级别与作用面的取值表、相对路径/`~`/注释规则。测试钉住示例内容与双语字典；README 设置页章节同步说明。

### 17.7 说明省略字段的默认值（2026-11-06）

用户指出「不写的时候默认是什么要说明」。实现：编辑器上方在提示下再加一行**动态默认值说明**，值来自当前配置的
`defaultAccess` / `defaultSurfaces`（不是写死文案，改了配置文档后显示随之变化）：

> 省略字段时的默认值：访问级别 = write，作用面 = fs+shell（来自配置文档的 defaultAccess / defaultSurfaces）。

同时：提示文案改为指向这一行；示例块末尾补上「省略 -> defaultAccess（默认 write）/ defaultSurfaces（默认
fs+shell）」；README（中英）设置页章节同步说明。测试钉住默认值行会渲染 `write`/`fs+shell`/`defaultAccess`
以及双语 `editorDefaults` 占位符。

### 17.8 清理与优化（2026-11-06）

页面确定为纯文本编辑器后，把上一版列表视图的残留全部清掉：

- **删除死代码**：`page.tsx` 的 `RuleRow` 组件与 `resolutionText`；`client/paths.ts` 的
  `resolveRuleLexically` / `RuleResolution` / `resolutionOf`（约 70 行，仅列表行使用）；未使用的 `Surface` import。
- **删除死样式**：`styles.ts` 中规则行专用键（`rule`/`accessSelect`/`rulePath`/`surfaceButton`/`badge`/
  `deleteButton`/`accessDot*`/`primary`/`linkButton`）与 CSS 类 `.xp-rule*`、`.xp-surfaces*`、`.xp-button-off`。
- **删除死文案**：21 个不再有渲染入口的 locale 键（行标题/列头/占位符/解析提示/空列表文案等），中英字典同步。
- **注释与文案校正**：page 模块注释、`TextModeEditor` / `PreviewPanel` 注释、`client/paths.ts` 里指向已删函数的
  注释、测试文件头部说明；README（中英）两处仍描述"路径行/tooltip"的段落改为描述解析预览；AGENTS 版本表改为
  "纯文本规则编辑器（每行一条 + 默认值行 + 内置示例）"。
- 测试同步删除 `RuleRow` 与 `resolveRuleLexically` 的描述块：**21 文件 / 527 条全绿**（减少的是死代码测试），
  host/client typecheck、`lib/` 重建、sanitized 均通过。

### 17.9 长行不换行（2026-11-06）

用户反馈：文本编辑器里路径/配置很长时不要自动换行，否则断行后难以辨认；宁可自己用触控板/鼠标横向滚动。实现：

- `<textarea wrap="off">` + 行内样式 `white-space: pre; overflow-wrap: normal; word-break: normal; overflow-x: auto`
  （`styles.textarea`），软换行彻底关闭；
- 预览里的路径同样按 token 处理：`styles.code` 改为 `white-space: nowrap`，`.xp-entry-paths` 改为
  `flex-wrap: nowrap; overflow-x: auto`，长路径单行横向滚动；
- 示例块本来就是 `<pre>`（`white-space: pre` + `overflow: auto`），行为一致；
- 测试：编辑器断言 `wrap="off"`/`white-space:pre`/`overflow-x:auto`；PreviewPanel 用超长路径断言
  `white-space:nowrap` + 样式表里的 `flex-wrap: nowrap` / `overflow-x: auto`；README（中英）补一句说明。

### 17.10 0.3.1：把长行不折行修复纳入发布（2026-11-06）

v0.3.0 的 tag/暂存包产生于长行修复之前。用户选择「发布：0.3.1」：

- `package.json` → `0.3.1`；AGENTS 版本表当前行改为 `0.3.1`（并注明长行不折行）；
- 实际情况：准备 0.3.1 期间维护者已批准 0.3.0，因此 **0.3.0 先上线了**（无长行修复）；0.3.1 作为 patch
  紧随其后，把长行修复补上。v0.3.0 的 draft release 已删除，tag 保留作为历史提交标记；
- 0.3.1 包含：0.3.0 全部功能 + `fix(ui): keep long rules on one line`（编辑器/预览路径不折行、横向滚动）。
