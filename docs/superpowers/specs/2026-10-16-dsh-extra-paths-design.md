# dsh-extra-paths 设计文档

> **路径占位符**：本文档里的 `$REPO` 是本仓库的检出目录、`$KB` 是使用者自己的知识库/笔记根目录、`$PARENT` 是仓库所在的上层目录、`<工作根>` 是使用者放项目的上层目录；`$(npm root -g)/@deepseek-ai/dsh` 是 DSH 的全局安装目录。文档不记录任何人的本机绝对路径。


> 状态：待用户复核
> 日期：2026-10-16
> 目标仓库：https://github.com/0x7a76/dsh-extra-paths.git
> 开发目录（= session workspace = profile 安装路径）：`$REPO`

## 1. 问题与目标

日常把知识沉淀到工作区之外的仓库（如 `$KB`）时，每一次写操作都要走一次授权：
先被沙箱拒绝 → agent 用 `sandbox_permissions` 重试 → 用户在审批里点同意。摩擦在"每次"。

根因：当前 DSH 的 `workspace-write` 只认**一个**可写根。`writableRoots(policy) = [policy.workspaceRoot, '/tmp', os.tmpdir()]`
（`packages/sandbox/sandbox/src/roots.ts`），fs 工具的进程内围栏（`dsh-fs-sandbox`）与 bash 的子进程 profile
（Seatbelt/bwrap/Landlock）都从这一个函数取值。核心刻意没有留配置口子——设计笔记
`.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md` 明确把它列为延后项：
"Extra writable-root grants on `SandboxPolicy` — deferred unchanged"。

**目标**：做一个第三方插件，让用户配置的一组外部路径**首次尝试即可写、无需授权**，同时不修改 DSH 核心代码、
不降低对未来 DSH 版本的兼容性，并提供 Web 设置页（含当前会话的生效根预览）。

**非目标（明确不做）**：
- 逐路径的"完全不受限"。bash 沙箱是**整次调用**粒度（profile 套在整个子进程上），无法"只对某路径不设限"；
  一条 `rm -rf /` 与一次对知识库的写入在同一个 profile 下。要"完全不受限"只能整次调用走现有
  `danger-full-access` 升级通道，那不是路径级能力。
- "读"的开关。读在所有模式下都自由（fs 围栏只拦 `writeText`/`editText`；Seatbelt profile 是 `deny file-write*`），
  子进程执行也不按路径受限。本插件的 scope 只表达"写"。
- 覆盖 `ctx.get('fs'|'sandbox')` 这种读法（见 §7 缺口）。
- Windows 的 shell 侧放行（fs 侧可用）、SSH/远程沙箱、`deliverables` 的工作区变更追踪。

## 2. 运行环境事实（已核实）

| 事实 | 值 | 影响 |
|---|---|---|
| 实际运行的 DSH | npm 全局安装 `@deepseek-ai/dsh@0.1.5-rc.1` | 改本地源码仓库不影响在跑的 GUI |
| 本地源码仓库 | `$PARENT/deepseek-harness`，`0.1.6-alpha.2`，**未构建** | 故走插件而非改核心 |
| cordis | `@deepseek-ai/cordis@4.0.2` | 已验证 `internal/get` 存在且语义如下 |
| profile | `~/.dsh/profiles/<name>`，`patchReload: live` | 插件行改动即时生效 |
| profile pnpm | `autoInstallPeers: false`，registry 为使用者自配的私有源（与本仓库无关，故不在此记录） | peer 不会被安装；依赖需显式声明 |
| 该 profile 已有第三方插件 | 若干（具体包名与本仓库无关，故不在此记录） | 提供"带设置页的第三方插件"现成先例 |

## 3. 机制：`internal/get` 运行时包装（方案 B）

### 3.1 为什么不是组合交换（方案 A）

官方替换"能力实现"的机制确实是组合：`docs/capability-seams.md` 把 `ctx.fs`/`ctx.sandbox`/`ctx.shell`
标为 `seam`，并写明 sandboxed/remote executor "replace bash-local without touching them"；
`dsh-fs-sandbox` 相对 `dsh-fs-local` 就是这么换的。方案 A 即：插件 patch 禁用基础 bundle 的
`fs-sandbox`/`sandbox` 两行，插入自己一行同时 provide 两个服务。

**A 被否决的原因是失败模式**：它依赖基础条目 id 与两个基类的 API。未来某版改了 id 或类签名 →
基础行未被禁用 → 同名服务**重复 provide → boot 失败（GUI 起不来）**。在"跨版本兼容"这一约束下，
硬失败不可接受，而 B 天生软失败。

### 3.2 机制与已验证的证据

监听 `internal/get`（`vendor/cordis/src/events.ts` 声明的 waterfall：`(ctx, name, error, next) => any`），
在服务**被读取的瞬间**返回包装对象。已验证的机制事实：

- `provide()` 会把服务登记为 `{ type: 'service' }` 属性，get 陷阱对 service 属性**不短路**，
  直接走 waterfall；`dispatch` 的过滤器在 `thisArg[Context.filter]` 为 undefined 时放行全部监听器。
- **`ctx.foo` 只在声明了 `inject: ['foo']` 的 fiber 里读得到**（fiber 的 `_store` 只装自己注入的依赖）。
  这正是 `bash-sandbox` 写 `static inject = ['subprocess','sandbox','sandboxPolicy']` 的原因；
  在树消费者都是这么读的（`this.ctx.sandbox.confine(...)`、`ctx.fs.writeText(...)`），**每次调用现场读**。
- **cordis 每次读取都会 `new Proxy` 包一层**（`getTraceable` + `createTraceable`，为了让方法内的
  `this.ctx` 解析成调用方的 ctx）。因此 `ctx.foo === ctx.foo` **在原生 cordis 里就是 false**，
  包装不引入新的身份破坏；同时也说明"按实例 memo 包装"没有意义。
- 原生 cordis 下**解构出来的方法调用会 `this === undefined` 直接抛错**（`createShadowMethod` 的
  `thisArg === outer` 判定）；包装把方法绑到内层实例反而顺手修掉了它。

实验脚本（可重跑）：`spike/cordis-get-wrap.mjs`、`spike/cordis-get-wrap-baseline.mjs`，
以"基线（不挂监听）vs 包装（挂监听）"对照，结论：`constructor` 不绑、其余方法绑到内层实例后，
原生 `instanceof`、构造名、取值器、字段写入、`this.ctx` 的 shadow 语义**全部与不包时一致**，
只有被刻意拦截的方法不同。

### 3.3 组件

单行插件（Host + Client 两个半边）：

1. **一个插件行**：`dsh.bundle.patch` → 自己的 `cordis.patch.yml`，只 `insert` 一行，**不禁用任何基础行**。
2. **一条监听器**：`ctx.on('internal/get', (readCtx, name, error, next) => { const value = next(); … })`。
   - 永远调用 `next()`；自身逻辑整体 try/catch，**任何异常都原样返回 `value`**——
     保证"读服务"的语义绝不因本插件改变（这是最大的波及面，硬性 fail-safe）。
   - 只对 `name === 'fs' | 'sandbox'` 且 `value` 为对象时返回包装器；其余每个服务读取只多一次字符串比较。
3. **两个包装器**（透明 Proxy，惰性、每次读取现场生成）：
   - `wrapFs`：只拦截 `writeText`/`editText`；其余 `Reflect.get(inner, prop, inner)` 透传；函数（**除 `constructor`**）
     绑定到内层并缓存。
   - `wrapSandbox`：只拦截 `confine`；其余同上。
4. **纯函数核心**（不依赖 cordis、不依赖 `@deepseek-ai/*`，可单测）：
   `resolveRoots()`、`grantFor()`、`isUnder()`、`syntheticPolicy()`、`widenArgv()`。
5. **设置与 UI**（§5、§6）。

### 3.4 运行时依赖策略（跨版本兼容的落点）

- **Host 半边零运行时 `@deepseek-ai/*` 导入**（除了下面这一条例外），只用 `ctx` API 与实例方法名：
  任何一环对不上 → 不授权 + 告警，绝不影响启动。类型用 `import type`（编译期擦除）从 peer 包取得。
- **唯一例外**：`@deepseek-ai/schemastery`。`settings.register(namespace, schema, …)` 必须传 schema 对象，
  无法回避；把它列为 `dependencies`（生态先例：`dsh-better-sidebar` 亦如此）。它只是校验器，
  **不参与任何身份判定**，因此多一份副本无副作用。
- **Client 半边必然依赖客户端 peer API**（`settingsScope`、slot id、primitives、workspace）。
  客户端 API 漂移时**坏的是设置页，执法链路照常工作**。这是所有第三方 UI 插件共同的取舍。
- **加载期自检**：插件声明 `inject: ['sandboxPolicy']`，注册监听器后激活时**通过代理读一次
  `ctx.sandboxPolicy`**；若监听计数器为 0 → 醒目告警"`internal/get` 拦截在本 DSH 版本不可用，
  额外路径不会生效"。这会把最坏的静默失效变成可见诊断。

## 4. 配置模型与 scope 语义

### 4.1 分层

`settings.register('extra-paths', schema, { base, applies: 'live', validate })`：

```
插件行 config（可选，通常留空）  ──►  settings base 层   ← 部署 / 该 profile 的默认值
                                              │
              ~/.dsh/settings.yaml 的 extra-paths 段  ← 用户在设置页里改的就是这一层
                                              │
                                  解析后的生效值（live）  ──►  两个包装器每次调用时读
```

`applies: 'live'` → 保存即生效，不需要重启/HMR/编辑 YAML。用户层已被覆盖的字段在页面上显示
"已覆盖 + 可重置为默认"，由框架直接提供。

### 4.2 schema

```ts
interface ExtraPathsSection {
  defaultScope?: 'write' | 'always-write'      // 默认 'write'
  defaultSurfaces?: ('fs' | 'shell')[]         // 默认 ['fs','shell']
  paths?: (string | { path: string; scope?: Scope; surfaces?: Surface[] })[]
}
```

### 4.3 语义矩阵（逐路径；不写就用插件级默认）

| `scope` | 会话 `read-only` | 会话 `workspace-write` |
|---|---|---|
| `write`（默认） | ❌ 仍拒绝（保留急停按钮） | ✅ 可写 |
| `always-write` | ✅ 也可写 | ✅ 可写 |

`surfaces`：`fs` = write/edit/str-replace 工具；`shell` = bash/pwsh 子进程。

### 4.4 路径解析规则

- 绝对路径原样；`~/…` 展开家目录；其他相对路径**按每次调用的会话工作区解析**（用户明确选择）。
- 因此同一份配置在不同工作区指向不同目录 → 必须有可见性（§6.3、§6.4）。
- 所有根 realpath 规范化后再比较（否则 `/tmp` vs `/private/tmp` 这类会静默失效）；
  根自身不存在时按"最深的既有祖先 realpath + 剩余后缀"规范化，与 fs 侧 `resolve()` 的姿态一致。
- 去重合并：同一规范化根出现多次时取**最宽 scope**（`always-write` > `write`）与 **surfaces 并集**。
- 守卫：拒绝 `/`（等于关掉沙箱）；对 `$HOME` 本身这类过宽根告警；解析不存在/越界 → 告警（去重），该条不生效。
- agentless 调用（`resolve()` 无 session）→ 相对路径按部署回退根解析（与基类行为一致）。
- 条目解析结果**等于工作区根本身**时：`write` 无额外效果（工作区在 `workspace-write` 下本就可写）；
  `always-write` 仍按语义生效（即该会话即使在 `read-only` 下也能写工作区）。这是显式选择，不额外拦截。

### 4.5 校验（保存时拒绝，而非存下永不生效的值）

`validate`：路径非空、`/` 拒绝、**每条条目解析后的有效 surfaces 非空**
（即条目自身的 `surfaces`，未写则取 `defaultSurfaces`；两者都为空的条目无意义，保存时拒绝）、重复条目拒绝。
"相对路径是否真实存在"只能在解析时判断（依赖会话工作区），故保持解析时告警，不在保存时拦截。

## 5. 两个执行面的改法

### 5.1 fs 侧：策略翻译（不继承、不绕过围栏）

`SandboxedFileSystem.writeText(target, content, expected, signal, sandboxPolicy)` 的 policy
**只被用来判 mode 与可写根**，而可写根就是 `[policy.workspaceRoot, /tmp, tmpdir()]`。因此"放行某个额外路径"
等价于"这一次调用把 workspaceRoot 记成那个路径"——公开参数的正当用法（升级授权用的是同一参数，方向相反）。

```
writeText/editText(target, …, policy):
  inner 无 writeText 方法           → 不包装 + 告警（软失败）
  policy === undefined             → readCtx.get('sandboxPolicy', false)?.resolve()；取不到则原样委托（不授权）
  policy.mode === 'danger-full-access' → 原样委托（基类本就不设围栏）
  命中额外根（按 scope × mode × surfaces 判定）
      → inner.writeText(target, content, expected, signal,
                        { ...policy, mode: 'workspace-write', workspaceRoot: <该规范化根> })
  未命中                            → 原样委托（完全走今天的代码路径，拒绝标记与升级提示逐字不变）
```

`always-write` 在 `read-only` 会话下靠"把该次调用的 mode 抬到 `workspace-write`"实现——
这正是该 scope 的语义（把该路径从写限制里摘出去）。基类的 `resolve`／原子写／版本守卫／TOCTOU 复检全部复用。

### 5.2 shell 侧：按方言改写已包装的 argv

`inner.confine(argv, policy, signal)` 拿到 `ConfinedArgv` 后，仅在命中额外根时改写 `argv`：

| runner | 判定（结构性） | 追加 |
|---|---|---|
| Seatbelt (darwin) | `argv[1] === '-p'` 且 `argv[2]` 以 `(version 1)` 开头 | 向 profile 串追加 `(allow file-write* (subpath "…"))` |
| bwrap (linux) | argv 含 `--ro-bind` | 在 `--` 分隔符前插入 `--bind <root> <root>` |
| Landlock (linux) | 分隔符前含 `--ro`/`--rw` | 在分隔符前插入 `--rw <root>` |
| windows-acl | —— | **不支持**：不改写 + 告警（fail closed） |
| 未知/自定义 `runnerCommand` | 都不匹配 | **不改写 + 告警 = fail closed（不授权）** |

分隔符位置由"被包装 argv 的长度"反推（`confined.argv.length - argv.length - 1`），
因为被包装命令自身也可能含 `--`。`enforcement`／`denialSignatures`／`runnerFailureRules` 全部保持基类原值。
Landlock 分支仅由单测覆盖（开发机是 macOS，无真实 Linux 宿主可验），会在文档中标注。

### 5.3 system-prompt 可见性

注册一个 runtime-context 段（order = `SANDBOX_POLICY + 2` = 112，落在 sandbox(110) 与 approval(115) 之间），
只在本会话确有生效根时输出，列出这些绝对路径并说明"写入无需批准"。
避免模型因为"只能写工作区"的既有认知而拒绝或绕路。

## 6. Web 设置页（Host + Client 两个半边）

### 6.1 官方扩展点（已核实）

`@deepseek-ai/dsh-client-ui-settings-plugins` 的 Plugins 页声明 `plugins.item` 列表 slot；
插件用 `ctx.slots.inject('plugins.item', () => ctx.slots.register({ name:'plugins.item', id, order, label }, Render))`
贡献"卡片一行 + 页面表单"，**只在 Host 正在服务该 settings 命名空间期间注册**（未组装该插件的部署无痕迹）。
先例：`@laoyuehanni/dsh-git-worktree`（设置 → 插件 → "Git 工作树"）。

### 6.2 Client 半边

`dsh.client = { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-settings',
'@deepseek-ai/dsh-client-ui-settings-plugins', '@deepseek-ai/dsh-client-ui-primitives',
'@deepseek-ai/dsh-client-ui-workspace'] }`。

页面内容：逐条路径行（路径输入 + `scope` 选择 + `surfaces` 复选 + 删除）、"新增一条"、
底部固定说明（相对路径按各会话工作区解析）、以及**生效根预览**（§6.4）。
编辑留在草稿，保存时**一次 fenced `mutate` 提交整段**（并发写被拒绝而非覆盖）；被覆盖字段可重置为默认。

构建产物 `lib/client.js` 的格式是 `window.__ModuleLoader__.load({ id, factory: (require) => … })`，
其中 `react`/`react-dom`/`@deepseek-ai/*` 全部 **external**（由页面模块表提供，因此不会出现第二份 React、
没有 hooks 身份问题）。以 `dsh-git-worktree` 的已构建产物为参照，用 tsdown 构建。

### 6.3 生效根预览的通路与安全

settings 镜像只传配置本身，不传"按当前工作区解析出的路径"。官方 RPC（Typert API Gateway / `@Remote`）
对第三方插件走不通——`api-remotes` 的宿主方法是**编译期在客户端程序集里显式 mount 的白名单**，
第三方 namespace 不会被自动挂上（除非改组合，正是要避免的）。因此走**插件自有路由**，与 profile 里
两个第三方插件做法一致：

- `ctx.inject(['webServer', 'connection'], …)` 注册 exact 路由 `GET /extra-paths/resolved?cwd=<会话工作区>`；
  handler **先调 Connection 的鉴权 helper**（Host/Origin + 浏览器会话），拒绝即 401/403。
  （`/api` 前缀的鉴权由 Connection 插件统一施加；其他插件的自有路由必须自己调。）
- **安全硬化**：路由只解析**用户自己配置里的条目**，不接受任意路径探测 → 不是文件系统存在性 oracle。
- **响应**：`{ workspaceCwd, entries: [{ path, resolved, scope, surfaces, status: ok|missing|rejected }], effective: string[] }`，
  由与执法**完全相同**的纯函数 `resolveRoots()` 计算 → 预览与实际授权不可能漂移。
- **可选能力**：`webServer` 或 `connection` 缺失 → 不注册路由，页面提示"预览不可用"；执法不受影响。

### 6.4 预览的会话来源

Client 通过 `@deepseek-ai/dsh-client-ui-workspace` 拿当前会话工作区；无活动会话时页面显示
"相对路径按各会话工作区解析"。预览按**当前会话工作区**展示每条配置解析后的绝对路径与状态。

## 7. 失败模式（一律软失败，绝不影响启动）

| 情况 | 行为 |
|---|---|
| `internal/get` 被移除/语义变化 | 加载期自检告警；不授权 |
| 服务上方法改名（无 `writeText`/`confine`） | 不包装 + 告警 |
| 不认识的 runner 方言 | 不改写 argv + 告警（fail closed，不授权） |
| 配置含 `/` | 保存时拒绝 |
| 相对路径在该工作区不存在/越界 | 解析时告警（去重），该条不生效 |
| `webServer`/`connection` 缺失 | 无预览路由，页面提示；执法正常 |
| 客户端 API 漂移 | 设置页坏；Host 半边零导入，执法正常 |

**已知缺口（写进文档，不假装覆盖）**：`ctx.get('fs'|'sandbox')` 走 `reflect.get`，**不触发任何事件**，
用这种读法的消费者拿不到放行。在树里只有 `terminal-bash` 这么读，而它**未装在 web profile**
（base 与 web-app bundle 均无 terminal 行）；`agent-instructions`/`skill-filesystem`/`llm` 的
`ctx.get('fs')` 仅用于读与宿主路径映射。该缺口对当前场景无影响，但如实记录。

## 8. 测试与验收

**单测**（vitest，不依赖 cordis）：`resolveRoots`（`~`/绝对/相对/realpath/去重合并/守卫）、
`grantFor`（mode × scope × surface 矩阵）、`isUnder`、`syntheticPolicy`、`widenArgv`
（三方言 fixture + 未知方言 fail-closed）、config schema 与 `validate`。

**适配层对照测试**：复用 `spike/cordis-get-wrap-baseline.mjs` 的断言，对启动期那份 cordis 验证
包装透明性（`instanceof`/构造名/取值器/字段写入/shadow 语义）与 `ctx.get` 缺口。

**GUI 人工验收（7 条）**：
1. 设置页新增 `<工作根>/notes/home`（scope=write）→ 保存 → `write` 工具写入成功且**无审批提示**；
2. 同路径 `bash -c 'touch …'` 成功；
3. 相对路径条目 + 预览显示的解析结果 = 该绝对路径；
4. 会话切 `read-only`：scope=write 条目被拒（仍有升级提示），scope=always-write 条目仍可写；
5. 未配置路径（如 `$PARENT/deepseek-harness`）仍被拒 + 仍可升级；
6. `surfaces: [fs]` 条目：`write` 工具可写、bash 不可写；
7. 配置清空 → 立即恢复原状（live）。

## 9. 交付与安装

- 包名 `dsh-extra-paths`；`main: lib/index.js`；`dsh.bundle.patch: ./cordis.patch.yml`；
  `dsh.client` 见 §6.2。
- 构建：Host `tsc` → `lib/`（含 `lib/types`），Client tsdown → `lib/client.js`。
  **`lib/` 提交进仓库**（安装方式是"按绝对路径 add"，commit 后 clone 即可用；代价是每次改源码要重新构建并提交）。
  `.gitignore`：`node_modules`、`.idea`、测试产物。
- 安装：`dsh plugin --profile <name> add $REPO`。
- 目标远程：`https://github.com/0x7a76/dsh-extra-paths.git`，分支 `main`
  （提交身份用你自己的 git 配置，仓库不记录任何人的邮箱）。
  推送凭据由本机的 `credential.helper` 提供（见 §11）；远程需是**空仓库**（不要初始化 README），
  否则首次 push 会因历史不相关被拒。

## 10. 备选方案与已否决项（记录理由）

| 方案 | 结论 |
|---|---|
| A 组合交换（禁用基础行 + 提供自己的实现） | 官方推荐的"替换能力实现"方式，但跨版本是**硬失败**（重复 provide → boot 失败），在跨版本约束下否决。若未来核心自己落地 `extraWriteRoots`，本插件可直接摘掉、配置迁移。 |
| 运行期替换 `ctx.reflect.store[key].value` | 能覆盖 `ctx.get` 缺口，但属于改动 cordis 内部状态，且 HMR 需自行恢复，否决。 |
| `ctx.accessor('fs', …)` 拦截 | `provide` 与 accessor 同名互斥，会直接破坏基础服务，不可行。 |
| 靠"自动批准升级"绕过（hook/guard） | 升级是**整次调用**放宽到 `danger-full-access`（路径无关），且仍需一次拒绝+重试往返，与"无摩擦"目标不符。 |
| 把知识库放到 `/tmp`/`os.tmpdir()` 下再软链 | 不需要写代码，但 macOS 会清理 `/tmp`、把 git 仓库放在临时区不合理，且不满足"任意路径可配"。 |
| 把 `workspaceRoot` 抬到公共祖先 | 过度授权（例如 `<工作根>` 整棵树可写），否决。 |

## 11. 实施顺序（里程碑）

每个里程碑都可独立验证，前后不返工：

| # | 内容 | 验证方式 |
|---|---|---|
| M1 | 纯函数核心 + 单测：`resolveRoots`/`grantFor`/`isUnder`/`syntheticPolicy`/`widenArgv` | `pnpm test`（不依赖 cordis/DSH） |
| M2 | Host 执法链路：监听器 + 两个包装器 + 加载期自检 + 日志与 prompt 段。配置先用**临时硬编码单条路径** | 端到端即可验收核心目标：`write` 直写无审批、bash 同路径可写、`read-only` 语义、未配置路径仍被拒 |
| M3 | settings 命名空间 + live 生效（把 M2 的硬编码换成 live 快照）+ `validate` | 改 `~/.dsh/settings.yaml` 即时生效；非法输入在写入时被拒 |
| M4 | 预览路由（`webServer` + `connection` 鉴权 + 复用同一 `resolveRoots`） | `curl` 带/不带会话分别返回 200/401；预览与执法一致 |
| M5 | Client 半边：设置页（`plugins.item`）+ tsdown 构建 + external 契约 | 页面出现在 设置 → 插件；保存即生效；生效根预览正确 |
| M6 | 全量核对 §8 的 7 条 GUI 验收 + 构建 `lib/` + 绑定远程并推送 | 7 条全过；`git push` 成功 |

## 12. 待用户确认

1. **Git 推送授权**：`https://github.com/0x7a76/dsh-extra-paths.git` 是否已创建为**空仓库**？推送由你本机执行
   （凭据走 `credential.helper`），还是提供凭据（注意：把 token 贴进对话会留在会话日志里）。
2. 其余章节是否有需要修改之处。
