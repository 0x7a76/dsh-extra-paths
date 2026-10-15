# AGENTS.md — dsh-extra-paths 仓库约定

给**在本仓库工作的 agent** 的操作约定。用户向的说明在 `README.md`（英文）/ `README.zh.md`（中文），实现记录与踩坑在
`docs/superpowers/plans/`，本文件只写"在这里干活必须遵守什么"。

## 版本约束（最重要，先读这条）

**插件版本是独立的语义版本，与 DSH 官方版本号无关**；宿主兼容性由 `engines.dsh` + peer 声明，并由 0.2.x 的安装闸门**强制**。两者分工明确：

| 插件版本 | 含义 | 支持的 DSH 线 |
|---|---|---|
| `0.1.1` | 双语 README、MIT 许可、发布防呆（当前） | 0.1.5 / 0.2.0 / 0.2.1 |

- **minor** = 支持了新的宿主线或不兼容调整；**patch** = 修 bug / 文档 / 元数据。
- **禁止**把版本号写成宿主号（`0.2.1.1` 四段非法，`0.2.1-1` 会排在官方 `0.2.1` 之前，两者都已否决）。
- 首个版本 `0.1.0` 一次就支持三条线，因此**版本号大小与支持范围无关**；兼容矩阵看 `engines.dsh` + peer，
  每次发布同步写进本文件顶部的表与 tag message。

🔴 **兼容范围有两处，必须同时改**：`engines.dsh` **和每一个 `@deepseek-ai/dsh-*` peer**——
0.2.x 的 `dsh plugin add` 会**逐条**用 semver 校验 peer（`includePrerelease` 参与匹配），任一条不满足就
**拒绝安装**。当前值：

```
>=0.1.5-0 <0.1.6-0 || >=0.2.0-0 <0.2.2-0
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
- **peer 类型从哪来**：`scripts/dsh-paths.mjs` 生成 `tsconfig.peers.json`，按 `$DSH_APP_DIR/node_modules`
  → `which dsh` 所在应用目录的 `node_modules` → `$DSH_HOME/profiles/node_modules` 的顺序，取**第一个真含
  `@deepseek-ai/` 的目录**。桌面版把运行时装进 `app.asar`、CLI shim（`runtime/cli/bin/dsh`）旁没有
  `node_modules`，第三条就是给它兜底的。三条都不含 `@deepseek-ai` 时**直接报错并列出试过的路径**——
  静默写出坏映射只会拖到 `tsc -p tsconfig.client.json` 才以 TS2307 暴露（客户端有一个空的
  `import type {}` 依赖该包可解析）。
- **测试默认跑全量**：14 个文件 / 179 条 / 约 2 秒。本仓库的改动几乎都落在跨模块契约上
  （服务包装器、policy 换算、模式展开、客户端适配），收敛范围反而更容易漏。
- 文档分工：`README.md`（英文）+ `README.zh.md`（中文）只面向使用者（是什么、怎么装、怎么配）；
  `docs/superpowers/plans/` 记实现与踩坑；本文件只写约定。技术细节（两代宿主契约、机制、版本规则）写在这里或
  plans 里，**不要往 README 堆**。
- **两份 README 是等价的权威版本**（沿用 DSH 生态的 `README.md` / `README.zh.md` 约定，H1 下面放语言切换行）：
  改任何一侧都要把另一侧带上，别让它们漂移。npm 会自动打包 `README*`，不需要写进 `files`。
- 三个 tsconfig：`tsconfig.json`（宿主）、`tsconfig.client.json`（客户端）、`src/client/tsconfig.json`
  （**仅给编辑器就近匹配用**，没有它编辑器会拿宿主配置检查 `.tsx` 并报 `TS17004`）。
- **不要提交本机绝对路径、凭据或内部令牌**；示例一律用占位符或 `~`。
- **CI 与发布**：`.github/workflows/ci.yml` 在 push/PR 上跑验证三件套，并检查 `lib/` 相对一次全新构建有没有漂移
  （改了 `src/` 忘记重建会直接红）；`.github/workflows/release.yml` 在推 `v*` tag 时用 **OIDC** 把版本
  **提交到 npm 暂存区**（不需要任何 token，**不会直接上线**），等维护者 2FA 批准后才出现在 registry，
  同时建一个 draft GitHub Release。
  ⚠️ **CI runner 上没有 DSH**：workflow 会先往 `$RUNNER_TEMP/dsh-peers` 装一个 `@deepseek-ai/dsh-client-ui-settings@0.2.0-rc.2`，
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
- **宿主 settings 有两代**：0.1.5 是 `ctx.settings.register` + scope；0.2.x **没有 register**——
  命名空间就是 profile 条目、schema 是本模块导出的 `Config`（字段必须 `.volatile()`，否则框架不生成表单）、
  值按**每次决策实时重读**（改完即生效）。别让 0.1.5 的 entry config 覆盖用户设置（那只是 `base` 层）。
- **客户端 scope 有两代**：`ctx.settingsScope.bind`（0.1.5）→ `ctx.configForms.get`（0.2.x），接口同形，
  所以页面零改动；客户端的 `inject` **只能列两代都存在的服务**，列了不存在的会让插件永久等待激活。
- **未声明的 slot 用 `ctx.slots.inject` 注册是静默 no-op（不报错）**，只有裸 `slots.register` 才抛——
  所以 `settings.section` / `settings.plugin.item`(0.1.5) / `plugins.item`(0.2.x) 三个都注册，各代自取所需。
- **预览路由**用 `connection.requestRejection(req)` 拒绝未认证请求（两代都有）；路由 handler 自己负责完整响应生命周期。
