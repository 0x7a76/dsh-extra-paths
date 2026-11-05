# AGENTS.md — dsh-extra-paths 仓库约定

给**在本仓库工作的 agent** 的操作约定。用户向的说明在 `README.md`（英文）/ `README.zh.md`（中文），实现记录与踩坑在
`docs/superpowers/plans/`，本文件只写"在这里干活必须遵守什么"。

## 版本约束（最重要，先读这条）

**插件版本是独立的语义版本，与 DSH 官方版本号无关**；宿主兼容性由 `engines.dsh` + peer 声明，并由 0.2.x 的安装闸门**强制**。两者分工明确：

| 插件版本 | 含义 | 支持的 DSH 线 |
|---|---|---|
| `0.2.1` | 设置页文案跟随 DSH 语言选择（zh/en 字典 + 框架 `t` seat）（当前） | 0.1.5 / 0.2.0 / 0.2.1 / 0.2.2 |
| `0.2.0` | 支持 0.2.2 线；补齐 0.2.2 新增的三类 fs 变更（patch/delete/move）；设置页保存被拒时显式报错 | 0.1.5 / 0.2.0 / 0.2.1 / 0.2.2 |
| `0.1.1` | 双语 README、MIT 许可、发布防呆 | 0.1.5 / 0.2.0 / 0.2.1 |

- **minor** = 支持了新的宿主线或不兼容调整；**patch** = 修 bug / 文档 / 元数据。
- **禁止**把版本号写成宿主号（`0.2.1.1` 四段非法，`0.2.1-1` 会排在官方 `0.2.1` 之前，两者都已否决）。
- 首个版本 `0.1.0` 一次就支持三条线，因此**版本号大小与支持范围无关**；兼容矩阵看 `engines.dsh` + peer，
  每次发布同步写进本文件顶部的表与 tag message。

🔴 **兼容范围有两处，必须同时改**：`engines.dsh` **和每一个 `@deepseek-ai/dsh-*` peer**——
0.2.x 的 `dsh plugin add` 会**逐条**用 semver 校验 peer（`includePrerelease` 参与匹配），任一条不满足就
**拒绝安装**。当前值：

```
>=0.1.5-0 <0.1.6-0 || >=0.2.0-0 <0.2.2-0 || >=0.2.2-0 <0.2.3-0
```

`-0` 后缀是刻意的：写 `<0.1.6` 会放行 `0.1.6-alpha.2`，写 `<0.2.2` 会放行 `0.2.2-alpha.1`。
放宽前请用 `semver.satisfies(v, range, { includePrerelease: true })` 跑一遍逐版本矩阵。

### 扩一条宿主线的 SOP（不许跳步）

1. **取证**：把目标版本从 registry 取到临时目录（`pnpm add @deepseek-ai/dsh@<ver>`），与已支持版本**逐文件 diff**：
   `dsh-sandbox-local`、`dsh-fs-sandbox`、`dsh-settings`、`dsh-system-prompt`、`dsh-host-webserver`、
   `dsh-client-connection` 的 `lib/index.js`；cordis 的 `internal/get` 是否仍在；客户端
   `dsh-client-modules` / `dsh-client-ui-settings` / `dsh-client-ui-plugin-manager` 的差异，以及
   `settings.section` / `plugins.item` 的出现次数。
2. **实测**（scratch 环境，别用用户的 `~/.dsh`）：`DSH_HOME=/tmp/dsh-home-<ver>` + headless profile +
   `link:` 安装本仓库 → 看①闸门是否放行 ②组合树里有没有我们的条目（`--dump-config`）
   ③真实 agent 往**工作区之外**写文件能否成功。审批策略是 `ask` 且 headless 无应答者，被拒必然 fail-closed，
   所以"文件出现"就是硬证据。
   ⚠️ **bash 侧在本会话里验不了**：子进程再调 `sandbox-exec` 会被外层沙箱拒绝（基线同样失败）——
   因此 argv 加宽用"真实 provider argv 夹具测试"钉住（见 `tests/argv.test.ts`）。
3. **通过之后**才放宽范围 → 按上表升版本 → 打 annotated tag；**没通过就不要声明**。
4. 把结论回填 `docs/superpowers/plans/`：diff 结论、实测命令与结果、范围矩阵。

### 发布一个版本的 SOP（不许跳步）

**前提**：npm 上该包的 **Settings → Trusted Publisher** 已登记 repo `0x7a76/dsh-extra-paths` + workflow
`release.yml`（Environment 留空）。没登记时推 tag 换不到凭据，会以 `ENEEDAUTH` 失败。
**Allowed actions 两个勾都不用打**——`npm stage publish` 是永远允许的（最小权限：这个 workflow 拿不到直接发布的权力）。

1. **本地先绿**：`pnpm run typecheck`（宿主 + 客户端两侧）、`pnpm test`、`pnpm run build` 全过。
   行为改动最好在真实宿主上实测一次（桌面版的验证办法见 README「安装」与扩宿主线记录里的写法）。
2. **升版本号（两处必须同时改）**：`package.json` 的 `version` + 本文件顶部的版本表。
   **patch** = 修 bug / 文档 / 元数据；**minor** = 新增宿主线或不兼容调整。**禁止**写成宿主号。
3. **重新构建并一起提交**：`pnpm run build` → `git add -A`（含 `lib/`）→ 提交。CI 会核对 `lib/` 与一次全新构建
   是否一致，漏了直接红。
4. **打 annotated tag 并推送**：`git tag -a vX.Y.Z -m "vX.Y.Z — 一句话；兼容范围 …"` → `git push origin vX.Y.Z`。
   tag message 写清支持的宿主线（与顶部版本表一致）。**只推这一个 tag；不要重复推已存在的 tag**——
   那会让 workflow 去发一个已存在的版本，registry 直接拒绝。
5. **workflow 只暂存，不发布**（`.github/workflows/release.yml`）：校验 `tag == package.json.version` → `pnpm install`
   → `prepublishOnly`（build + 全量测试）→ 用 **OIDC** 跑 `npm stage publish`（仓库里没有 token，**不会上线**）
   → 建一个 **draft** GitHub Release，并把 **stage id + 批准链接**写进 job summary。
6. **人工批准（2FA）**：到 https://www.npmjs.com/settings/0x7a76/staged 点 **Approve**（或 `npm stage approve <id>`）——
   这一步之后版本才真正出现在 registry（`latest` 才会指向它）；随后把那个 draft Release 发布掉。
   不想上线就 **Reject**，registry 上不会留痕。
7. **发布后核对**：`npm view dsh-extra-paths version dist-tags license`；再把 `npm pack --dry-run` 的 shasum 与
   registry 上的 `dist.shasum` 比一次（必须逐字相同）。桌面版装了就顺手升级：
   `dsh plugin --profile desktop add dsh-extra-paths@X.Y.Z`（改 `~/.dsh`，且要重启应用生效）。
8. **出错怎么办**：npm 上已发布的版本**不可修改**，发错了只能再发一个 patch；tag 推错了可以删
   （`git push origin :refs/tags/vX.Y.Z`），但已经发布出去的内容收不回来。手工 `npm publish` 只作为 workflow
   不可用时的兜底，事后仍要补 tag，别让 registry 与仓库脱节。
   **想改成"推 tag 直接上线"**：在 Trusted Publisher 里勾上 "Allow `npm publish`"，并把 workflow 的
   `npm stage publish` 换成 `npm publish`（并去掉 draft 与 summary 两步）。当前刻意不这么做——发布权留在人手里。

## 仓库操作约定

- 🔴 **`lib/` 是提交的构建产物**（profile 用 `link:` 安装，加载的就是它）→ 改完 `src/` **必须
  `pnpm run build` 再提交**，否则用户跑的还是旧代码。
- 验证三件套：`pnpm run typecheck`（宿主 + 客户端两侧）、`pnpm test`、`pnpm run build`。
- **peer 类型从哪来**：`scripts/dsh-paths.mjs` 生成 `tsconfig.peers.json`，按仓库自己的 `node_modules`
  → `$DSH_APP_DIR/node_modules` → `which dsh` 所在应用目录的 `node_modules` → `$DSH_HOME/profiles/node_modules`
  的顺序，取**第一个真含 peer 包（`peerDependencies` 里的 `@deepseek-ai/*`）的目录**。
  ⚠️ 桌面版 **0.2.1 起把宿主包全部打进 `app.asar`**（asar 是单文件，tsc 读不了），而 `$DSH_HOME/profiles/node_modules`
  下那些 npx 时代的符号链接已经**断链**——所以脚本现在按"peer 的 `package.json` 可读"判断，并把断链目录列出来，
  不再因为"目录里有 `@deepseek-ai`"就选中它（只含 `schemastery` 这种真依赖的 `node_modules` 也不算）。
  两个可行来源：`DSH_APP_DIR=/某目录`（该目录 `node_modules/@deepseek-ai/<peer>` 必须是真文件，
  例如 `npm i --prefix /tmp/dsh-peers @deepseek-ai/dsh-client-ui-settings@<宿主线>`），或者
  `pnpm add -D @deepseek-ai/dsh-client-ui-settings@<宿主线>`（会进 lockfile，与 `autoInstallPeers: false` 的取舍见
  `pnpm-workspace.yaml`）。客户端只有一个空的 `import type {}` 依赖该包可解析。
- **测试默认跑全量**：16 个文件 / 210 条 / 约 2 秒。本仓库的改动几乎都落在跨模块契约上
  （服务包装器、policy 换算、模式展开、客户端槽位），收敛范围反而更容易漏。
- 文档分工：`README.md`（英文）+ `README.zh.md`（中文）只面向使用者（是什么、怎么装、怎么配）；
  `docs/superpowers/plans/` 记实现与踩坑；本文件只写约定。技术细节（两代宿主契约、机制、版本规则）写在这里或
  plans 里，**不要往 README 堆**。
- **两份 README 是等价的权威版本**（沿用 DSH 生态的 `README.md` / `README.zh.md` 约定，H1 下面放语言切换行）：
  改任何一侧都要把另一侧带上，别让它们漂移。npm 会自动打包 `README*`，不需要写进 `files`。
- 三个 tsconfig：`tsconfig.json`（宿主）、`tsconfig.client.json`（客户端）、`src/client/tsconfig.json`
  （**仅给编辑器就近匹配用**，没有它编辑器会拿宿主配置检查 `.tsx` 并报 `TS17004`）。
- 🔴 **公开仓库，禁止提交任何本机 / 个人信息（含 `docs/` 与 plans，不只是代码）**：
  - **本机绝对路径**：`/Users/<name>`、`/home/<name>`、本机 DSH 源码检出路径、profile 副本路径——文档与命令示例
    一律写占位符（`<repo>`、`<dsh 源码检出>`、`~`、`/tmp/...`）。测试夹具只能用虚构名（`/Users/someone` 等）
    并登记进 guard 的 allowlist；
  - **本机标识**：用户名、主机名（`*.local`）、时区/地区/IP/端口（通用 `127.0.0.1` 文档示例除外）、机器配置细节；
  - **个人与账号信息**：真实姓名、个人邮箱、账号 ID。**唯一例外是包必需的公开身份**：`0x7a76`
    只允许出现在 LICENSE 版权、`package.json` 的 repository/homepage/bugs、workflows 的 staged 链接与 AGENTS 的
    发布说明里；
  - **凭据**：token、API key、密码、私钥、`.env` / `.npmrc` / `.git-credentials`、SSH key——任何形式都不行；
  - **本机残留**：`*.bak-*` 备份、`.dsh-probe/`、`.probe-*`、`.xpaths-*`、tarball/日志等。
  **提交前必须**跑 `pnpm run check:sanitized`（`scripts/check-sanitized.mjs`，CI 两个 workflow 已强制）：
  它扫描所有 tracked 文件，命中 home 路径 / 个人标识与邮箱 / `.local` 主机名 / GitHub、npm、云厂商 token / 私钥块即失败。
  2026-11 的 0.2.0 记录曾把本机源码检出路径写进 plans，最后靠重写历史才清掉——别再犯。
  **提交作者信息**（维护者的公开 commit 身份与提交邮箱）会随公开仓库可见，这是本仓库有意保留的 maintainer 身份，
  不在本限制范围内；除它之外不得出现其他个人邮箱与姓名。
- **CI 与发布**：`.github/workflows/ci.yml` 在 push/PR 上跑验证三件套，并检查 `lib/` 相对一次全新构建有没有漂移
  （改了 `src/` 忘记重建会直接红）；`.github/workflows/release.yml` 在推 `v*` tag 时用 **OIDC** 把版本
  **提交到 npm 暂存区**（不需要任何 token，**不会直接上线**），等维护者 2FA 批准后才出现在 registry，
  同时建一个 draft GitHub Release。
  ⚠️ **CI runner 上没有 DSH**：workflow 会先往 `$RUNNER_TEMP/dsh-peers` 装一个 `@deepseek-ai/dsh-client-ui-settings@0.2.2-rc.1`，
  再用 `DSH_APP_DIR` 指过去——因为 `scripts/dsh-paths.mjs` 是严格的，而 **`@deepseek-ai/dsh` 这个 npm 包并不含那些 peer**
  （它 82 个依赖里一个都没有）。扩宿主线时记得同步这个锚点版本。
  发布的完整步骤见上方「发布一个版本的 SOP」。
- 客户端改动**刷新页面即可生效**；宿主改动**必须重启 dsh**。

## 红线

- 不主动改用户 `~/.dsh` 下的配置（profile、settings）——除用户明确要求，且改动前**先备份**。
- **不要用旧版全局 CLI 去改新版 profile**（例如用 0.1.5 的 `dsh` 改 0.2.x 的 profile）：跨版本写 profile 有风险；
  桌面版的 profile 还归 Electron 应用独占（`--dump-config` 会被拒绝）。
- 探针/夹具用完即删，不要往用户仓库或家目录里留 `.probe-*`、`.xpaths-*` 残留。
- 需要读用户机器上的配置时，只输出必要片段——别 `cat` 含令牌的文件。

## 关键实现约束（改代码前先读）

- **拦截缝**是 cordis 的 `internal/get` 瀑布：只对 `provide()`/`super(ctx, name)` 注册的服务生效，
  且**只有真实 runtime 里才走**（裸 `new Context()` 测不出来）；`ctx.get(name)` **绕过**它（已知缺口）。
- **包装器必须镜像内层的同步性**：0.1.5 的 `sandbox.confine` 是**同步**的（调用方直接读 `.argv`），
  0.2.x 是 `async`（调用方 await）。写成 `async` 会让 0.1.5 上每条被限制的命令崩在
  `Cannot read properties of undefined (reading '0')`。
- **fs 缝在 0.2.2 变宽了**：`dsh-fs-sandbox` 的 in-process fence 从两个变更（`writeText`/`editText`）扩到
  **五个**（新增 `patchText`/`deleteFile`/`moveFile`，对应 apply_patch、删除与移动），且 policy 里新增
  `additionalWritableRoots`（一次调用可授予多个显式根）。`wrap-fs` 必须**按内层实际存在的方法**逐个包
  （老宿主没有这三个方法）、`moveFile` 两端都要在配置集合内；跨根移动用 `additionalWritableRoots` 表达
  （0.2.2 才有该字段，也是唯一有 `moveFile` 的宿主代）。`policy.ts` 的 `syntheticPolicy` 在提权时会**丢掉**调用方
  的 `additionalWritableRoots`，避免 `read-only` 会话里的 `always-write` 授权把部署根一起放进来。
- **设置页写入会被 home/CLI 覆盖拦下**：0.2.x 的 config editor 先写 profile patch，再用
  `readProfilePatches` 重新组合（含 home patch 和命令行 `--patch`）并比对；同一个 id 被 home 层/命令行覆盖时
  直接抛 `Configuration for "X" is overridden by a home patch or command-line overlay`，**不落盘**。
  客户端 `configForms.get(ns).set()` 对这种拒绝返回 `false`（不是异常）——页面必须当失败显示，否则会清掉
  dirty 再重绘宿主旧值（"删掉的路径又回来"就是它）。本插件的 `lateBoundScope` 把 `false` 转成带说明的
  rejection（`SAVE_REFUSED_MESSAGE`，`src/client/page.tsx`）。因此**插件配置应放 profile patch**；
  home 层只放跨 profile 的 insert/覆盖别的东西。实测：把 home 覆盖从磁盘删掉后，下一次保存时宿主会重新组合，
  **不需要重启**就能恢复可写。
- **客户端文案跟随宿主语言**：所有页面 copy 必须走 `src/client/locales.ts` 的 `zh` / `en` 字典（两个字典的**键集**
  与每个键的 `{placeholder}` 集必须一致，`tests/locales.test.ts` 钉住）；`apply()` 里
  `ctx.locale.register(NAMESPACE, { zh, en })` 并 `ctx.locale.bind(NAMESPACE)`；每个 slot 注册都带
  `locale: NAMESPACE`，组件从 slot props 取框架注入的 `t`（语言切换时渲染器换新函数并重渲染，无需 reload）。
  没有 `t` seat 的宿主（0.1.5 slots、单测）回落到内置中文 `fallbackTranslate`；其它界面语言由宿主的语言链回落到
  `en`。客户端 `inject` 必须列 `locale`（0.1.5-rc.3 起 web-app 都挂载 `@deepseek-ai/dsh-client-locale`），
  `package.json` 的 `dsh.client.inject` 也要声明该客户端模块，保证 locale 模块先于本插件加载。
- **宿主 settings 有两代**：0.1.5 是 `ctx.settings.register` + scope；0.2.x **没有 register**——
  命名空间就是 profile 条目、schema 是本模块导出的 `Config`（字段必须 `.volatile()`，否则框架不生成表单）、
  值按**每次决策实时重读**（改完即生效）。别让 0.1.5 的 entry config 覆盖用户设置（那只是 `base` 层）。
- **客户端 scope 有两代**：`ctx.settingsScope.bind`（0.1.5）→ `ctx.configForms.get`（0.2.x），接口同形，
  所以页面零改动；客户端的 `inject` **只能列两代都存在的服务**，列了不存在的会让插件永久等待激活。
- **插件设置页挂在哪个 slot（0.2.x 的教训）**：`plugins.item` 是**官方插件**专用的 list slot，注册进去会把第三方
  条目塞进「内置插件配置」分组；属于第三方组合包的是 **keyed** 的 `plugins.row.config`，键为 `<包名>#<行 id>`
  （本仓库 `dsh-extra-paths#extra-paths`，行 id 来自 `cordis.patch.yml` 的 `insert[].id`），该行由此多出一个
  「配置 {name}」控件，打开自己的页面。组件必须按 `view` 分流：`view === 'summary'` 只画一行（插件列表里就靠它——
  把整个表单画在这里会把列表撑开好几屏，这正是曾经的 bug），其余（`view: 'page'`）才是编辑器。
  0.1.5 走 keyed 的 `settings.plugin.item`（键=设置命名空间），`settings.section`（设置左栏）两代都在。
  行页给组件的是 `view: 'page'` **加一个宿主侧 `form`（`{state, mutate}`）**——我们不用它，页面照旧经
  `configForms` 编辑命名空间（两代同一套方法）；`view: 'summary'` 只在**包没有 description 时**才会被问
  （行页是 `description ?? renderSlot(...)`），我们的包有 description，所以实际渲染的总是编辑器。
  **profile 的 `cordis.patch.yml` 里同名 id 的条目不会改变行的归属**：行的 rowId 只来自**组合包自己的 patch**
  的 `insert[].id`（profile 那层只管开关状态），所以行键稳定。
  `tests/client-slots.test.ts` 把这两个键与 `package.json` / `cordis.patch.yml` 钉在一起。
  **未声明的 slot 用 `ctx.slots.inject` 注册是静默 no-op（不报错）**，只有裸 `slots.register` 才抛。
- **预览路由**用 `connection.requestRejection(req)` 拒绝未认证请求（两代都有）；路由 handler 自己负责完整响应生命周期。
