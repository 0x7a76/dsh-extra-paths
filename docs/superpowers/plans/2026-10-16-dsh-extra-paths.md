# dsh-extra-paths Implementation Plan

> **路径占位符**：本文档里的 `$REPO` 是本仓库的检出目录、`$KB` 是使用者自己的知识库/笔记根目录、`$PARENT` 是仓库所在的上层目录、`<工作根>` 是使用者放项目的上层目录；`$(npm root -g)/@deepseek-ai/dsh` 是 DSH 的全局安装目录。文档不记录任何人的本机绝对路径。


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DSH 能对一组配置的外部路径**首次尝试即可写、无需审批**（fs 工具 + bash 子进程），并提供 Web 设置页（含当前会话的生效根预览），全部以第三方插件形式实现、不改 DSH 核心、跨版本软失败。

**Architecture:** 插件用 `ctx.on('internal/get', …)` 在**服务被读取的瞬间**返回一个透明 Proxy 包装：`ctx.fs` 的包装做**策略翻译**（把 per-call policy 的 `workspaceRoot` 记成命中的额外根，交给基类自己去判），`ctx.sandbox` 的包装做**argv 方言追加**（Seatbelt/bwrap/Landlock）。配置存在 DSH settings 文档的 `extra-paths` 命名空间（Host 注册、live 生效），由 Web 设置页（`plugins.item` slot）编辑；预览走插件自有 HTTP 路由（Connection 鉴权），与执法共用同一个纯函数 `resolveRoots()`。

**Tech Stack:** Node 26 ESM、TypeScript 5.9（`tsc` 编 Host、`tsdown` 编 Client）、vitest、`@deepseek-ai/schemastery`（唯一运行时依赖）、React 18（客户端半边，react/react-dom 由页面模块表提供、不打包）。

**设计文档（先读，含机制证据与取舍）:** `docs/superpowers/specs/2026-10-16-dsh-extra-paths-design.md`

---

## 环境事实（零上下文的执行者必读）

| 事实 | 值 |
|---|---|
| 工作目录 = 插件包根目录 = profile 安装路径 | `$REPO` |
| 实际运行的 DSH（npm 全局安装） | `$(npm root -g)/@deepseek-ai/dsh`（`0.1.5-rc.1`） |
| DSH 源码仓库（只读参考，**不要修改**） | `$PARENT/deepseek-harness` |
| profile | `~/.dsh/profiles/<name>`（`patchReload: live`，改配置即时生效） |
| 用户设置文档 | `~/.dsh/settings.yaml` |
| 参考先例（带设置页的第三方插件） | 该 profile 的 `node_modules` 里已装的第三方插件 |
| 文件沙箱 | 当前会话是 `workspace-write`，可写范围就是插件包根目录；写包外路径会被拒（这是本插件要解决的问题本身） |

**安装/重载插件的命令**（Task 9 首次执行）：

```bash
dsh plugin --profile <name> add $REPO
```

**profile 里 pnpm 的 `autoInstallPeers: false`**：`@deepseek-ai/*` 不会作为 peer 被安装；只有 `dependencies` 里的包会真正装进 profile。因此 Host 半边除了 `@deepseek-ai/schemastery` 之外**不得有运行时 `@deepseek-ai/*` 导入**（类型用 `import type`，编译期擦除）。

**已验证的机制事实（不要重新假设）**：
1. `provide()` 把服务登记为 `{type:'service'}`；get 陷阱对 service 属性不短路，直接走 `waterfall('internal/get', ctx, name, error, next)`。
2. `ctx.foo` 只在声明了 `inject` 的 fiber 里读得到；在树消费者都是**每次调用现场读**（`this.ctx.sandbox.confine(...)`、`ctx.fs.writeText(...)`）。
3. cordis 每次读取都会新包一层 traceable Proxy：`ctx.foo === ctx.foo` 原生就是 `false`；**不要**试图按实例 memo 包装。
4. 从 traceable Proxy 上解构出来的方法调用会 `this === undefined` 抛错（原生限制）；包装把方法绑到内层实例，因此不要依赖解构行为做断言。
5. `ctx.get('fs'|'sandbox')` 走 `reflect.get`，**不触发** `internal/get`（已知缺口，见设计文档 §7）。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `package.json` | 包清单：`main`/`exports`、`dsh.bundle.patch`、`dsh.client`、scripts |
| `cordis.patch.yml` | bundle patch：**只 insert 一行**，不禁用任何基础行 |
| `tsconfig.json` | Host 编译（`src/**` → `lib/` JS + `lib/types/**` d.ts） |
| `tsconfig.client.json` | 客户端类型检查（`noEmit`，JSX，DOM） |
| `tsconfig.peers.json` | **生成物**：`paths` 指向本机 DSH 的 `@deepseek-ai/*`（仅供类型解析） |
| `scripts/dsh-paths.mjs` | 生成上面那个文件（`which dsh` → 应用目录 → `node_modules`） |
| `vitest.config.ts` | 单测配置（只测纯模块，不加载 cordis） |
| `tsdown.config.ts` | 客户端 bundle：CJS + `__ModuleLoader__.load` 外壳，react 等 external |
| `src/config.ts` | 配置类型、规范化、校验、`isFilesystemRoot`（纯） |
| `src/paths.ts` | `expandPath` / `canonicalizeRoot` / `isUnder`（本组唯一引入 `node:fs` 的模块；`isFilesystemRoot` 是纯词法判断，留在 `config.ts` 以免把 `node:fs` 拖进配置层） |
| `src/resolve.ts` | `resolveRoots()` → `ResolveReport`（执法与预览的唯一真相源） |
| `src/grant.ts` | `grantFor(mode, roots, surface)`（mode × scope × surface 矩阵） |
| `src/policy.ts` | `syntheticPolicy()` + `PolicyLike` |
| `src/argv.ts` | `widenArgv()`（Seatbelt/bwrap/Landlock；未知方言返回 `undefined`） |
| `src/wrap-fs.ts` | `wrapFs()` 透明 Proxy + 策略翻译 |
| `src/wrap-sandbox.ts` | `wrapSandbox()` 透明 Proxy + argv 追加 |
| `src/listener.ts` | `installListener()`（`internal/get` + 自检计数） |
| `src/context.ts` | `renderExtraPathsContext()`（system-prompt 段落文本，纯） |
| `src/schema.ts` | schemastery schema（settings 命名空间） |
| `src/preview.ts` | `buildPreview()`（纯）+ `registerPreviewRoute()`（webServer + connection 鉴权） |
| `src/index.ts` | 插件入口：装配 listener/settings/systemPrompt/预览 + 加载期自检 |
| `src/client/index.tsx` | 客户端半边：注册 `plugins.item` 页面 |
| `src/client/page.tsx` | 设置页组件（行编辑 + 保存 + 预览） |
| `src/client/preview.ts` | 预览 fetch 封装（失败降级） |
| `src/client/styles.ts` | 页面样式（内联样式常量：第三方 bundle 不引入 CSS 管线） |
| `tests/*.test.ts` | 单测（与 `src/*.ts` 一一对应） |

**文件拆分原则**：纯逻辑（config/paths/resolve/grant/policy/argv/context）与适配层（两个 wrap、listener、preview 路由、客户端）分开——前者可在没有 cordis、没有 DSH 的情况下单测，后者用桩件测。

---

## Task 1: 脚手架与工具链

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.client.json`, `vitest.config.ts`, `tsdown.config.ts`, `scripts/dsh-paths.mjs`, `src/smoke.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: 写 `scripts/dsh-paths.mjs`（生成 peer 类型解析表）**

```js
#!/usr/bin/env node
/**
 * Generate tsconfig.peers.json: map @deepseek-ai/* to the INSTALLED dsh app's
 * own node_modules so tsc can resolve peer types without installing them.
 * The profile runs with autoInstallPeers:false, so these packages exist only
 * inside the app installation.
 */
import { execFileSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
const appDir = dirname(dirname(realpathSync(bin)))          // <app>/lib/bin.js -> <app>
const modules = join(appDir, 'node_modules')
const out = {
  compilerOptions: {
    baseUrl: '.',
    paths: { '@deepseek-ai/*': [`${modules}/@deepseek-ai/*`] },
  },
}
writeFileSync(new URL('../tsconfig.peers.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
console.log(`tsconfig.peers.json -> ${modules}`)
```

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "dsh-extra-paths",
  "version": "0.1.0",
  "description": "DSH plugin: configured extra writable roots for the fs tools and the sandboxed shell, with a Web settings page",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots"
      ],
      "external": []
    }
  },
  "scripts": {
    "paths": "node scripts/dsh-paths.mjs",
    "prepare": "node scripts/dsh-paths.mjs",
    "build": "pnpm run build:host && pnpm run build:client",
    "build:host": "tsc -p tsconfig.json",
    "build:client": "tsdown",
    "watch:client": "tsdown --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "@types/react": "~18.3.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tsdown": "^0.14.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: 写三个 tsconfig 与 vitest 配置**

`tsconfig.json`（Host）：

```json
{
  "extends": "./tsconfig.peers.json",
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "lib",
    "rootDir": "src",
    "declaration": true,
    "declarationDir": "lib/types",
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/client/**", "src/smoke.ts"]
}
```

`tsconfig.client.json`：

```json
{
  "extends": "./tsconfig.peers.json",
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": [],
    "noEmit": true
  },
  "include": ["src/client/**/*.ts", "src/client/**/*.tsx"]
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: 写 `tsdown.config.ts`（客户端 bundle 外壳，逐字复刻官方预设的 banner/footer/intro）**

```ts
import { defineConfig } from 'tsdown'

/**
 * The client artifact contract: a CJS closure-factory bundle that registers into
 * the page's module table. The banner/footer/intro are copied verbatim from the
 * framework preset (packages/client/tsdown.client.ts) because a third-party
 * package cannot import that workspace-internal module.
 *
 * Externals: react/react-dom/react-jsx-runtime and @deepseek-ai/dsh-client-ui-slots
 * are in the page's baseline module table (packages/client/web/src/platform.ts);
 * @deepseek-ai/dsh-client-ui-settings is NOT, so it is requested through
 * dsh.client.external in package.json.
 *
 * No CSS pipeline: the page carries inline styles (src/client/styles.ts), so
 * this config needs none of the framework preset's CSS virtual modules.
 */
export default defineConfig({
  name: 'dsh-extra-paths/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: false,
  clean: false,
  // `deps.neverBundle` did NOT externalise React here (the bundle inlined a
  // second React copy, which would break hooks and context inside the shell's
  // tree). Rolldown's top-level `external` states the same intent directly and
  // is what the artifact check in the plan verifies.
  external: [
    /^react$/,
    /^react\//,
    /^react-dom$/,
    /^react-dom\//,
    /^@deepseek-ai\//,
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-extra-paths", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
```

- [ ] **Step 5: 装依赖并生成 peer 类型表**

Run:
```bash
cd $REPO
pnpm config set store-dir $REPO/.pnpm-store --location project
pnpm install
pnpm run paths
```
Expected: `pnpm install` 成功（`node_modules/` 生成，`@deepseek-ai/schemastery` 装好）；`tsconfig.peers.json -> <DSH 安装目录>/node_modules`。

> 若 `pnpm install` 报沙箱写入拒绝（store 在 HOME 下等），把 store 指到包内（上面第一条命令就是干这个）；仍失败则请求一次审批重试同一条命令。

- [ ] **Step 6: 写冒烟测试并跑通工具链**

`src/smoke.ts`：

```ts
export function smoke(): string {
  return 'ok'
}
```

`tests/smoke.test.ts`：

```ts
import { expect, it } from 'vitest'
import { smoke } from '../src/smoke.js'

it('toolchain runs', () => {
  expect(smoke()).toBe('ok')
})
```

Run: `pnpm test`
Expected: 1 passed。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "chore: scaffold dsh-extra-paths (toolchain, peer type paths, client bundle contract)"
```

### 实现记录（Task 9 预检回填：一条会在每次启动误报的自检）

用**真 cordis** 做集成预检（provide 一个 `sandboxPolicy` 与一个 `ctx.fs`，再 `ctx.plugin(plugin, {paths:[…]})`、由消费者读 `ctx.fs` 写两个目标）发现：`reads === 0` 那条自检**正确**（真机上 `ctx.sandboxPolicy` 的读确实经过 `internal/get`，没有误报），但第二条"两个 wrap 计数都为 0"的自检**必然误报**——`apply()` 时刻还没有任何消费者读过 `ctx.fs`，计数天然是 0，而实际放行是生效的（配置根被正确盖上、无关目标原样透传）。已删除该分支，计数保留在 `ListenerState` 上作为事后可观测性。

### 0.2.1-alpha.1 线（版本号规则定稿）

**版本号规则（定稿）**：插件用**独立的语义版本**，兼容性完全交给 `engines.dsh` 与 peer（机器可校验、安装闸门强制）。规则：**minor = 支持新的宿主线或不兼容调整；patch = 修 bug/文档/元数据**；另在 README 维护「插件版本 → 支持的 DSH 线」矩阵。这与生态一致（`dsh-better-sidebar` 0.19.x 面向 0.1.5 线、`dsh-git-worktree` 0.4.x 面向 0.1.2 线，宿主要求都写在 peer 里）。首个版本定名 `0.1.0`，一次覆盖三条线。

**已否决：让版本号跟随 DSH 官方**（"前三段跟随官方，第四段递增"，例如 0.2.1-alpha.1 → `0.2.1.1`）。实测四段版本非法：`semver.valid('0.2.1.1')` 为 null，`pnpm` 报 `ERR_PNPM_BAD_PACKAGE_JSON: Invalid version`；退到 prerelease 位 `0.2.1-1` 虽可安装，但它排在官方 `0.2.1` **之前**，且插件同时支持三条宿主线，单一宿主号只能表达最新那条 —— 补一条旧线还会让版本倒退，插件自身的修 bug/文档改动也无处安放。



用户问"支持 0.2.1-alpha1 吗"时，答案原本是"范围没写、也没实测"。验证方式与上一次同源：把 0.2.1-alpha.1 从 registry 下到 `/tmp/dsh021`，先**逐文件 diff** 契约代码 —— `dsh-sandbox-local`、`dsh-fs-sandbox`、`dsh-settings`、`dsh-system-prompt`、`dsh-host-webserver`、`dsh-client-connection` 的 `lib/index.js` 与 0.2.0-rc.2 **逐字相同**；cordis 由 4.0.4 升到 4.0.5-alpha.1（相关四个源文件逐字相同，`internal/get` 仍在）；客户端只有 `dsh-client-modules` 的 HMR 样式归属记账与 `ui-plugin-manager` 的新增 UI/注释（`plugins.item` 出现次数一致）。契约层面即已等价。

随后走同一套 scratch headless 探针：**先**用旧范围安装 —— 闸门按预期**拒绝**（"incompatible with dsh 0.2.1-alpha.1"），探针因插件未加载而被拒，正好构成对照；**再**把范围放宽为 `>=0.1.5-0 <0.1.6-0 || >=0.2.0-0 <0.2.2-0`（两条 0.2 线合并写，`-0` 继续挡住下一条线的预发布版）并重装 —— 安装放行、真实 agent 往工作区之外写入成功，闭环。

范围矩阵（`includePrerelease: true`，与闸门一致）：放行 0.1.5-rc.1/rc.3/0.1.5、0.2.0-0/rc.1/rc.2/0.2.0、0.2.1-0/alpha.1/alpha.9/0.2.1；挡住 0.1.6-alpha.2、0.2.2-alpha.1、0.3.0。

### 移植：兼容 DSH 0.2.0-rc.1 / rc.2 线

用户的实际 GUI 跑的是 **0.2.0-rc.2**（`$DSH_HOME/dsh-runtimes/<runtime>/runtime.json` 写着 `desktopVersion`），而插件当时只声明 0.1.5 线：0.2.x 的 `dsh plugin add` 直接以"peerDependencies 不兼容"**拒绝安装**，已装好的那份也因 `ctx.settings.register` 不复存在而失效（现象：额外可写根消失、设置页不见）。

**方法**：本地只装了 0.1.5，所以把 0.2.0-rc.1/rc.2 从 registry 下到 `/tmp/dsh020/{rc1,rc2}` 逐包读实现；用户随后指出本地有 DSH 源码检出（`$PARENT/deepseek-harness`，0.2.1-alpha.1），于是"**源码理解 + tarball 定版**"并用两个子代理分别产出宿主/客户端契约清单，关键结论再自己复核。契约清单的核心发现：

- **未变**：`internal/get` 瀑布（cordis 4.0.2→4.0.4 那段代码逐字一致；但只有 `fiber.runtime` 存在时才走，裸 `Context` 测不出来——我第一版实证因此误判）、`sandboxPolicy` 形状、argv 三种方言与 `--`、fs 的 `writeText/editText(…, policy)`、`systemPrompt.context/getContextOrder`、`webServer.register` 与 `connection.requestRejection`、客户端 bundle 格式。
- **变了**：`confine` 变 `async`（新增 `AbortSignal`）；`ctx.settings.register` 与 `ctx.settingsScope` **被删除**；插件卡片 slot 改名 `plugins.item`（0.1.6 起），`settings.plugin.item` 消失；settings 的**表单只描述 `volatile()` 字段**（没有 volatile 就完全没有描述符）；0.2.x 里**插件的 settings 就是它在 profile 里的条目 config**。

**实现**：宿主侧导出 `Config`（volatile 字段，运行时特性探测 `volatile` 是否存在，旧 schemastery 下不抛、只是不生成表单）+ `readLiveConfig()` 按决策实时重读 volatile 字段（0.1.5 走原来的 `register` scope）；客户端把 `PageScope` 改成**迟绑定代理**，`inject` 只声明 `slots`，再分别用 `ctx.inject(['settingsScope'])`／`(['configForms'])` 接上哪一代存在的那一个（0.2.x 的 `ConfigFormController` 与页面接口同形，因此页面本身零改动）。`inject` 里**不能**列只在 0.1.5 存在的服务——那会让插件在 0.2.x 永久等待激活。

**验证**：两个独立 scratch 环境（`DSH_HOME=/tmp/dsh-home-{015,020}` + headless profile + `link:` 安装本插件），各自写配置（0.1.5 写 `settings.yaml`，0.2.x 写 profile patch 的 `config:`），再用 `dsh --profile headless "<任务>"` 让真实 agent 往**工作区之外**写文件：默认策略是 `workspace-write` + `ask`，headless 没有审批应答者 ⇒ 未授权写必然失败，因此"文件出现"就是"插件放行"的硬证据。

### 新增能力：根模式（按目录结构锚定，`*` / `**` / 结尾 `..`）

用户诉求：会话工作区在 `<repo>/.worktrees/dev_x`，希望"**限定存在 `.worktrees` 的上级目录可读写**"，而不是写死某条路径；即让授权锚定到**结构**（某目录下存在 `.worktrees`），并支持任意深度匹配。原设计只有字面量路径，故新增 `src/pattern.ts`：

- 语法：`*` 恰好一层、`**` 最多 `PATTERN_LIMITS.maxDepth`（3）层，结尾 `..` 在**命中之后**上移（`…/.worktrees/..` = 含 `.worktrees` 的目录 = 仓库根）
- 只匹配**真实存在的目录** → "必须存在 `.worktrees`"天然成立；每个命中都是普通具体根，下游（fs 盖章 / argv 追加 / 预览）零改动
- 锚点硬约束：`*` 之前的字面量前缀必须存在、至少两层、且是绝对路径或 `~/` 开头；锚点不得等于或包含家目录 —— `/**`、`~/**`、`/srv/**` 一律不可遍历（`parsePattern` 负责语义、`validateConfig` 负责保存期语法，两处都拦）
- **fail-closed 只用于"失控"**：目录数 > 4096 或命中 > 256 → 整个模式不生效并告警；而**深度上限是语义**（`**` 的定义就是"最多 3 层"），命中照样生效，只附一条"更深请显式写层"的提示。这条是实测逼出来的：最初把深度也当 fail-closed，结果 `<工作根>/<某分组>/**/.worktrees/..` 明明已找到仓库根却整条被丢弃
- 展开缓存 30 秒（`PATTERN_CACHE_MS`）：实测 `<工作根>/**` 首次 235ms、`<工作根>/<某分组>/**` 61ms，缓存后 0ms；代价是新建 worktree 最迟 30 秒生效

**测试抓到的两个真 bug**（都发生在实现过程中，不是猜的）：① 锚点拼写从"过滤后的段"重建会丢掉开头的 `/`，于是 `/a/b/**` 被当成相对路径解析到工作区下面、`/**` 也被误接受；② `**` 的深度上限差一层（在恰好达到上限时连"零层匹配"也拒了）。两条都已修并钉住测试。

**实测（本机真实目录）**：`<工作根>/<某分组>/**/.worktrees/..` → 命中 `<工作根>/<某仓库>`；`<工作根>/<某分组>/**/.worktrees/*` → 6 个 worktree；`<工作根>/<某仓库>/.worktrees/*` → 0ms 命中 6 个（写死层数的写法无遍历开销，最推荐）。

### 实现记录（首次 GUI 使用反馈后的两处改造：UI 版式 + 双预览）

用户看到页面后提了两点：**UI 需要优化**；**"上一层路径 / 相对路径不好配"**。第二点的根因不是语法（`..`、`../x`、`~`、绝对路径一直都能配），而是**预览只描述已保存的文档**——边输边看时还是旧结果，等于必须"先保存再验证"。已做：

1. **客户端词法解析**（新增 `src/client/paths.ts` + `tests/client-paths.test.ts`）：`collapse` / `resolveLexically` 在浏览器里复刻宿主 `expandPath` 的语义（相对按会话工作区、`~` 按家目录、`~user` 保持字面量），每行**实时**显示"解析为 /绝对路径"。浏览器无法 realpath，故明确标注为词法结果，权威答案仍由宿主预览给出。
2. **宿主预览支持未保存的行**：`GET /extra-paths/resolved?cwd=…&paths=<JSON>`，`parseStagedPaths` 校验（非 JSON / 非数组 / 超 64 条 / 超 8KB → 400），随后仍走 `normalizeConfig` + `resolveRoots` 这同一条真相源；响应新增 `home`（供客户端解析 `~`）。于是"改成什么样"和"会不会生效"在**保存前**就能看到。
3. **UI 版式**：中文化（`随会话模式`/`始终可写`、`写工具`/`终端`、`删除`/`保存`/`放弃修改`）、每行卡片化、作用面改成可点胶囊、预览区状态色（生效 / 目录不存在 / 已拒绝）与告警分块、「添加工作区上一层（..）」快捷按钮，基准工作区做成**可选可输**（下拉候选 + 允许手填，修掉原先默认选中"别的会话工作区"的怪异）。

字段语义与执法逻辑**一律未改**（只动展示与预览）。客户端重建 + 刷新页面即可看到；宿主的 `paths` 参数与 `home` 字段需要重启一次 `dsh web`。

### 实现记录（严重回归：sandbox 包装器把同步 API 变成了异步，导致全进程 bash 失效）

**现象**：插件上线后，**所有会话**的 `bash` 工具都报 `Cannot read properties of undefined (reading '0')`（本会话自己也从此无法执行任何命令）。

**根因**：`src/wrap-sandbox.ts` 把 `confine` 写成了 `async`。而你运行版本里的提供者是**同步**的：

```js
// dsh-sandbox-local/lib/index.js:298 —— 同步返回，没有 await
confine(argv, policy) { return { argv: [...selected.argv, '--', ...argv], enforcement, denialSignatures, runnerFailureRules } }
// dsh-terminal-bash/lib/index.js:906 —— 调用方直接取 .argv，不 await
return sandbox.confine(argv, { ...policy, mode: policy.mode }).argv;
// dsh-bash-sandbox/lib/index.js:154 —— 同样同步取用
const confined = this.confine(spec.command, { ... });  ... confined.argv[0]
```

异步包装器返回 Promise → `.argv` 是 `undefined` → 调用方 `argv[0]` 抛错。**透明包装器改变了被包装方法的同步性**，这是设计错误，不是版本差异的偶然。

**为什么测试没抓到**：我的测试替身写成了 `async`（`confine: vi.fn(async () => ...)`），**把错误假设固化进了测试**——它验证的是"我以为的契约"，而不是"已安装实现的契约"。（对照：fs 侧我恰好猜对了——`dsh-fs-sandbox` 的 `async writeText(target, content, expected, signal, sandboxPolicy)` 与调用方的 `await ctx.fs.writeText(...)` 都是异步，所以 fs 包装器一字未改。）

**修复**：`widen()` 提成同步函数，`confine` 改为**镜像内层**形态——内层同步就同步返回，内层给 thenable 才用 `.then` 续延（`isThenable`）；`SandboxInnerLike.confine` 的返回类型如实写成联合类型。测试替身改为同步，并新增两条钉子：① 调用结果**不是 Promise** 且 `.argv` 可同步读取（本次回归的钉子）；② 内层返回 thenable 时仍能工作（向前兼容）。其余用例里的 `await` 保留（`await` 一个同步值是无害的）。

**教训**：包装外部实现前，必须从**已安装的那份实现**（`lib/*.js` 里的函数签名、是否 `async`、调用方怎么写）反推契约；测试替身也要照着它写，否则替身只会替我把错误锁死。

### 实现记录（首次 GUI 验收发现的版本漂移：slot key 写的是 0.1.6 的名字）

重启后宿主半边**确认生效**（会话运行时上下文已带上插件注入的 "Additional configured writable roots for this session: … $KB …"），但设置页里看不到配置页。根因是**我按源码仓库（0.1.6-alpha.2）的 slot 名写的，而你运行的是 0.1.5-rc.1**：

| | 0.1.6 源码仓库 | 运行中的 0.1.5-rc.1 |
|---|---|---|
| 侧栏 Plugins 页卡片 | `plugins.item`（`id`/`order`/`label`） | **不存在这个名字** |
| 设置→插件 的卡片 | 同上 | `settings.plugin.item`，`key` = **设置命名空间**，配 `locale` + `inject` |
| 设置左栏分区 | `settings.section`（`id`/`order`/`label`） | 同名，但还要 `locale` + `inject` |

我原先注册进 `plugins.item`——**没有任何挂载的 entry 声明这个名字，所以 `slots.inject` 的回调永远不执行：没有报错、也没有页面**（这正是"看不到"的原因）。证据来源不是猜的：同一 profile 里另一个能用的第三方 bundle，以及官方 `dsh-client-ui-settings-plugins/lib/client.js` 里的注册形状，加上它随包发布的 `slot-contract.d.ts`（`'settings.plugin.item': { kind:'keyed', scope:'root' }`，注释明确写着"插件以自己的设置命名空间为键注册，就能让本仓库之外分发的插件贡献卡片"）。

修复：**同一份页面注册两次**——`settings.section`（`id:'extra-paths'`, `order:40` 排在官方「插件」的 15 之后，`label:'额外可写路径'`）满足"设置页左栏多一项"，`settings.plugin.item`（`key:'extra-paths'`）作为设置→插件里的卡片，与生态惯例一致。两条都用官方同款 `inject` thunk 提供 `{scope, workspaces}`。页面自身**一字未改**：核对过运行版本的 `SettingsScope` 契约（`getSnapshot`/`subscribe`/`set`/`unset`/`mutate`，快照含 `status/value/base/user/revision/writable/mode`）与页面用法完全一致。

**教训（已写进代码注释）**：客户端 slot 名与注册形状必须从**运行版本自己的**官方占用者与随包 `.d.ts` 反查，不能用更新 checkout 的名字——这类错误是静默的（不报错、不渲染）。

### 实现记录（Task 12/13 落地时回填：计划里的两处错误）

1. **`tsdown` 的 `deps.neverBundle` 没有把 React 外部化**：首版产物 119 kB，内含 36 处 React 内部实现（第二份 React 会让页面 hooks 直接炸）。改为 rolldown 顶层的 `external`（`/^react$/`、`/^react\//`、`/^react-dom...`、`/^@deepseek-ai\//`）后产物 11 kB，只 `require("react")` 与 `require("react/jsx-runtime")`（两者都在页面基线模块表里），React 内部实现为 0。计划 Task 12 Step 3 的那条 `grep -c 'require("react")'` 检查是对的，它正好抓住了这个错误。
2. **客户端类型与运行时的两处不一致**：`@deepseek-ai/dsh-client-ui-slots` 的 type-only 导入在应用安装里解析不到（只有 `dsh-client-ui-settings` 可解析；`ui-slots`/`client-store` 是页面运行时提供的），已删除该导入（本文件的 `ClientContext` 本来就自己声明了所用面）；`WorkspaceListSurface` 改为从 `page.tsx` 导出并在 `index.tsx` 里用它 cast。
   同时**删掉 `dsh.client.external` 里的 `@deepseek-ai/dsh-client-ui-settings`**：客户端代码只做 type-only 导入，运行时不 `require` 它；声明一个用不到的模块表请求只会给启动图增加风险（`dsh.client.inject` 的到达边保留，它保证服务先到位）。

### 实现记录（Task 9/11 落地时回填：计划里的三处错误）

Task 9 的模块首次编译就暴露三处**计划块自身的错误**（都是我在写计划时的疏漏，落地时以编译器/测试为准修正，并已同步回上面各代码块）：

1. **计划顺序缺陷**：Task 9 的 `src/index.ts` 引用了 Task 11 的 `src/preview.ts`，所以预览模块必须与 Task 9 **同时**落地，否则编译不过。Task 11 因此只剩"路由接线 + curl 验收"。
2. **schemastery 用法**：异构 `z.union([z.string(), z.object({...})])` 无法推断（报 TS2353，把对象字面量按字符串类型检查），且未注解的 schema 触发 TS2742（推断类型引用了不可移植的 cosmokit 路径）。改为**每个 schema 显式注解**（`z<Scope>`/`z<Surface>`/`z<ExtraPathsSectionEntry>`/`z<ExtraPathsSection>`），并把条目对象提成具名 `entrySchema` 再放进 union——与核心包自己的写法一致。
3. **两处测试与代码不符**：`tests/context.test.ts` 断言 `'regardless of the standing mode'` 而文案是 `'... standing sandbox mode'`（子串不含）；`tests/preview.test.ts` 第 4 次踩同一个 darwin fixture 坑（`tmpdir()` → `/var` vs canonical `/private/var`）。

### M1 收口（终审由主会话以可执行证据完成）

`subagent` 通道两次中断后，M1 的终审改为**可执行证据**而不是再要一份意见，三项都做了：

1. **字节比对**（计划块 vs 磁盘，逐文件）：发现三处真实漂移，全部是我自己后续改计划造成的——`tests/argv.test.ts` **少了三条测试**（多根追加、`wrappedLength` 退化的两种情形；Task 8 恰好要传多根，这个缺口是真的）、`src/config.ts` 少两行注释、`src/resolve.ts` 的写法与计划不一致。已用计划块覆盖回这三个文件，现在 8 个模块 + 8 个测试文件**全部逐字节一致**。
2. **对抗性反证**（15 例，已提升为常驻套件 `tests/enforcement-boundaries.test.ts`）：前缀同名字兄弟目录、根内指向根外的符号链接、`..` 穿越、模式门槛双向、`widenArgv` 不可能凭空造根（未知方言返回 `undefined`）、配置**撤回即时生效**、调用方 policy 对象不被改写且不跨调用继承、报告不别名配置、内部异常原样抛出（不变成授权）、读无关成员不触碰文件系统——**全部未被攻破**。
3. **可证伪性**：本轮之前的变异探针已逐条确认关键守卫"删掉就会红"（danger 快速路径、`signal` 转发、`syntheticPolicy` 的 `...policy`、按 `displayPath` 匹配、绑定缓存、fail-closed 告警点名 runner）。

**M1 结论：核心可以接入实时插件（Task 9）**。已知残余仅两条且已论证无害（见下）。

### M1 收尾：两个已知且接受的残余（不再补测）

1. `isConfiningFs(wrapped)` 未被断言——但监听器只对**未包装**的原服务调用 `isConfiningFs`，包装器本身不会再被判定，故不影响。
2. `wrapSandbox` 未用 spy 断言 `readConfig` 每次调用求值；该性质与 `wrapFs` 同形（都在 `confine` 内部调用 `deps.readConfig()`），已由 fs 侧钉住，这里接受为残余。

### 实现记录（Task 7/8 最后一轮探针回填）

镜像断言时暴露了一个实现事实：**两个包装器原先在 `get` 陷阱里每次读取都新建拦截闭包**，所以方法身份不稳定（`wrapped.confine === wrapped.confine` 为假）。正确处理不是删断言，而是把 `writeText`/`editText`/`confine` 三个拦截函数**提到 Proxy 之外构造一次**（它们不捕获任何读取期状态，policy 在调用内解析），于是身份稳定、每次读取也不再分配。三条身份断言（`resolve`/`writeText`/`editText`）与 `confine` 一起钉住这一点。

### 实现记录（Task 7/8 审查后回填）

探针发现两个守卫**互相掩护**：`grantFor('danger-full-access', …)` 本身返回 `[]`，所以"不解析目标"的断言是被它满足的，删掉 `wrapFs` 的快速路径不会变红。真正可观察的差别是 `resolveRoots(config, …)` 是否被求值——已把断言改为 `readConfig` 未被调用（探针验证：干净代码通过、删掉快速路径变红）。同时把"绑定方法身份稳定"的断言镜像到 `wrapSandbox`。

### 实现记录（Task 7/8 审查后回填）

变异探针证明上一轮补的测试多数有牙（删 `grantFor` 的 danger 守卫、删 `signal` 转发、删 `syntheticPolicy` 的 `...policy`、把规范化目标改成按 `displayPath` 匹配，都会让对应用例变红），但暴露了四处"删掉也不红"。已再补四条把可观察性补齐：`wrapFs` 的 danger 快速路径**不得触碰文件系统**（`inner.resolve` 未被调用）、`editText` 的 `expected`/`signal` 转发、绑定方法的**身份稳定**（缓存生效）、fail-closed 告警**必须点名 runner**。

### 实现记录（Task 7/8 执行后回填）

两个包装器按计划实现（生产代码逐字节一致），并按"未钉住风险清单"补了测试：`editText` 分支、`danger-full-access` 短路、**调用方 policy 对象不被改写**、`fallbackPolicy` 与 `readConfig` **每次调用**都重新求值（去掉一个根必须立刻停止授权）、以及**runner 元数据（`enforcement`/`denialSignatures`/`runnerFailureRules`）逐字段保留**——丢掉它们会让消费者把"被沙箱拒绝"读成"命令自己失败"。另外删掉了 `FsWrapDeps.warn`（`wrap-fs` 从不告警，是死参数），Task 9 的调用点同步。

两个测试块的 fixture 也各自踩了同一个 darwin 坑（第三次），同样先 `realpathSync.native(mkdtempSync(...))`。

**给 Task 9 的硬性义务**（其中三条已写进 Task 9 代码）：① `readConfig`/`fallbackPolicy` 必须是**每次调用**求值的闭包，不得在挂载时求值或缓存；② 监听器必须永远调用 `next()`、异常原样抛出、包装失败时退回未包装值（"不授权"永远优于"启动坏掉"）；③ 自检不只看 `reads`，还要看 `fsWraps`/`sandboxWraps`（服务没被包装和"写入被拒"在现象上无法区分）；④ `warn` 必须接到插件 logger，否则 fail-closed 的那条告警是静默的。

### 实现记录（Task 5/6 执行后回填）

计划里的 Task 4 **代码块与测试块再次自相矛盾**：surface 顺序只在合并分支用 `SURFACES.filter` 归一，而单条目分支仍是 `[...entry.surfaces]`，可测试却要求单条目也按 `SURFACES` 顺序——按测试（更严的一方）在单条目分支补上归一。另按 Task 7/8 的消费方式补了三条测试：`widenArgv` 多根按序追加、`wrappedLength` 退化（0 / 越界）时的行为、以及"嵌套子根不能收窄父根"（`granted.find` 的**首个匹配即最宽祖先**语义）。

**给 Task 7/8 的消费提示（已在测试中钉住或明确依赖）**：Task 7 用 `granted.find(isUnder(target, root))`，因此同一目标可能同时落在父根与子根下，胜出的是**配置顺序里第一个匹配的根**（即更宽的祖先）；Task 8 的 Seatbelt 分支要求 `head[1] === '-p'` 且 `head[2]` 以 `(version 1)` 开头，不匹配就返回 `undefined` 并由调用方告警（fail closed，不是静默）。SBPL 的"后匹配覆盖先匹配"与基类 profile 自身的写法一致（基类同样是 `deny file-write*` 之后追加多条 `allow file-write*`），最终由 M2 的真机验收确认。

### 实现记录（Task 4 审查后回填）

质量审查又发现 `EntryResolution.surfaces` **直接引用了调用方的配置数组**（改报告会改到后续授权，跨次泄漏），以及三处需要在文档里说清的语义与两处过度告警/顺序不稳。已全部并入上面的代码块：报告持有副本、`$HOME` 改为惰性探测（空配置不再做无谓 stat）、surfaces 按 `SURFACES` 顺序稳定输出、新增"根包含本会话工作区"的告警、并在 `ResolveReport` 上写明三条消费者契约（每次决策重新解析、不得缓存；授权是并集且宽祖先获胜；非目录根仍记 `ok`）。测试相应加了 7 条（别名、顺序、嵌套、工作区告警、良性根不告警、失效告警含拼写与解析路径、空拼写=进程工作目录）。

### 实现记录（Task 4 执行后回填）

- Task 4 的测试 fixture 有与 Task 3 相同的 darwin 缺陷（`tmpdir()` → `/var/...` vs canonical `/private/var/...`），已同样改为先 `realpathSync.native(mkdtempSync(...))`。
- 按审查发现的测试缺口补了 8 条性质测试（Task 5–8 直接依赖它们）：单一 surface **不被放宽**、条目级 `resolved/scope/surfaces` 断言、合并根的 `raw` 出处、重复失效条目**只告警一次**、符号链接拼写合并成同一根、失效条目在**任何** surface 上都不贡献、空配置返回空报告、**跨次调用不泄漏**（防止将来加缓存导致跨会话串根）。

### 实现记录（Task 3 执行后回填：计划里的一个真 bug + 一个必红 fixture）

1. **`isUnder` 的包含判定有假阴性**（提交 `9ee2d3a` 级别的修复）：`rel.startsWith('..')` 会把名字以 `..` 开头的**合法子目录**（`/a/..cache/x`）判成越界，导致用户配置根下的正常写入被拒。已改为只拒绝 `..` 段本身与 `../` 前缀，并补三条测试（`/a/..cache/x.md`、`/a/..foo`、`/a/...` 为真；`/a/..b/c` 为假）。
2. **Task 3 测试块自相矛盾**：计划里同时写了"名字以 `..` 开头的子目录是合法子路径"和 `isUnder('/a/..b/c','/a') === false`——`..b` 正是一个 `..` 开头的子目录名，两者不可能同时成立。已把后者改为真正的向上穿越 `/a/../b/c`（实现代码不受影响，只有这一行测试是错的）。
3. **Task 3 的两条 `canonicalizeRoot` 测试在 macOS 上必红**：`mkdtempSync(join(tmpdir(), …))` 给的是 `/var/...`，而 `realpathSync.native` 给的是 `/private/var/...`（`/var` 是符号链接）。实现是对的、**期望是错的**。fixture 改为先 `realpathSync.native(mkdtempSync(...))`（Linux 上是 no-op），断言一字未动。

### 实现记录（Task 2 执行后回填：计划里的两处代码缺陷）

Task 2 的实现者按规格做完后发现并**拒绝**了两个静默失效点（正确处理：报告而不是自行偏离），随后按规格修复并补了钉住它们的测试：

1. `readScope` 漏了插件级 `defaultScope` 的透传——`defaultScope: always-write` 对条目无效（与设计文档 §4.2「插件级默认 + 逐路径覆盖」矛盾）。已改为 `readScope(value, fallback, label)`，两个调用点同步。
2. `readSurfaces` 在条目未声明时直接返回 `fallback` 的**同一个数组实例**（后续任务若排序/追加会污染全局默认）。已改为返回副本。

新增三条测试：`defaultScope` 透传、`surfaces` 不是同一实例、`normalizeConfig(undefined)` 等于文档化的空配置。

随后按代码质量审查又做了一轮收尾（提交 `b4386b3`）：报错带上 `paths[i]:` 定位与收到的值、去重键同时剥两种分隔符、`isFilesystemRoot` 的文档与措辞说明"裸盘符（`C:`）也算"、空 `defaultSurfaces` 的成因提示、以及"文件系统根优先于重复"的报错顺序。**本节代码块是唯一的权威版本**；历史提交信息可能与计划文字不同（这是记录，不是规范）。

### 实现记录（Task 1 执行后回填，两处对计划的偏离）

1. **多了一个必需文件 `pnpm-workspace.yaml`**（不在原计划文件清单里）：pnpm 11.22 把 `pnpm config set store-dir … --location project` 写进这个文件，并且要求对 esbuild 的构建脚本表态——缺 `allowBuilds: { esbuild: true }` 时**每条 pnpm 命令都退出 1**（`pnpm run <script>` 会先跑一次 install，所以连 `pnpm run paths` 都执行不到）。同时 `storeDir` 已改为**相对路径 `.pnpm-store`**（验证过落在项目内），避免提交机器相关的绝对路径。
2. **脚本接线改为"安装宽松、构建严格"**：`prepare` 用 `node scripts/dsh-paths.mjs --tolerant`（没有全局 `dsh` 时打印一行明确的补救提示并退出 0，保证 clone 后 `pnpm install` 不会因缺 `dsh` 而失败）；`build:host` 与 `typecheck` 前置 `node scripts/dsh-paths.mjs`（严格模式，缺 `dsh` 时带提示退出 1）。脚本支持 `DSH_APP_DIR` 覆盖应用目录。

`pnpm run typecheck` 在 Task 2 之前会报 `TS18003: No inputs were found`（`src/` 下只有被 exclude 的 `src/smoke.ts`），Task 2 之后消失；`tsconfig.client.json` 的那份要到 Task 12 才消失。这是计划自身的过渡状态，不是故障。

---

## Task 2: `src/config.ts` — 配置类型、规范化、校验

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: 删掉 Task 1 的冒烟脚手架**

```bash
git rm -q src/smoke.ts tests/smoke.test.ts
```

Expected: 两个文件移出版本库（真实测试从本任务开始，同时让 `pnpm run typecheck` 摆脱 `TS18003: No inputs`）。

- [ ] **Step 2: 写失败测试 `tests/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { isFilesystemRoot, normalizeConfig, validateConfig } from '../src/config.js'

describe('normalizeConfig', () => {
  it('applies the plugin-level defaults', () => {
    const config = normalizeConfig({ paths: ['~/notes'] })
    expect(config.paths).toEqual([{ path: '~/notes', scope: 'write', surfaces: ['fs', 'shell'] }])
    expect(config.defaultScope).toBe('write')
  })

  it('lets one entry override scope and surfaces', () => {
    const config = normalizeConfig({
      defaultSurfaces: ['fs'],
      paths: [{ path: '/tmp/x', scope: 'always-write', surfaces: ['shell'] }],
    })
    expect(config.paths[0]).toEqual({ path: '/tmp/x', scope: 'always-write', surfaces: ['shell'] })
  })

  it('lets the plugin-level defaultScope reach an entry that omits its own', () => {
    const config = normalizeConfig({ defaultScope: 'always-write', paths: ['/x'] })
    expect(config.paths[0]?.scope).toBe('always-write')
  })

  it('does not hand an entry the shared defaultSurfaces array instance', () => {
    const config = normalizeConfig({ paths: ['/x'] })
    expect(config.paths[0]?.surfaces).not.toBe(config.defaultSurfaces)
    expect(config.paths[0]?.surfaces).toEqual(config.defaultSurfaces)
  })

  it('normalises undefined into the documented empty configuration', () => {
    expect(normalizeConfig(undefined)).toEqual({
      defaultScope: 'write',
      defaultSurfaces: ['fs', 'shell'],
      paths: [],
    })
  })

  it('trims paths and deduplicates surfaces', () => {
    const config = normalizeConfig({ paths: [{ path: '  /a  ', surfaces: ['fs', 'fs', 'shell'] }] })
    expect(config.paths[0]?.path).toBe('/a')
    expect(config.paths[0]?.surfaces).toEqual(['fs', 'shell'])
  })

  it.each([
    [{ paths: [''] }, 'path must be a non-empty string'],
    [{ paths: [{}] }, 'path must be a non-empty string'],
    [{ paths: ['/a'], defaultScope: 'rw' }, 'scope must be one of'],
    [{ paths: [{ path: '/a', surfaces: ['net'] }] }, 'unknown surface'],
    [{ paths: [{ path: '/a', surfaces: [] }] }, 'at least one surface'],
    [{ paths: [{ path: '/a', surfaces: 'fs' }] }, 'surfaces must be an array'],
    [{ defaultSurfaces: ['net'] }, 'defaultSurfaces: unknown surface'],
    [{ paths: [{ path: '/a' }], defaultSurfaces: [] }, 'at least one surface'],
    [{ paths: '/a' }, 'paths: expected an array'],
  ])('rejects %j', (raw, message) => {
    expect(() => normalizeConfig(raw as never)).toThrow(message)
  })

  it('names the offending row, not just the reason', () => {
    expect(() => normalizeConfig({ paths: ['/ok', ''] })).toThrow(/^paths\[1\]: .*non-empty/)
  })
})

describe('validateConfig', () => {
  it('accepts a normal section', () => {
    expect(() => validateConfig({ paths: ['~/notes'] })).not.toThrow()
  })

  it('rejects duplicate literal entries', () => {
    expect(() => validateConfig({ paths: ['/a', '/a'] })).toThrow('duplicate path entry')
  })

  it('rejects duplicates that differ only by surrounding whitespace or a trailing separator', () => {
    expect(() => validateConfig({ paths: ['/a', ' /a '] })).toThrow('duplicate path entry')
    expect(() => validateConfig({ paths: ['/a', '/a/'] })).toThrow('duplicate path entry')
    expect(() => validateConfig({ paths: ['C:\\a', 'C:\\a\\'] })).toThrow('duplicate path entry')
  })

  it('reports the filesystem root rather than the duplicate it also is', () => {
    expect(() => validateConfig({ paths: ['//', '/'] })).toThrow('filesystem root')
  })

  it('accepts an empty configuration (clearing the settings page must save)', () => {
    expect(() => validateConfig({ paths: [] })).not.toThrow()
    expect(() => validateConfig(undefined)).not.toThrow()
  })

  it('admits the spellings only canonicalisation can reject — Task 4 owns that rejection', () => {
    expect(isFilesystemRoot('//')).toBe(false)
    expect(() => validateConfig({ paths: ['//'] })).not.toThrow()
    expect(() => validateConfig({ paths: ['/a/..'] })).not.toThrow()
  })

  it('rejects the filesystem root', () => {
    expect(() => validateConfig({ paths: ['/'] })).toThrow('filesystem root')
  })
})

describe('isFilesystemRoot', () => {
  it.each(['/', 'C:\\', 'D:/', 'C:'])('accepts %s', path => expect(isFilesystemRoot(path)).toBe(true))
  it.each(['/tmp', '~', 'C:\\tmp'])('rejects %s', path => expect(isFilesystemRoot(path)).toBe(false))
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config.js"`。

- [ ] **Step 4: 实现 `src/config.ts`**

```ts
/**
 * The plugin's configuration vocabulary: a plugin-level default scope and
 * surface set, plus per-path entries that override them. Everything here is
 * pure so the settings schema, the CLI-facing validator, and the enforcement
 * layers share one normalisation.
 * @module dsh-extra-paths/config
 */

/** How far one configured root's write grant reaches across session modes. */
export type Scope = 'write' | 'always-write'

/** Which enforcement surface a configured root's grant applies to. */
export type Surface = 'fs' | 'shell'

/** All scopes, in escalation order. */
export const SCOPES: readonly Scope[] = ['write', 'always-write']

/** All surfaces. `fs` is the write/edit tool family; `shell` is the subprocess sandbox. */
export const SURFACES: readonly Surface[] = ['fs', 'shell']

/** One configured root after normalisation. */
export interface PathEntry {
  readonly path: string
  readonly scope: Scope
  readonly surfaces: readonly Surface[]
}

/** The normalised configuration the enforcement layers read. */
export interface ExtraPathsConfig {
  readonly defaultScope: Scope
  readonly defaultSurfaces: readonly Surface[]
  readonly paths: readonly PathEntry[]
}

/** Untrusted configuration as it arrives from the settings document or entry config. */
export interface RawConfig {
  readonly defaultScope?: unknown
  readonly defaultSurfaces?: unknown
  readonly paths?: unknown
}

const DEFAULT_SCOPE: Scope = 'write'
const DEFAULT_SURFACES: readonly Surface[] = [...SURFACES]

function readScope(value: unknown, fallback: Scope, label: string): Scope {
  if (value === undefined) return fallback
  if (typeof value === 'string' && (SCOPES as readonly string[]).includes(value)) return value as Scope
  throw new Error(`${label}: scope must be one of ${SCOPES.join(' | ')}, received ${JSON.stringify(value)}`)
}

function readSurfaces(value: unknown, fallback: readonly Surface[], label: string): readonly Surface[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value)) throw new Error(`${label}: surfaces must be an array, received ${JSON.stringify(value)}`)
  const surfaces: Surface[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(SURFACES as readonly string[]).includes(item)) {
      throw new Error(`${label}: unknown surface ${JSON.stringify(item)}; expected ${SURFACES.join(' | ')}`)
    }
    if (!surfaces.includes(item as Surface)) surfaces.push(item as Surface)
  }
  return surfaces
}

/**
 * Normalise untrusted configuration, applying defaults and rejecting anything
 * the enforcement layers could not act on.
 * @param raw - the settings section or entry config.
 * @returns the normalised configuration.
 * @throws {Error} on a malformed entry, unknown vocabulary, or empty surfaces.
 */
export function normalizeConfig(raw: RawConfig | undefined): ExtraPathsConfig {
  const defaultScope = readScope(raw?.defaultScope, DEFAULT_SCOPE, 'defaultScope')
  const defaultSurfaces = readSurfaces(raw?.defaultSurfaces, DEFAULT_SURFACES, 'defaultSurfaces')
  const list = raw?.paths
  if (list !== undefined && !Array.isArray(list)) {
    throw new Error(`paths: expected an array, received ${JSON.stringify(list)}`)
  }
  const paths = (list ?? []).map((item, index): PathEntry => {
    const label = `paths[${index}]`
    const entry = (typeof item === 'string' ? { path: item } : item ?? {}) as { path?: unknown; scope?: unknown; surfaces?: unknown }
    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      throw new Error(`${label}: path must be a non-empty string, received ${JSON.stringify(entry.path)}`)
    }
    const surfaces = readSurfaces(entry.surfaces, defaultSurfaces, label)
    if (surfaces.length === 0) {
      const cause = entry.surfaces === undefined && defaultSurfaces.length === 0 ? ' (defaultSurfaces is empty)' : ''
      throw new Error(`${label}: at least one surface is required${cause}`)
    }
    return { path: entry.path.trim(), scope: readScope(entry.scope, defaultScope, label), surfaces }
  })
  return { defaultScope, defaultSurfaces, paths }
}

/**
 * Whether a path names a filesystem root, which would disable the sandbox
 * outright. A bare drive (`C:`) is drive-RELATIVE rather than a root, but it is
 * rejected conservatively: on Windows it can still resolve to a whole volume,
 * and the message says so instead of mislabelling it.
 */
export function isFilesystemRoot(path: string): boolean {
  return path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)
}

/**
 * The settings service's `validate` hook: refuse a write the plugin could never
 * act on, so the user learns at save time instead of storing a dead section.
 * @param raw - the resolved section the write would store.
 * @throws {Error} on a duplicate literal entry or a filesystem root.
 */
export function validateConfig(raw: RawConfig | undefined): void {
  const config = normalizeConfig(raw)
  // Trailing separators are stripped for the duplicate key so `/a` and `/a/`
  // collide here rather than silently merging later; `/` keeps its meaning.
  const firstSeen = new Map<string, number>()
  config.paths.forEach((entry, index) => {
    // The root check runs FIRST: for ['//', '/'] the duplicate key would
    // otherwise report the less useful of two true reasons.
    if (isFilesystemRoot(entry.path)) {
      throw new Error(
        `paths[${index}]: ${JSON.stringify(entry.path)} names a filesystem root (or a bare drive) `
        + 'and would disable the sandbox',
      )
    }
    // Both separator kinds are stripped so the rule matches its own name on
    // either platform's spelling; a spelling that strips to empty is the root
    // itself (already rejected above).
    const key = entry.path.replace(/[\\/]+$/, '') || '/'
    const first = firstSeen.get(key)
    if (first !== undefined) {
      throw new Error(
        `paths[${index}]: duplicate path entry ${JSON.stringify(entry.path)} (first configured at paths[${first}])`,
      )
    }
    firstSeen.set(key, index)
  })
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS（全绿；具体条数以本节代码块为准）。

- [ ] **Step 6: 提交**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): normalise and validate the extra-paths configuration"
```

---

## Task 3: `src/paths.ts` — 路径展开、规范化、包含判定

**Files:**
- Create: `src/paths.ts`, `tests/paths.test.ts`

- [ ] **Step 1: 写失败测试 `tests/paths.test.ts`**

```ts
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalizeRoot, expandPath, isUnder } from '../src/paths.js'
describe('expandPath', () => {
  it('expands ~ and ~/ to the home directory', () => {
    expect(expandPath('~', '/ws', '/home/u')).toBe('/home/u')
    expect(expandPath('~/notes', '/ws', '/home/u')).toBe('/home/u/notes')
  })

  it('keeps absolute paths as written', () => {
    expect(expandPath('/abs/x', '/ws', '/home/u')).toBe('/abs/x')
  })

  it('resolves relative paths against the given workspace root', () => {
    expect(expandPath('../../notes/home', '/work/typescript/proj', '/home/u')).toBe('/work/notes/home')
  })

  it('treats an unsupported ~user spelling as a literal relative path', () => {
    expect(expandPath('~foo', '/ws', '/home/u')).toBe('/ws/~foo')
  })
})

describe('canonicalizeRoot', () => {
  it('resolves a symlinked ancestor', () => {
    // realpath the fixture: on darwin tmpdir() is /var/... while the canonical
    // spelling is /private/var/..., and canonicalizeRoot is SUPPOSED to return
    // the latter — the expectation, not the implementation, was wrong.
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const real = join(base, 'real')
    const link = join(base, 'link')
    mkdirSync(real)
    symlinkSync(real, link)
    expect(canonicalizeRoot(join(link, 'child'))).toBe(join(real, 'child'))
  })

  it('appends a not-yet-existing suffix verbatim', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    expect(canonicalizeRoot(join(base, 'nope', 'deeper'))).toBe(join(base, 'nope', 'deeper'))
  })

  it('resolves an empty spelling to the process working directory', () => {
    expect(isAbsolute(canonicalizeRoot(''))).toBe(true)
    expect(canonicalizeRoot('')).toBe(realpathSync.native(process.cwd()))
  })

  it('is idempotent', () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
    const once = canonicalizeRoot(join(base, 'nope'))
    expect(canonicalizeRoot(once)).toBe(once)
  })
})

describe('isUnder', () => {
  it('accepts the root itself and descendants', () => {
    expect(isUnder('/a/b', '/a/b')).toBe(true)
    expect(isUnder('/a/b/c.md', '/a/b')).toBe(true)
  })

  it('rejects siblings and parent-traversal spellings', () => {
    expect(isUnder('/a/bc', '/a/b')).toBe(false)
    expect(isUnder('/a', '/a/b')).toBe(false)
    expect(isUnder('/a/../b/c', '/a')).toBe(false)
  })

  it('accepts a child whose NAME starts with dots', () => {
    expect(isUnder('/a/..cache/x.md', '/a')).toBe(true)
    expect(isUnder('/a/..foo', '/a')).toBe(true)
    expect(isUnder('/a/...', '/a')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/paths.test.ts`
Expected: FAIL — cannot resolve `../src/paths.js`。

- [ ] **Step 3: 实现 `src/paths.ts`**

```ts
/**
 * Path arithmetic for configured roots. Every root is canonicalised the same
 * way the filesystem service canonicalises a write target — realpath of the
 * deepest EXISTING ancestor plus the remaining suffix — so a not-yet-created
 * directory still compares equal to the path the enforcement layer computes.
 * @module dsh-extra-paths/paths
 */

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'

/**
 * Resolve one configured path spelling to an absolute path.
 * @param raw - the configured spelling: absolute, `~`-anchored, or relative.
 * @param workspaceRoot - the session workspace a relative spelling is resolved against.
 * @param home - home directory seam (tests).
 * @returns the absolute path, not yet canonicalised.
 */
export function expandPath(raw: string, workspaceRoot: string, home: string = homedir()): string {
  if (raw === '~') return home
  if (raw.startsWith(`~${sep}`) || raw.startsWith('~/')) return join(home, raw.slice(2))
  if (isAbsolute(raw)) return raw
  return resolvePath(workspaceRoot, raw)
}

/**
 * Canonical spelling of a configured root. Symlinked ancestors are resolved
 * (so `/tmp` and `/private/tmp` cannot silently fail to match), while a suffix
 * that does not exist yet is appended verbatim.
 * @param path - an absolute path.
 * @returns the canonical spelling.
 */
export function canonicalizeRoot(path: string): string {
  const resolved = resolvePath(path)
  const suffix: string[] = []
  let probe = resolved
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return resolved
    suffix.unshift(basename(probe))
    probe = parent
  }
  let real: string
  try {
    real = realpathSync.native(probe)
  } catch {
    real = probe
  }
  return suffix.length === 0 ? real : join(real, ...suffix)
}

/**
 * Whether a canonical target is a root or lies beneath it. Both sides must
 * already be canonical; containment is then purely lexical, which is why the
 * caller canonicalises before comparing.
 * @param targetKey - canonical write target.
 * @param root - canonical configured root.
 * @returns true for the root itself and every descendant.
 */
export function isUnder(targetKey: string, root: string): boolean {
  if (targetKey === root) return true
  const rel = relative(root, targetKey)
  // `..foo` is a legitimate CHILD whose name starts with dots; only the `..`
  // segment itself and a `../` prefix escape the root.
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/paths.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat(paths): expand, canonicalise and contain configured roots"
```

---

## Task 4: `src/resolve.ts` — 唯一的真相源

**Files:**
- Create: `src/resolve.ts`, `tests/resolve.test.ts`

- [ ] **Step 1: 写失败测试 `tests/resolve.test.ts`**

```ts
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeConfig, type Surface } from '../src/config.js'
import { resolveRoots } from '../src/resolve.js'

// realpath the fixture: on darwin tmpdir() is /var/... while canonical spellings
// are /private/var/..., and resolveRoots is SUPPOSED to return the latter.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
mkdirSync(join(base, 'notes'))

describe('resolveRoots', () => {
  it('resolves a relative entry against the session workspace', () => {
    const config = normalizeConfig({ paths: ['notes'] })
    const report = resolveRoots(config, base)
    expect(report.roots.map(root => root.root)).toEqual([join(base, 'notes')])
    expect(report.entries[0]).toMatchObject({ status: 'ok' })
  })

  it('marks a missing root inactive and warns once', () => {
    const config = normalizeConfig({ paths: ['nope'] })
    const report = resolveRoots(config, base)
    expect(report.roots).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'missing' })
    expect(report.warnings).toHaveLength(1)
  })

  it('rejects a filesystem-root spelling', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['/'] }), base)
    expect(report.roots).toEqual([])
    expect(report.entries[0]).toMatchObject({ status: 'rejected' })
  })

  it('rejects spellings that only canonicalisation exposes as the filesystem root', () => {
    expect(resolveRoots(normalizeConfig({ paths: ['//'] }), base).entries[0]).toMatchObject({ status: 'rejected' })
    expect(resolveRoots(normalizeConfig({ paths: ['/a/..'] }), base).entries[0]).toMatchObject({ status: 'rejected' })
  })

  it('merges spellings that canonicalise to the same root', () => {
    const config = normalizeConfig({ paths: [
      { path: `${base}//notes`, scope: 'write', surfaces: ['fs'] },
      { path: join(base, 'notes'), scope: 'write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]?.root).toBe(join(base, 'notes'))
  })

  it('merges duplicate roots taking the widest scope and the union of surfaces', () => {
    const config = normalizeConfig({ paths: [
      { path: 'notes', scope: 'write', surfaces: ['fs'] },
      { path: join(base, 'notes'), scope: 'always-write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ scope: 'always-write', surfaces: ['fs', 'shell'] })
  })

  it('warns when a root is the home directory itself', () => {
    const report = resolveRoots(normalizeConfig({ paths: [homedir()] }), base)
    expect(report.warnings.join('\n')).toContain('entire home directory')
  })

  it('warns when a root CONTAINS the home directory (~/.. must not pass unwarned)', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['~/..'] }), base)
    expect(report.warnings.join('\n')).toContain('entire home directory')
  })

  it('keeps entries in configured order for the preview', () => {
    const config = normalizeConfig({ paths: ['notes', 'nope'] })
    const report = resolveRoots(config, base)
    expect(report.entries.map(entry => entry.status)).toEqual(['ok', 'missing'])
  })

  it('keeps a single configured surface instead of widening it', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: 'notes', surfaces: ['fs'] }] }), base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]?.surfaces).toEqual(['fs'])
  })

  it('reports each entry with its canonical path, scope and surfaces', () => {
    const config = normalizeConfig({ paths: [{ path: 'notes', scope: 'always-write', surfaces: ['shell'] }] })
    expect(resolveRoots(config, base).entries[0]).toEqual({
      raw: 'notes',
      resolved: join(base, 'notes'),
      scope: 'always-write',
      surfaces: ['shell'],
      status: 'ok',
    })
  })

  it('keeps the first spelling as the merged root provenance', () => {
    const config = normalizeConfig({ paths: [
      { path: `${base}//notes`, scope: 'write', surfaces: ['fs'] },
      { path: join(base, 'notes'), scope: 'write', surfaces: ['shell'] },
    ] })
    expect(resolveRoots(config, base).roots[0]?.raw).toBe(`${base}//notes`)
  })

  it('warns once for a repeated inactive entry', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['nope', 'nope'] }), base)
    expect(report.entries.map(entry => entry.status)).toEqual(['missing', 'missing'])
    expect(report.warnings).toHaveLength(1)
  })

  it('collapses a symlinked spelling into the real root', () => {
    const link = join(base, 'link-to-notes')
    if (!existsSync(link)) symlinkSync(join(base, 'notes'), link)
    const config = normalizeConfig({ paths: [
      { path: 'link-to-notes', scope: 'write', surfaces: ['fs'] },
      { path: 'notes', scope: 'write', surfaces: ['shell'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots).toHaveLength(1)
    expect(report.roots[0]).toMatchObject({ root: join(base, 'notes'), surfaces: ['fs', 'shell'] })
  })

  it('contributes nothing for an inactive entry on any surface', () => {
    const config = normalizeConfig({ paths: [
      { path: 'nope', surfaces: ['shell'] },
      { path: 'notes', surfaces: ['fs'] },
    ] })
    expect(resolveRoots(config, base).roots.map(root => root.surfaces)).toEqual([['fs']])
  })

  it('returns an empty report for an empty configuration', () => {
    expect(resolveRoots(normalizeConfig(undefined), base)).toEqual({ roots: [], entries: [], warnings: [] })
  })

  it('does not alias the caller config through the per-entry report', () => {
    const config = normalizeConfig({ paths: [{ path: 'notes', surfaces: ['fs'] }] })
    const report = resolveRoots(config, base)
    expect(report.entries[0]?.surfaces).not.toBe(config.paths[0]?.surfaces)
    // Deliberate mutation through a report: the cast records that the point of
    // this test is that the array is a private copy, not the config's.
    ;(report.entries[0]?.surfaces as Surface[]).push('shell')
    expect(config.paths[0]?.surfaces).toEqual(['fs'])
    expect(resolveRoots(config, base).roots[0]?.surfaces).toEqual(['fs'])
  })

  it('reports surfaces in a stable order regardless of config order', () => {
    const report = resolveRoots(normalizeConfig({ paths: [{ path: 'notes', surfaces: ['shell', 'fs'] }] }), base)
    expect(report.roots[0]?.surfaces).toEqual(['fs', 'shell'])
  })

  it('keeps a nested child as its own root and lets the wider ancestor grant it', () => {
    mkdirSync(join(base, 'notes', 'sub'), { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: 'notes', scope: 'write', surfaces: ['fs', 'shell'] },
      { path: 'notes/sub', scope: 'write', surfaces: ['fs'] },
    ] })
    const report = resolveRoots(config, base)
    expect(report.roots.map(root => root.root)).toEqual([join(base, 'notes'), join(base, 'notes', 'sub')])
  })

  it('warns when a root contains the session workspace', () => {
    const report = resolveRoots(normalizeConfig({ paths: ['..'] }), base)
    expect(report.warnings.join('\n')).toContain("contains this session's workspace")
  })

  it('warns about nothing for a benign active root', () => {
    expect(resolveRoots(normalizeConfig({ paths: ['notes'] }), base).warnings).toEqual([])
  })

  it('names both the spelling and the resolved path when an entry is inactive', () => {
    const warning = resolveRoots(normalizeConfig({ paths: ['nope'] }), base).warnings[0] ?? ''
    expect(warning).toContain('"nope"')
    expect(warning).toContain(join(base, 'nope'))
  })

  it('does not leak roots across passes', () => {
    const first = resolveRoots(normalizeConfig({ paths: ['notes'] }), base)
    const second = resolveRoots(normalizeConfig(undefined), base)
    expect(first.roots).toHaveLength(1)
    expect(second.roots).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/resolve.test.ts`
Expected: FAIL — cannot resolve `../src/resolve.js`。

- [ ] **Step 3: 实现 `src/resolve.ts`**

```ts
/**
 * The one place a configuration becomes a set of effective writable roots.
 * Enforcement (both wrappers) and the settings preview call this, so what the
 * page shows and what the sandbox grants cannot drift.
 * @module dsh-extra-paths/resolve
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ExtraPathsConfig, Scope, Surface } from './config.js'
import { SURFACES, isFilesystemRoot } from './config.js'
import { canonicalizeRoot, expandPath, isUnder } from './paths.js'

/** One effective root after canonicalisation and merging. */
export interface ResolvedRoot {
  /** The configured spelling that first produced this root (for messages). */
  readonly raw: string
  /** The canonical absolute root. */
  readonly root: string
  /** The widest scope across every entry that produced this root. */
  readonly scope: Scope
  /** The union of surfaces across every entry that produced this root. */
  readonly surfaces: readonly Surface[]
}

/** Per-entry outcome, in configured order (what the settings preview renders). */
export interface EntryResolution {
  readonly raw: string
  readonly resolved: string
  readonly scope: Scope
  readonly surfaces: readonly Surface[]
  readonly status: 'ok' | 'missing' | 'rejected'
}

/**
 * One resolution pass.
 *
 * Contract for consumers:
 * - **Re-resolve per decision, never cache.** The result depends on the
 *   filesystem's CURRENT state (existence) and on `$HOME`, so a cached report
 *   would freeze an entry inactive — or worse, keep granting a root that moved.
 * - **Grants are a union, and the widest ancestor wins.** Nested roots are both
 *   kept: a narrower child cannot narrow a broader parent, so a target under the
 *   child is granted by whichever root matches first (every root is one the user
 *   configured, so this never grants outside the configured set).
 * - A root that exists but is not a directory is still reported `ok`; writes
 *   beneath it fail at the filesystem layer (ENOTDIR), not here.
 */
export interface ResolveReport {
  readonly roots: readonly ResolvedRoot[]
  readonly entries: readonly EntryResolution[]
  readonly warnings: readonly string[]
}

/**
 * Whether a root contains (or is) the home directory. Exact equality alone is
 * not enough: `~/..` canonicalises to the directory holding every user's home,
 * which is strictly broader than `~` yet would otherwise pass unwarned.
 * @param root - canonical root under test.
 * @param homeRoot - canonical home directory, resolved once per pass.
 * @returns true when home lies at or beneath the root.
 */
function containsHome(root: string, homeRoot: string): boolean {
  return isUnder(homeRoot, root)
}

/**
 * Resolve every configured entry against one session workspace.
 * @param config - the normalised configuration.
 * @param workspaceRoot - the session workspace a relative entry resolves against.
 * @returns effective roots plus per-entry detail and warnings.
 */
export function resolveRoots(config: ExtraPathsConfig, workspaceRoot: string): ResolveReport {
  const entries: EntryResolution[] = []
  const warnings: string[] = []
  const byRoot = new Map<string, ResolvedRoot>()
  // Probed at most once per pass — and not at all when no entry is active,
  // because this runs on every enforcement decision.
  let homeRoot: string | undefined

  for (const entry of config.paths) {
    const root = canonicalizeRoot(expandPath(entry.path, workspaceRoot))
    // A COPY of the caller's array: handing the config's own instance to a
    // report lets a caller mutate future grants through it.
    const shared = { raw: entry.path, resolved: root, scope: entry.scope, surfaces: [...entry.surfaces] }

    if (isFilesystemRoot(root)) {
      entries.push({ ...shared, status: 'rejected' })
      warnings.push(`extra-paths: ${JSON.stringify(entry.path)} resolves to the filesystem root; the entry is ignored`)
      continue
    }
    if (!existsSync(root)) {
      entries.push({ ...shared, status: 'missing' })
      warnings.push(`extra-paths: ${JSON.stringify(entry.path)} resolves to ${root}, which does not exist; the entry is inactive until it does`)
      continue
    }

    entries.push({ ...shared, status: 'ok' })
    homeRoot ??= canonicalizeRoot(homedir())
    if (containsHome(root, homeRoot)) {
      warnings.push(
        `extra-paths: ${JSON.stringify(entry.path)} resolves to ${root}, which contains your entire home directory; `
        + 'prefer a narrower root',
      )
    }
    if (root !== workspaceRoot && isUnder(workspaceRoot, root)) {
      warnings.push(
        `extra-paths: ${JSON.stringify(entry.path)} resolves to ${root}, which contains this session's workspace; `
        + 'prefer a sibling-scoped root',
      )
    }
    const existing = byRoot.get(root)
    if (existing === undefined) {
      // SURFACES order here too, not only on merge: a lone entry spelled
      // ['shell', 'fs'] must yield the same root identity as ['fs', 'shell'].
      const ordered = SURFACES.filter(surface => entry.surfaces.includes(surface))
      byRoot.set(root, { raw: entry.path, root, scope: entry.scope, surfaces: ordered })
      continue
    }
    const scope: Scope = existing.scope === 'always-write' || entry.scope === 'always-write' ? 'always-write' : 'write'
    // SURFACES order, not insertion order: a config edit that only reorders
    // surfaces must not change a report's identity.
    const present = new Set([...existing.surfaces, ...entry.surfaces])
    const surfaces = SURFACES.filter(surface => present.has(surface))
    byRoot.set(root, { raw: existing.raw, root, scope, surfaces })
  }

  return { roots: [...byRoot.values()], entries, warnings: [...new Set(warnings)] }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/resolve.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/resolve.ts tests/resolve.test.ts
git commit -m "feat(resolve): single source of truth for effective writable roots"
```

---

## Task 5: `src/grant.ts` + `src/policy.ts` — 模式门槛与策略翻译

**Files:**
- Create: `src/grant.ts`, `src/policy.ts`, `tests/grant.test.ts`

- [ ] **Step 1: 写失败测试 `tests/grant.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { grantFor } from '../src/grant.js'
import type { ResolvedRoot } from '../src/resolve.js'
import { syntheticPolicy } from '../src/policy.js'

const write: ResolvedRoot = { raw: 'a', root: '/a', scope: 'write', surfaces: ['fs', 'shell'] }
const always: ResolvedRoot = { raw: 'b', root: '/b', scope: 'always-write', surfaces: ['fs', 'shell'] }
const shellOnly: ResolvedRoot = { raw: 'c', root: '/c', scope: 'always-write', surfaces: ['shell'] }
const roots = [write, always, shellOnly]

describe('grantFor', () => {
  it('grants every matching root under workspace-write', () => {
    expect(grantFor('workspace-write', roots, 'fs').map(r => r.root)).toEqual(['/a', '/b'])
  })

  it('grants only always-write roots under read-only', () => {
    expect(grantFor('read-only', roots, 'fs').map(r => r.root)).toEqual(['/b'])
  })

  it('filters by surface', () => {
    expect(grantFor('workspace-write', roots, 'shell').map(r => r.root)).toEqual(['/a', '/b', '/c'])
  })

  it('grants nothing under danger-full-access (the base is unfenced already)', () => {
    expect(grantFor('danger-full-access', roots, 'fs')).toEqual([])
  })
})

describe('syntheticPolicy', () => {
  it('keeps mode at workspace-write and replaces only the root', () => {
    const policy = { mode: 'read-only', workspaceRoot: '/ws', sessionId: 's1' } as const
    expect(syntheticPolicy(policy, '/extra')).toEqual({ mode: 'workspace-write', workspaceRoot: '/extra', sessionId: 's1' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/grant.test.ts`
Expected: FAIL — cannot resolve `../src/grant.js`。

- [ ] **Step 3: 实现 `src/grant.ts` 与 `src/policy.ts`**

`src/grant.ts`：

```ts
/**
 * The mode gate: which configured roots one call may write under.
 * `write` rides the session mode; `always-write` survives `read-only` too.
 * @module dsh-extra-paths/grant
 */

import type { Surface } from './config.js'
import type { ResolvedRoot } from './resolve.js'

/** The modes a resolved policy can carry (kept local so the plugin imports no core type). */
export type SandboxModeLike = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * Select the roots a call under `mode` may write under for one surface.
 * @param mode - the resolved per-call sandbox mode.
 * @param roots - effective roots for this session workspace.
 * @param surface - the enforcement surface asking.
 * @returns the roots to grant; empty means "delegate unchanged".
 */
export function grantFor(
  mode: SandboxModeLike,
  roots: readonly ResolvedRoot[],
  surface: Surface,
): readonly ResolvedRoot[] {
  if (mode === 'danger-full-access') return []
  const candidates = roots.filter(root => root.surfaces.includes(surface))
  if (mode === 'workspace-write') return candidates
  return candidates.filter(root => root.scope === 'always-write')
}
```

`src/policy.ts`：

```ts
/**
 * Per-call policy shapes and the translation the fs wrapper performs.
 * @module dsh-extra-paths/policy
 */

import type { SandboxModeLike } from './grant.js'

/** The subset of the fs/sandbox per-call policy this plugin reads and rewrites. */
export interface PolicyLike {
  readonly mode: SandboxModeLike
  readonly workspaceRoot: string
  readonly sessionId?: unknown
}

/**
 * The policy one call is re-stamped with so the base fence accepts a target
 * under a configured root. The mode rises to `workspace-write` because that is
 * this grant's meaning: a single call is allowed to write this root, while the
 * base class keeps owning resolution, atomic publication and the version guard.
 * @param policy - the caller's resolved policy.
 * @param workspaceRoot - the canonical configured root that matched the target.
 * @returns the policy to hand the base implementation.
 */
export function syntheticPolicy(policy: PolicyLike, workspaceRoot: string): PolicyLike {
  return { ...policy, mode: 'workspace-write', workspaceRoot }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/grant.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/grant.ts src/policy.ts tests/grant.test.ts
git commit -m "feat(grant): mode gate and the fs policy translation"
```

---

## Task 6: `src/argv.ts` — 方言追加授权

**Files:**
- Create: `src/argv.ts`, `tests/argv.test.ts`

- [ ] **Step 1: 写失败测试 `tests/argv.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { widenArgv } from '../src/argv.js'

const roots = ['/data/notes']

describe('widenArgv', () => {
  it('appends a subpath allow rule to a Seatbelt profile', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['sandbox-exec', '-p', '(version 1) (allow default) (deny file-write*)', '--', ...wrapped]
    const widened = widenArgv(confined, wrapped.length, roots)
    expect(widened).toEqual([
      'sandbox-exec', '-p',
      '(version 1) (allow default) (deny file-write*) (allow file-write* (subpath "/data/notes"))',
      '--', ...wrapped,
    ])
  })

  it('escapes quotes and backslashes in the Seatbelt literal', () => {
    const wrapped = ['echo']
    const confined = ['sandbox-exec', '-p', '(version 1)', '--', ...wrapped]
    expect(widenArgv(confined, 1, ['/we"ird\\path'])?.[2]).toContain('(subpath "/we\\"ird\\\\path")')
  })

  it('binds the root into a bwrap profile', () => {
    const wrapped = ['echo', 'hi']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/ws', '/ws', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/ws', '/ws',
      '--bind', '/data/notes', '/data/notes', '--', ...wrapped,
    ])
  })

  it('adds a read-write grant to a Landlock launcher invocation', () => {
    const wrapped = ['echo']
    const confined = ['landlock-run', '--ro', '/', '--rw', '/tmp', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)).toEqual([
      'landlock-run', '--ro', '/', '--rw', '/tmp', '--rw', '/data/notes', '--', ...wrapped,
    ])
  })

  it('finds the separator even when the wrapped command contains --', () => {
    const wrapped = ['bash', '-c', 'echo -- x']
    const confined = ['bwrap', '--ro-bind', '/', '/', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)?.slice(0, 5)).toEqual([
      'bwrap', '--ro-bind', '/', '/', '--bind',
    ])
  })

  it('returns undefined for an unrecognised dialect (fail closed)', () => {
    const wrapped = ['echo']
    const confined = ['windows-acl-run', '--workspace', '/ws', '--', ...wrapped]
    expect(widenArgv(confined, wrapped.length, roots)).toBeUndefined()
  })

  it('returns undefined when the separator is missing', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/'], 1, roots)).toBeUndefined()
  })

  it('appends one grant per root, in the order given', () => {
    const wrapped = ['echo']
    const confined = ['sandbox-exec', '-p', '(version 1)', '--', ...wrapped]
    expect(widenArgv(confined, 1, ['/a', '/b'])?.[2])
      .toBe('(version 1) (allow file-write* (subpath "/a")) (allow file-write* (subpath "/b"))')
  })

  it('locates the separator from wrappedLength, including a zero-length command', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/', '--'], 0, ['/a']))
      .toEqual(['bwrap', '--ro-bind', '/', '/', '--bind', '/a', '/a', '--'])
  })

  it('fails closed when wrappedLength cannot address the separator', () => {
    expect(widenArgv(['bwrap', '--ro-bind', '/', '/', '--', 'echo'], 99, ['/a'])).toBeUndefined()
    expect(widenArgv(['--'], 0, ['/a'])).toBeUndefined()
  })

  it('returns the argv unchanged when there is nothing to grant', () => {
    const confined = ['bwrap', '--', 'echo']
    expect(widenArgv(confined, 1, [])).toBe(confined)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/argv.test.ts`
Expected: FAIL — cannot resolve `../src/argv.js`。

- [ ] **Step 3: 实现 `src/argv.ts`**

```ts
/**
 * Runner-dialect widening: append one write grant per configured root to an
 * argv the base provider already wrapped. Detection is structural (flags, not
 * program names) and every unrecognised shape fails closed by returning
 * `undefined` — the caller then leaves the argv untouched, so the write is
 * denied rather than silently mis-granted.
 * @module dsh-extra-paths/argv
 */

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Insert write grants for `roots` into a confined argv.
 * @param confined - the argv the base provider produced (runner, profile, `--`, command).
 * @param wrappedLength - length of the caller's original argv, which locates the separator.
 * @param roots - canonical roots to grant.
 * @returns the widened argv, the unchanged argv when there is nothing to grant,
 *   or `undefined` when the dialect is unrecognised (the caller must not grant).
 */
export function widenArgv(
  confined: readonly string[],
  wrappedLength: number,
  roots: readonly string[],
): readonly string[] | undefined {
  if (roots.length === 0) return confined
  const separatorIndex = confined.length - wrappedLength - 1
  if (separatorIndex <= 0 || confined[separatorIndex] !== '--') return undefined
  const head = confined.slice(0, separatorIndex)
  const tail = confined.slice(separatorIndex)

  // Seatbelt: sandbox-exec -p <profile> -- <argv>
  if (head[1] === '-p' && head[2]?.startsWith('(version 1)') === true) {
    const extra = roots.map(root => ` (allow file-write* (subpath ${sbplString(root)}))`).join('')
    return [...head.slice(0, 2), `${head[2]}${extra}`, ...head.slice(3), ...tail]
  }
  // bwrap: --ro-bind / / ... (a writable bind per root)
  if (head.includes('--ro-bind')) {
    return [...head, ...roots.flatMap(root => ['--bind', root, root]), ...tail]
  }
  // Landlock launcher: --ro <path> / --rw <path> grants
  if (head.includes('--ro') || head.includes('--rw')) {
    return [...head, ...roots.flatMap(root => ['--rw', root]), ...tail]
  }
  // windows-acl and any future runner: not expressible here.
  return undefined
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/argv.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/argv.ts tests/argv.test.ts
git commit -m "feat(argv): widen Seatbelt/bwrap/Landlock profiles, fail closed on unknown dialects"
```

---

## Task 7: `src/wrap-fs.ts` — fs 侧透明包装

**Files:**
- Create: `src/wrap-fs.ts`, `tests/wrap-fs.test.ts`

- [ ] **Step 1: 写失败测试 `tests/wrap-fs.test.ts`**

```ts
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { canonicalizeRoot } from '../src/paths.js'
import { isConfiningFs, wrapFs, type FsInnerLike, type FsTargetLike } from '../src/wrap-fs.js'

// realpath the fixture: darwin's tmpdir() is /var/... while canonical spellings
// are /private/var/..., and the wrapper must match the canonical one.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const notes = join(base, 'notes')
mkdirSync(notes)

function innerStub() {
  const calls: { policy: unknown; target: FsTargetLike; expected: unknown; signal: unknown }[] = []
  const inner = {
    sandboxMode: 'workspace-write',
    async resolve(path: string): Promise<FsTargetLike> {
      return { targetKey: path, displayPath: path }
    },
    async writeText(target: FsTargetLike, _content: string, expected?: unknown, signal?: unknown, policy?: unknown) {
      calls.push({ policy, target, expected, signal })
      return { ok: true }
    },
    async editText(target: FsTargetLike, _edit: unknown, expected?: unknown, signal?: unknown, policy?: unknown) {
      calls.push({ policy, target, expected, signal })
      return { ok: true }
    },
  } as FsInnerLike
  return { inner, calls }
}

function deps(config = normalizeConfig({ paths: [{ path: notes, scope: 'write' }] })) {
  return { readConfig: () => config, fallbackPolicy: () => undefined }
}

const target = (path: string): FsTargetLike => ({ targetKey: path, displayPath: path })

describe('isConfiningFs', () => {
  it('accepts a sandboxed filesystem and rejects a plain one', () => {
    expect(isConfiningFs(innerStub().inner)).toBe(true)
    expect(isConfiningFs({ readText: () => undefined })).toBe(false)
  })
})

describe('wrapFs', () => {
  it('re-stamps the policy with the matched root', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, { mode: 'workspace-write', workspaceRoot: base })
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: notes })
  })

  it('grants an always-write root in a read-only session', async () => {
    const { inner, calls } = innerStub()
    const config = normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] })
    const wrapped = wrapFs(inner, deps(config))
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, { mode: 'read-only', workspaceRoot: base })
    expect(calls[0]?.policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: notes })
  })

  it('passes an unmatched target through untouched (same policy object)', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(base, 'other.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('does not grant a write-scope root in a read-only session', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'read-only', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('delegates unchanged when the caller stamped no policy and no fallback resolves', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    expect(calls[0]?.policy).toBeUndefined()
  })

  it('uses the fallback policy when the caller stamped none', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, { ...deps(), fallbackPolicy: () => ({ mode: 'workspace-write', workspaceRoot: base }) })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('stamps the FIRST matching root, so a nested child cannot narrow its parent', async () => {
    const { inner, calls } = innerStub()
    mkdirSync(join(notes, 'sub'), { recursive: true })
    const config = normalizeConfig({ paths: [
      { path: notes, scope: 'write' },
      { path: join(notes, 'sub'), scope: 'write' },
    ] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    await wrapped.writeText(target(join(notes, 'sub', 'a.md')), 'x', undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('translates editText the same way as writeText', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.editText(target(join(notes, 'a.md')), { find: 'a', replace: 'b' }, undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('delegates unchanged under danger-full-access', async () => {
    const { inner, calls } = innerStub()
    // `always-write` on purpose: with a `write`-scope root the case would pass
    // even if the danger guard were deleted, because nothing is granted outside
    // workspace-write anyway (an always-write root IS granted under read-only).
    const wrapped = wrapFs(inner, deps(normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] })))
    const policy = { mode: 'danger-full-access', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toBe(policy)
  })

  it('does not even read the configuration under danger-full-access', async () => {
    const { inner } = innerStub()
    const resolve = vi.fn(async (path: string) => ({ targetKey: path, displayPath: path }))
    inner.resolve = resolve
    // `readConfig` is the assertion with teeth: `grantFor` itself returns [] under
    // danger-full-access, so a resolve-not-called assertion would be satisfied by
    // that other guard. Only skipping `resolveRoots(config, …)` is observable.
    const readConfig = vi.fn(() => normalizeConfig({ paths: [{ path: notes, scope: 'always-write' }] }))
    const wrapped = wrapFs(inner, { readConfig, fallbackPolicy: () => undefined })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, {
      mode: 'danger-full-access',
      workspaceRoot: base,
    })
    expect(readConfig).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('never mutates the caller policy object', async () => {
    const { inner } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(policy).toEqual({ mode: 'workspace-write', workspaceRoot: base })
  })

  it('asks for the fallback policy on every call, never once at wrap time', async () => {
    const { inner } = innerStub()
    const fallbackPolicy = vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: base }) as const)
    const wrapped = wrapFs(inner, { readConfig: () => normalizeConfig({ paths: [notes] }), fallbackPolicy })
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    await wrapped.writeText(target(join(notes, 'a.md')), 'x')
    expect(fallbackPolicy).toHaveBeenCalledTimes(2)
  })

  it('re-reads the configuration on every call, so a removed root stops being granted', async () => {
    const { inner, calls } = innerStub()
    let config = normalizeConfig({ paths: [{ path: notes, scope: 'write' }] })
    const wrapped = wrapFs(inner, { readConfig: () => config, fallbackPolicy: () => undefined })
    const policy = { mode: 'workspace-write', workspaceRoot: base } as const
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    config = normalizeConfig(undefined)
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, policy)
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
    expect(calls[1]?.policy).toBe(policy)
  })

  it('matches on the canonical target, not the spelling the caller passed', async () => {
    const { inner, calls } = innerStub()
    const link = join(base, 'link-to-notes')
    if (!existsSync(link)) symlinkSync(notes, link)
    // The stub resolves the symlink to its real path, exactly as the fs service
    // does; matching on `displayPath` would miss the configured root.
    inner.resolve = async (path: string) => ({ targetKey: canonicalizeRoot(path), displayPath: path })
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(link, 'a.md')), 'x', undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.policy).toMatchObject({ workspaceRoot: notes })
  })

  it('passes the expected intent and the caller signal through, and returns the delegate result', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const controller = new AbortController()
    const expected = { kind: 'createIfAbsent' }
    const result = await wrapped.writeText(target(join(notes, 'a.md')), 'x', expected, controller.signal, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.expected).toBe(expected)
    expect(calls[0]?.signal).toBe(controller.signal)
    expect(result).toEqual({ ok: true })
  })

  it('passes the expected intent and signal through editText too', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    const controller = new AbortController()
    const expected = { version: 3 }
    await wrapped.editText(target(join(notes, 'a.md')), { find: 'a', replace: 'b' }, expected, controller.signal, {
      mode: 'workspace-write',
      workspaceRoot: base,
    })
    expect(calls[0]?.expected).toBe(expected)
    expect(calls[0]?.signal).toBe(controller.signal)
  })

  it('keeps every other policy field when it re-stamps the root', async () => {
    const { inner, calls } = innerStub()
    const wrapped = wrapFs(inner, deps())
    await wrapped.writeText(target(join(notes, 'a.md')), 'x', undefined, undefined, {
      mode: 'workspace-write',
      workspaceRoot: base,
      sessionId: 'sess-1',
    })
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: notes, sessionId: 'sess-1' })
  })

  it('forwards every other member and keeps getters working', () => {
    const { inner } = innerStub()
    const wrapped = wrapFs(inner, deps())
    expect(wrapped.sandboxMode).toBe('workspace-write')
    expect(typeof wrapped.resolve).toBe('function')
    // Interceptors and bound methods are built once: a fresh closure (or bind)
    // per read would churn identities.
    expect(wrapped.resolve).toBe(wrapped.resolve)
    expect(wrapped.writeText).toBe(wrapped.writeText)
    expect(wrapped.editText).toBe(wrapped.editText)
    expect(wrapped.constructor).toBe(inner.constructor)
    expect(wrapped).toBeInstanceOf(Object)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/wrap-fs.test.ts`
Expected: FAIL — cannot resolve `../src/wrap-fs.js`。

- [ ] **Step 3: 实现 `src/wrap-fs.ts`**

```ts
/**
 * The filesystem half of the plugin: a transparent Proxy over `ctx.fs` that
 * re-stamps ONE call's policy when its target lies under a configured root.
 *
 * Transparency rules (verified against cordis 4.0.2 by
 * spike/cordis-get-wrap-baseline.mjs): forward every property with the inner
 * value as the receiver, bind methods to the inner instance — except
 * `constructor`, whose binding breaks the framework's own `instanceof`
 * (`Service[Symbol.hasInstance]` walks `instance.constructor`).
 * @module dsh-extra-paths/wrap-fs
 */

import type { ExtraPathsConfig } from './config.js'
import { grantFor } from './grant.js'
import { isUnder } from './paths.js'
import { syntheticPolicy, type PolicyLike } from './policy.js'
import { resolveRoots } from './resolve.js'

/** A resolved filesystem target (the fs service's own shape). */
export interface FsTargetLike {
  readonly targetKey: unknown
  readonly displayPath: string
}

/** The subset of the filesystem service this wrapper intercepts. */
export interface FsInnerLike {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetLike>
  writeText(target: FsTargetLike, content: string, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  editText(target: FsTargetLike, edit: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  readonly sandboxMode?: string
}

/** What the wrapper needs from the plugin. */
export interface FsWrapDeps {
  /** Live configuration: re-read on EVERY call, never captured at wrap time. */
  readConfig(): ExtraPathsConfig
  /** Deployment policy for a caller that stamped none; resolved per call. */
  fallbackPolicy(): PolicyLike | undefined
}

/**
 * Whether a service is the sandboxed filesystem: mutating methods plus the
 * capability fact (`sandboxMode`) that only a confining backend exposes.
 * A plain local filesystem is left unwrapped — nothing confines it.
 * @param value - the service read from the context.
 * @returns true when the wrapper applies.
 */
export function isConfiningFs(value: unknown): value is FsInnerLike {
  const fs = value as FsInnerLike | undefined
  return typeof fs?.writeText === 'function'
    && typeof fs.editText === 'function'
    && typeof fs.resolve === 'function'
    && typeof fs.sandboxMode === 'string'
}

/**
 * Wrap one filesystem service.
 * @param inner - the service instance read from the context.
 * @param deps - configuration and policy sources.
 * @returns a transparent proxy that grants configured roots on mutation.
 */
export function wrapFs(inner: FsInnerLike, deps: FsWrapDeps): FsInnerLike {
  const bound = new Map<PropertyKey, unknown>()

  const translate = async (
    target: FsTargetLike,
    policy: PolicyLike | undefined,
    delegate: (policy: PolicyLike | undefined) => Promise<unknown>,
  ): Promise<unknown> => {
    if (policy === undefined || policy.mode === 'danger-full-access') return delegate(policy)
    const granted = grantFor(policy.mode, resolveRoots(deps.readConfig(), policy.workspaceRoot).roots, 'fs')
    if (granted.length === 0) return delegate(policy)
    // Re-canonicalise NOW, exactly like the base fence does, so the identity we
    // matched is the identity the base will check.
    const fresh = await inner.resolve(target.displayPath)
    const match = granted.find(root => isUnder(String(fresh.targetKey), root.root))
    if (match === undefined) return delegate(policy)
    return delegate(syntheticPolicy(policy, match.root))
  }

  // Built ONCE per wrapper: reading a method twice must hand back the same
  // function (and a fresh closure per read is pure allocation). Nothing here
  // captures read-time state — the policy is resolved inside each call.
  const writeText = (t: FsTargetLike, content: string, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translate(t, policy ?? deps.fallbackPolicy(), effective => inner.writeText(t, content, expected, signal, effective))
  const editText = (t: FsTargetLike, edit: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translate(t, policy ?? deps.fallbackPolicy(), effective => inner.editText(t, edit, expected, signal, effective))

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'writeText') return writeText
      if (prop === 'editText') return editText
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function' || prop === 'constructor') return value
      const cached = bound.get(prop)
      if (cached !== undefined) return cached
      const fn = value.bind(target)
      bound.set(prop, fn)
      return fn
    },
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/wrap-fs.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/wrap-fs.ts tests/wrap-fs.test.ts
git commit -m "feat(wrap-fs): transparent fs proxy performing per-call policy translation"
```

---

## Task 8: `src/wrap-sandbox.ts` — shell 侧透明包装

**Files:**
- Create: `src/wrap-sandbox.ts`, `tests/wrap-sandbox.test.ts`

- [ ] **Step 1: 写失败测试 `tests/wrap-sandbox.test.ts`**

```ts
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { isConfiningSandbox, wrapSandbox, type ConfinedArgvLike, type SandboxInnerLike } from '../src/wrap-sandbox.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const notes = join(base, 'notes')
mkdirSync(notes)

const seatbeltConfined = (command: readonly string[]): ConfinedArgvLike => ({
  argv: ['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...command],
  enforcement: 'full',
  denialSignatures: ['operation not permitted'],
  runnerFailureRules: [],
})

/**
 * The providers in this DSH version are SYNCHRONOUS: callers do
 * `sandbox.confine(argv, policy).argv` without awaiting, so the double must be
 * synchronous too — an `async` double is what let the real defect through.
 */
function stub(argv = ['echo', 'hi']) {
  const inner = {
    confine: vi.fn((): ConfinedArgvLike => seatbeltConfined(argv)),
  } as unknown as SandboxInnerLike
  return { inner, argv }
}

/** Read the record the way production does, and fail loudly if a thenable came back. */
function record(value: ConfinedArgvLike | Promise<ConfinedArgvLike>): ConfinedArgvLike {
  if (typeof (value as PromiseLike<unknown>).then === 'function') {
    throw new Error('wrapSandbox returned a thenable for a synchronous provider')
  }
  return value as ConfinedArgvLike
}

const config = (scope: 'write' | 'always-write' = 'write') =>
  normalizeConfig({ paths: [{ path: notes, scope, surfaces: ['shell'] }] })

describe('wrapSandbox', () => {
  it('answers synchronously, the way its callers read it', () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    // The regression pin for the defect that broke every confined process:
    // `.argv` must be readable off the call itself, not off a promise.
    expect(result).not.toBeInstanceOf(Promise)
    expect(record(result).argv).toHaveLength(argv.length + 4)
    expect(record(result).argv[0]).toBe('sandbox-exec')
  })

  it('still supports a provider that answers with a thenable', async () => {
    const { argv } = stub()
    const inner = {
      confine: vi.fn(async (): Promise<ConfinedArgvLike> => seatbeltConfined(argv)),
    } as unknown as SandboxInnerLike
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = await wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
  })

  it('widens the profile for a matching root', async () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn })
    const result = await wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves read-only alone for a write-scope root', async () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = await wrapped.confine(argv, { mode: 'read-only', workspaceRoot: base })
    expect(result.argv[2]).not.toContain('subpath')
  })

  it('widens read-only for an always-write root', async () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config('always-write'), warn: vi.fn() })
    const result = await wrapped.confine(argv, { mode: 'read-only', workspaceRoot: base })
    expect(result.argv[2]).toContain(`(subpath "${notes}")`)
  })

  it('warns and grants nothing when the dialect is unrecognised', async () => {
    const { inner, argv } = stub()
    const warn = vi.fn()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn })
    inner.confine = vi.fn(async (): Promise<ConfinedArgvLike> => ({
      argv: ['windows-acl-run', '--workspace', base, '--', ...argv],
      enforcement: 'partial',
      denialSignatures: ['access is denied'],
      runnerFailureRules: [],
    }))
    const result = await wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    expect(result.argv).toHaveLength(argv.length + 4)
    expect(warn).toHaveBeenCalledOnce()
    // The warning must name the runner, or the user cannot tell which command
    // ran without their configured roots.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('windows-acl-run'))
  })

  it('preserves the runner metadata verbatim', async () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const result = await wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base })
    // Losing these would make the consumer read "denied by the sandbox" as
    // "the command itself failed".
    expect(result.enforcement).toBe('full')
    expect(result.denialSignatures).toEqual(['operation not permitted'])
    expect(result.runnerFailureRules).toEqual([])
  })

  it('delegates unchanged under danger-full-access', async () => {
    const { inner, argv } = stub()
    // always-write on purpose: a `write`-scope root is never granted outside
    // workspace-write, which would make this case pass without the guard.
    const wrapped = wrapSandbox(inner, { readConfig: () => config('always-write'), warn: vi.fn() })
    const result = await wrapped.confine(argv, { mode: 'danger-full-access', workspaceRoot: base })
    expect(result.argv).toEqual(['sandbox-exec', '-p', '(version 1) (deny file-write*)', '--', ...argv])
  })

  it('forwards the caller signal to the inner provider', async () => {
    const { inner, argv } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    const controller = new AbortController()
    await wrapped.confine(argv, { mode: 'workspace-write', workspaceRoot: base }, controller.signal)
    expect(inner.confine).toHaveBeenCalledWith(argv, { mode: 'workspace-write', workspaceRoot: base }, controller.signal)
  })

  it('forwards other members untouched', () => {
    const { inner } = stub()
    const wrapped = wrapSandbox(inner, { readConfig: () => config(), warn: vi.fn() })
    // Same identity contract as the fs wrapper: the interceptor is built once.
    expect(wrapped.confine).toBe(wrapped.confine)
    expect(wrapped.constructor).toBe(inner.constructor)
    expect(isConfiningSandbox(wrapped)).toBe(true)
    expect(isConfiningSandbox({})).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/wrap-sandbox.test.ts`
Expected: FAIL — cannot resolve `../src/wrap-sandbox.js`。

- [ ] **Step 3: 实现 `src/wrap-sandbox.ts`**

```ts
/**
 * The subprocess half of the plugin: a transparent Proxy over `ctx.sandbox`
 * that appends one write grant per configured root to the argv the base
 * provider already wrapped. An unrecognised runner dialect fails closed: the
 * argv is returned untouched (the write stays denied) and a warning is logged.
 * @module dsh-extra-paths/wrap-sandbox
 */

import { widenArgv } from './argv.js'
import type { ExtraPathsConfig } from './config.js'
import { grantFor } from './grant.js'
import type { PolicyLike } from './policy.js'
import { resolveRoots } from './resolve.js'

/** The base provider's confinement result (the fields this plugin preserves verbatim). */
export interface ConfinedArgvLike {
  readonly argv: readonly string[]
  readonly enforcement: unknown
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: readonly unknown[]
}

/** The subset of the sandbox provider this wrapper intercepts. */
export interface SandboxInnerLike {
  confine(
    argv: readonly string[],
    policy: PolicyLike,
    signal?: AbortSignal,
  ): ConfinedArgvLike | Promise<ConfinedArgvLike>
}

/** What the wrapper needs from the plugin. */
export interface SandboxWrapDeps {
  readConfig(): ExtraPathsConfig
  warn(message: string): void
}

/** Whether a provider answered with a thenable instead of the record itself. */
function isThenable(value: ConfinedArgvLike | Promise<ConfinedArgvLike>): value is Promise<ConfinedArgvLike> {
  return typeof (value as PromiseLike<unknown>).then === 'function'
}

/** Whether a service is a process-sandbox provider. */
export function isConfiningSandbox(value: unknown): value is SandboxInnerLike {
  return typeof (value as SandboxInnerLike | undefined)?.confine === 'function'
}

/**
 * Wrap one sandbox provider.
 * @param inner - the provider read from the context.
 * @param deps - configuration source and warning sink.
 * @returns a transparent proxy that widens profiles for configured roots.
 */
export function wrapSandbox(inner: SandboxInnerLike, deps: SandboxWrapDeps): SandboxInnerLike {
  const bound = new Map<PropertyKey, unknown>()

  const widen = (confined: ConfinedArgvLike, wrappedLength: number, policy: PolicyLike): ConfinedArgvLike => {
    const granted = grantFor(policy.mode, resolveRoots(deps.readConfig(), policy.workspaceRoot).roots, 'shell')
    if (granted.length === 0) return confined
    const widened = widenArgv(confined.argv, wrappedLength, granted.map(root => root.root))
    if (widened === undefined) {
      deps.warn(
        `extra-paths: unrecognised sandbox runner dialect (${JSON.stringify(confined.argv[0])}); `
        + 'extra paths are NOT granted for this command',
      )
      return confined
    }
    return { ...confined, argv: widened }
  }

  // Deliberately NOT `async`: the provider is synchronous here and its callers do
  // `sandbox.confine(argv, policy).argv`, so a Promise return breaks every
  // confined process. A thenable answer is widened in a continuation instead.
  const confine = (
    argv: readonly string[],
    policy: PolicyLike,
    signal?: AbortSignal,
  ): ConfinedArgvLike | Promise<ConfinedArgvLike> => {
    const confined = inner.confine(argv, policy, signal)
    if (isThenable(confined)) return confined.then(record => widen(record, argv.length, policy))
    return widen(confined, argv.length, policy)
  }

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'confine') return confine
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function' || prop === 'constructor') return value
      const cached = bound.get(prop)
      if (cached !== undefined) return cached
      const fn = value.bind(target)
      bound.set(prop, fn)
      return fn
    },
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/wrap-sandbox.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/wrap-sandbox.ts tests/wrap-sandbox.test.ts
git commit -m "feat(wrap-sandbox): transparent provider proxy widening runner profiles"
```

---

## Task 9: 监听器 + 插件入口 + 装进 profile（M2 验收）

**Files:**
- Create: `src/listener.ts`, `src/context.ts`, `src/index.ts`, `cordis.patch.yml`, `tests/context.test.ts`

- [ ] **Step 1: 写 `src/context.ts` 的失败测试 `tests/context.test.ts`**

```ts
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { renderExtraPathsContext } from '../src/context.js'

const base = mkdtempSync(join(tmpdir(), 'xpaths-'))
mkdirSync(join(base, 'notes'))

it('renders nothing without a session cwd or without effective roots', () => {
  const config = normalizeConfig({ paths: ['notes'] })
  expect(renderExtraPathsContext(() => config, undefined)).toBe('')
  expect(renderExtraPathsContext(() => config, join(base, 'elsewhere'))).toBe('')
})

it('lists the effective roots with their scope', () => {
  const config = normalizeConfig({ paths: [{ path: 'notes', scope: 'always-write' }] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain(join(base, 'notes'))
  expect(text).toContain('regardless of the standing sandbox mode')
  expect(text).toContain('no approval is required')
})
```

- [ ] **Step 2: 实现 `src/context.ts`**

```ts
/**
 * The runtime-context section that tells the model which extra roots this
 * session may write under, so it neither refuses nor escalates pre-emptively.
 * @module dsh-extra-paths/context
 */

import type { ExtraPathsConfig } from './config.js'
import { resolveRoots } from './resolve.js'

/**
 * Render the section text, or an empty string when there is nothing to say.
 * @param readConfig - current configuration snapshot.
 * @param cwd - the calling session's workspace (undefined outside a session).
 * @returns the prompt text.
 */
export function renderExtraPathsContext(readConfig: () => ExtraPathsConfig, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const report = resolveRoots(readConfig(), cwd)
  if (report.roots.length === 0) return ''
  const lines = report.roots.map(root => {
    const reach = root.scope === 'always-write'
      ? 'writable regardless of the standing sandbox mode'
      : 'writable while the policy is workspace-write'
    return `  - ${root.root} — ${reach} (surfaces: ${root.surfaces.join('+')})`
  })
  return [
    'Additional configured writable roots for this session (no approval is required to write under them):',
    ...lines,
  ].join('\n')
}
```

- [ ] **Step 3: 实现 `src/listener.ts`**

```ts
/**
 * The `internal/get` interception: wraps `ctx.fs` and `ctx.sandbox` as they are
 * read. The callback must never change the semantics of a service read — it
 * always calls `next()`, rethrows a resolution failure unchanged, and falls
 * back to the unwrapped value if its own wrapping throws.
 * @module dsh-extra-paths/listener
 */

import type { ExtraPathsConfig } from './config.js'
import type { PolicyLike } from './policy.js'
import { isConfiningFs, wrapFs, type FsInnerLike } from './wrap-fs.js'
import { isConfiningSandbox, wrapSandbox, type SandboxInnerLike } from './wrap-sandbox.js'

/** The context surface the listener needs (cordis `on`, deliberately minimal). */
export interface ListenerContext {
  on(name: 'internal/get', listener: (ctx: unknown, name: unknown, error: unknown, next: () => unknown) => unknown): unknown
}

/** What the listener needs from the plugin. */
export interface ListenerDeps {
  readConfig(): ExtraPathsConfig
  /** Resolve the deployment fallback policy through the READING context. */
  fallbackPolicy(readCtx: unknown): PolicyLike | undefined
  warn(message: string): void
}

/** Observability of one installation (the load-time self-test reads it). */
export interface ListenerState {
  reads: number
  fsWraps: number
  sandboxWraps: number
}

/**
 * Resolve `ctx.sandboxPolicy.resolve()` through a reading context without
 * requiring an injection — `reflect.get` is exactly the non-strict read.
 * @param readCtx - the context whose proxy served the service read.
 * @returns the deployment policy, or undefined when the service is unavailable.
 */
export function fallbackPolicyOf(readCtx: unknown): PolicyLike | undefined {
  const get = (readCtx as { get?: (name: string, strict?: boolean) => unknown } | undefined)?.get
  if (typeof get !== 'function') return undefined
  const service = get.call(readCtx, 'sandboxPolicy', false) as { resolve?: () => PolicyLike } | undefined
  return typeof service?.resolve === 'function' ? service.resolve() : undefined
}

/**
 * Install the interception listener on the calling fiber.
 * @param ctx - the plugin context (the listener is disposed with its fiber).
 * @param deps - configuration and logging sources.
 * @returns counters the caller uses for the load-time self-test.
 */
export function installListener(ctx: ListenerContext, deps: ListenerDeps): ListenerState {
  const state: ListenerState = { reads: 0, fsWraps: 0, sandboxWraps: 0 }
  ctx.on('internal/get', (readCtx, name, _error, next) => {
    const value = next()
    state.reads += 1
    try {
      if (name === 'fs' && isConfiningFs(value)) {
        state.fsWraps += 1
        return wrapFs(value as FsInnerLike, {
          // Both are closures evaluated PER CALL: hoisting either one would
          // freeze the session's workspace (and therefore which relative
          // entries are live) at wrap time.
          readConfig: deps.readConfig,
          fallbackPolicy: () => deps.fallbackPolicy(readCtx),
        })
      }
      if (name === 'sandbox' && isConfiningSandbox(value)) {
        state.sandboxWraps += 1
        return wrapSandbox(value as SandboxInnerLike, { readConfig: deps.readConfig, warn: deps.warn })
      }
    } catch (error) {
      deps.warn(`extra-paths: wrapping ctx.${String(name)} failed; it stays unwrapped: ${String(error)}`)
    }
    return value
  })
  return state
}
```

- [ ] **Step 4: 实现 `src/schema.ts`**

```ts
/**
 * The settings namespace schema. The resolved section is what the enforcement
 * layers read; `base` (the entry config) supplies deployment defaults beneath
 * the user layer.
 * @module dsh-extra-paths/schema
 */

import z from '@deepseek-ai/schemastery'
import type { Scope, Surface } from './config.js'

/** One configured path as stored in the settings document. */
export interface ExtraPathsSectionEntry {
  path: string
  scope?: Scope
  surfaces?: Surface[]
}

/** The `extra-paths` settings section as stored (the schema supplies the defaults). */
export interface ExtraPathsSection {
  defaultScope?: Scope
  defaultSurfaces?: Surface[]
  paths?: (string | ExtraPathsSectionEntry)[]
}

// Every schema is annotated: a bare `z.object({...})` inside a heterogeneous
// union both fails to infer and (per TS2742) leaks a non-portable type name.
const scopeSchema: z<Scope> = z.union(['write', 'always-write'] as const)
const surfaceSchema: z<Surface> = z.union(['fs', 'shell'] as const)
const entrySchema: z<ExtraPathsSectionEntry> = z.object({
  path: z.string().required(),
  scope: scopeSchema,
  surfaces: z.array(surfaceSchema),
})

/** The `extra-paths` namespace value. */
export const extraPathsSchema: z<ExtraPathsSection> = z.object({
  defaultScope: scopeSchema.default('write'),
  defaultSurfaces: z.array(surfaceSchema).default(['fs', 'shell']),
  paths: z.array(z.union([z.string(), entrySchema])).default([]),
})
```

- [ ] **Step 5: 实现 `src/index.ts`（插件入口 + 加载期自检）**

```ts
/**
 * dsh-extra-paths: configured extra writable roots for the sandboxed fs tools
 * and the sandboxed shell, plus the settings namespace and its preview route.
 *
 * Host half only. No `@deepseek-ai/*` VALUE import except the settings schema
 * builder: every failure below degrades to "no grant + warning", never to a
 * failed boot.
 * @module dsh-extra-paths
 */

import { normalizeConfig, validateConfig, type ExtraPathsConfig, type RawConfig } from './config.js'
import { renderExtraPathsContext } from './context.js'
import { installListener, fallbackPolicyOf } from './listener.js'
import { registerPreviewRoute } from './preview.js'
import { extraPathsSchema } from './schema.js'

/** The settings namespace the client page binds to. */
export const SETTINGS_NAMESPACE = 'extra-paths'

/**
 * Normalise the entry config, degrading to the documented empty configuration
 * on any problem. This is the plugin's only untrusted-input boundary that runs
 * before the settings service can validate anything, so it must not throw.
 * @param raw - the entry config as loaded from the composition.
 * @param warn - warning sink.
 * @returns a normalised configuration safe to read on every enforcement decision.
 */
export function safeEntryConfig(raw: RawConfig | undefined, warn: (message: string) => void): ExtraPathsConfig {
  try {
    return normalizeConfig(raw)
  } catch (error) {
    warn(`extra-paths: entry config rejected (${String(error)}); continuing with the empty configuration`)
    return normalizeConfig(undefined)
  }
}

/** Minimal plugin context surface (the loader passes the real cordis context). */
interface PluginContext {
  logger: { info(message: string): void; warn(message: string): void }
  on: Parameters<typeof installListener>[0]['on']
  inject(names: readonly string[], callback: (scope: never) => void): unknown
  sandboxPolicy: unknown
}

/** Settings service surface used here (shape verified against @deepseek-ai/dsh-settings@0.1.5-rc.1). */
interface SettingsSurface {
  register(namespace: string, schema: unknown, options: {
    base?: RawConfig
    applies?: 'live' | 'restart'
    validate?: (value: unknown) => void
  }): {
    get(): unknown
    watch(callback: (value: unknown) => void): () => void
  }
}

/** System-prompt service surface used here. */
interface SystemPromptSurface {
  getContextOrder(name: 'SANDBOX_POLICY'): number
  context(section: { name: string; order: number; text: (context: { agent?: { session?: { header?: { cwd?: string } } } }) => string }): unknown
}

/** Web carrier surface used here. */
interface WebServerSurface {
  register(route: { kind: 'exact'; path: string; handler: (req: never, res: never) => void | Promise<void> }): () => void
}

/**
 * Plugin body.
 * @param ctx - the entry context.
 * @param config - the entry config, used as the settings `base` layer.
 */
export function apply(ctx: PluginContext, config?: RawConfig): void {
  const warn = (message: string): void => { ctx.logger.warn(message) }
  // The entry config is UNTRUSTED (a typo in cordis.patch.yml must never stop
  // the boot): sanitise once and use the sanitised value for both the live
  // snapshot and the settings `base` layer.
  const entryConfig = safeEntryConfig(config, warn)
  let current: ExtraPathsConfig = entryConfig

  const listener = installListener(ctx, {
    readConfig: () => current,
    fallbackPolicy: fallbackPolicyOf,
    warn,
  })

  ctx.inject(['settings'], (scope) => {
    const settings = (scope as unknown as { settings: SettingsSurface }).settings
    const registered = settings.register(SETTINGS_NAMESPACE, extraPathsSchema, {
      base: entryConfig,
      applies: 'live',
      validate: (value) => { validateConfig(value as RawConfig) },
    })
    current = normalizeConfig(registered.get() as RawConfig)
    registered.watch((value) => { current = normalizeConfig(value as RawConfig) })
  })

  ctx.inject(['systemPrompt'], (scope) => {
    const systemPrompt = (scope as unknown as { systemPrompt: SystemPromptSurface }).systemPrompt
    systemPrompt.context({
      name: 'extra-paths:writable',
      order: systemPrompt.getContextOrder('SANDBOX_POLICY') + 2,
      text: context => renderExtraPathsContext(() => current, context.agent?.session?.header?.cwd),
    })
  })

  ctx.inject(['webServer', 'connection'], (scope) => {
    registerPreviewRoute(scope as never, { readConfig: () => current, warn })
  })

  // Load-time self-test: this read MUST travel through internal/get. Zero
  // observed reads means the interception seam is gone in this DSH version —
  // and a service that is never wrapped looks exactly like "writes are denied",
  // so both counters are asserted, not just the read counter.
  void ctx.sandboxPolicy
  if (listener.reads === 0) {
    warn(
      'extra-paths: internal/get interception is unavailable on this DSH version — '
      + 'configured extra paths will NOT be granted. The plugin stays inert and boot is unaffected.',
    )
  }
  // NOTE: `fsWraps`/`sandboxWraps` are deliberately NOT asserted here. At apply
  // time no consumer has read `ctx.fs`/`ctx.sandbox` yet, so both are always 0 —
  // a check on them here fires on every boot while the feature works fine. They
  // stay on ListenerState as after-the-fact observability only.
}

/** Property carrier so the loader waits for the policy service. */
const plugin = Object.assign(apply, { inject: ['sandboxPolicy'] as const })

export default plugin
```

- [ ] **Step 6: 写 `cordis.patch.yml`**

```yaml
# dsh-extra-paths bundle patch: ONE inserted row over the profile root, nothing
# disabled. Later layers (the user's profile cordis.patch.yml) may address this
# row by id; the plugin's own settings live in the dsh settings document.
- insert:
    - id: extra-paths
      name: 'dsh-extra-paths'
```

- [ ] **Step 7: 构建、类型检查、跑全量单测**

Run:
```bash
cd $REPO
pnpm run build:host
pnpm test
```
Expected: `lib/index.js` 等生成；所有单测 PASS。

- [ ] **Step 8: 装进 profile 并确认插件加载**

Run:
```bash
dsh plugin --profile <name> add $REPO
```
Expected: pnpm 添加 `link:` 依赖，`~/.dsh/profiles/<name>/package.json` 的 `dsh.profile.bundles` 末尾出现 `dsh-extra-paths`。

然后在 GUI 里新开一个会话（或在现有会话里继续），观察 host 日志无插件加载失败。若 HMR 未自动应用，重启 `dsh web`。

- [ ] **Step 9: M2 端到端验收（此时配置还是空的，先临时写入一条）**

把设置写进 `~/.dsh/settings.yaml` 的 `extra-paths` 段（Task 10 才会接上 settings；本步先验证**执法链路**下的行为，配置来自 entry config 的 fallback：临时在 `~/.dsh/profiles/<name>/cordis.patch.yml` 里给该行加 config）：

```yaml
- id: extra-paths
  config:
    paths:
      - $KB
```

Run（在与 GUI 同一个 DSH 进程的新会话里，用 agent 的两个工具分别验证）：
1. `write` 工具写 `$KB/.xpaths-probe.md` → **成功且无审批提示**；
2. `bash` 执行 `touch $KB/.xpaths-probe-2` → 成功（exit 0）；
3. `write` 工具写 `$PARENT/deepseek-harness/.xpaths-probe.md` → **被拒**且提示可升级；
4. 会话切 `read-only` 后重复第 1 步 → 被拒。

Expected: 1、2 成功；3、4 被拒。清理探针文件。

> 第 3、4 步失败（即被放行）说明匹配写反了：检查 `isUnder` 的参数顺序与 `grantFor` 的模式门槛。

- [ ] **Step 10: 提交**

```bash
git add src/listener.ts src/context.ts src/schema.ts src/index.ts cordis.patch.yml tests/context.test.ts
git commit -m "feat(host): internal/get interception, prompt visibility and load-time self-test"
```

---

## Task 10: 接通 settings 命名空间（M3 验收：改 YAML 即生效）

**Files:**
- Modify: `src/index.ts`（已含 settings 接线；本任务验证并补一个开发期诊断）
- Modify: `README.md`（创建，写配置说明）

- [ ] **Step 1: 从 profile 行的 config 里移除临时配置，改为 settings 文档**

编辑 `~/.dsh/profiles/<name>/cordis.patch.yml`，把 `- id: extra-paths` 那条覆盖删掉（或只留 `id`），让配置的唯一来源是 settings 文档。

- [ ] **Step 2: 写设置并确认 live 生效**

编辑 `~/.dsh/settings.yaml` 追加：

```yaml
extra-paths:
  paths:
    - $KB
```

Run: 在 GUI 现有会话里再次让 agent 用 `write` 工具写 `$KB/.xpaths-probe.md`。
Expected: 成功且无审批提示（保存即生效，无需重启）。

- [ ] **Step 3: 确认非法写入被拒（validate 生效）**

把 `paths` 改成 `- /`（文件系统根），保存。
Expected: 设置写入被拒绝并报错 `is a filesystem root and would disable the sandbox`；`~/.dsh/settings.yaml` 不落盘该值。

- [ ] **Step 4: 写 `README.md`**

````markdown
# dsh-extra-paths

让 DSH 对一组配置的外部路径**首次尝试即可写、无需审批**：既覆盖 `write`/`edit` 工具，也覆盖 `bash` 子进程；
提供 Web 设置页（设置 → 插件 → **Extra paths**）与"当前工作区解析出的生效根"预览。

## 安装

```bash
pnpm install && pnpm build
dsh plugin --profile <name> add $REPO
```

## 配置

设置文档 `~/.dsh/settings.yaml` 的 `extra-paths` 段（也可以只用设置页）：

```yaml
extra-paths:
  paths:
    - <工作根>/notes/home                      # 用默认 scope/surfaces
    - path: ../../notes/home                   # 相对路径按「会话工作区」解析
      scope: always-write
    - path: $PARENT/some-repo
      scope: write
      surfaces: [fs]                              # 只允许 write/edit 工具写
```

| scope | 会话 read-only | 会话 workspace-write |
|---|---|---|
| `write`（默认） | 拒绝 | 可写 |
| `always-write` | 可写 | 可写 |

`surfaces`：`fs` = `write`/`edit`/str-replace 工具；`shell` = `bash` 子进程。读与执行本来就不受沙箱限制。

## 已知边界

- 逐路径的"完全不受限"做不到：bash 沙箱是整次调用粒度。
- `ctx.get('fs'|'sandbox')` 这种读法不触发拦截（在树里只有未安装的 `terminal-bash` 这么读）。
- 相对路径按会话工作区解析，因此同一份配置在不同工作区指向不同目录——设置页的预览会显示实际解析结果。
- Windows 的 shell 侧不放行；`Always-write` 会削弱 `read-only` 急停按钮对该路径的作用。
- 写在工作区外的文件不会出现在 `deliverables` 的工作区变更卡片里。

## 机制

插件用 `ctx.on('internal/get', …)` 在服务被读取的瞬间返回透明 Proxy：`ctx.fs` 的包装把命中的额外根
翻译成一次调用的 per-call policy（`workspaceRoot` = 该根），`ctx.sandbox` 的包装按 runner 方言
（Seatbelt `(allow file-write* (subpath …))` / bwrap `--bind` / Landlock `--rw`）追加授权；不认识的方言
不改写并告警（fail closed）。设计文档见 `docs/superpowers/specs/2026-10-16-dsh-extra-paths-design.md`。
````

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: README with installation, configuration and known limits"
```

---

## Task 11: 预览路由（M4 验收）

**Files:**
- Create: `src/preview.ts`, `tests/preview.test.ts`

- [ ] **Step 1: 写 `buildPreview` 的失败测试 `tests/preview.test.ts`**

```ts
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { buildPreview, PREVIEW_PATH } from '../src/preview.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
mkdirSync(join(base, 'notes'))

it('exposes the route path', () => {
  expect(PREVIEW_PATH).toBe('/extra-paths/resolved')
})

it('reports per-entry resolution, the effective set and warnings', () => {
  const config = normalizeConfig({ paths: ['notes', 'nope'] })
  const preview = buildPreview(config, base)
  expect(preview.workspaceCwd).toBe(base)
  expect(preview.entries.map(entry => entry.status)).toEqual(['ok', 'missing'])
  expect(preview.effective).toEqual([join(base, 'notes')])
  expect(preview.warnings).toHaveLength(1)
})

it('rejects a missing cwd instead of guessing one', () => {
  expect(() => buildPreview(normalizeConfig({ paths: ['notes'] }), '')).toThrow('cwd is required')
})
```

- [ ] **Step 2: 实现 `src/preview.ts`**

```ts
/**
 * The settings page's effective-roots preview: one authenticated read-only
 * route that resolves the user's OWN configured entries for a workspace the
 * page supplies. It never probes arbitrary paths, and it computes through the
 * same `resolveRoots` the enforcement layers use.
 * @module dsh-extra-paths/preview
 */

import type { ExtraPathsConfig } from './config.js'
import { resolveRoots, type EntryResolution } from './resolve.js'

/** The single route this plugin owns. */
export const PREVIEW_PATH = '/extra-paths/resolved'

/** The preview payload. */
export interface PreviewResponse {
  readonly workspaceCwd: string
  readonly entries: readonly EntryResolution[]
  readonly effective: readonly string[]
  readonly warnings: readonly string[]
}

/**
 * Resolve the configuration for one workspace.
 * @param config - current configuration snapshot.
 * @param workspaceRoot - the workspace the page is asking about.
 * @returns the preview payload.
 * @throws {Error} when no workspace was supplied (the caller answers 400).
 */
export function buildPreview(config: ExtraPathsConfig, workspaceRoot: string | undefined): PreviewResponse {
  if (workspaceRoot === undefined || workspaceRoot.trim() === '') throw new Error('cwd is required')
  const report = resolveRoots(config, workspaceRoot)
  return {
    workspaceCwd: workspaceRoot,
    entries: report.entries,
    effective: report.roots.map(root => root.root),
    warnings: report.warnings,
  }
}

/** The route-registration context surface (webServer + connection). */
export interface PreviewRouteContext {
  webServer: {
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessageLike, res: ServerResponseLike) => void | Promise<void> }): () => void
  }
  connection: {
    requestRejection(request: unknown): number | undefined
  }
  effect(callback: () => () => void, label: string): unknown
}

/** Minimal node:http shapes (the plugin imports no core type for them). */
export interface IncomingMessageLike {
  readonly method?: string
  readonly url?: string
}
export interface ServerResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/**
 * Register the preview route on the calling fiber.
 * Optional capability: if the composition has no web carrier or no Connection
 * service, the caller never invokes this, and enforcement is unaffected.
 * @param ctx - a context that has both `webServer` and `connection`.
 * @param deps - configuration source and warning sink.
 */
export function registerPreviewRoute(
  ctx: PreviewRouteContext,
  deps: { readConfig(): ExtraPathsConfig; warn(message: string): void },
): void {
  const handler = async (req: IncomingMessageLike, res: ServerResponseLike): Promise<void> => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.writeHead(rejection)
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if ((req.method ?? 'GET') !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const body = JSON.stringify(buildPreview(deps.readConfig(), url.searchParams.get('cwd') ?? undefined))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    } catch (error) {
      deps.warn(`extra-paths: preview route failed: ${String(error)}`)
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String((error as Error).message ?? error))
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PREVIEW_PATH, handler }), 'extra-paths: preview route')
}
```

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run tests/preview.test.ts`
Expected: PASS。

- [ ] **Step 4: 重新构建并验证路由（鉴权 + 数据）**

Run:
```bash
cd $REPO
pnpm run build:host
pnpm test
```
然后在 GUI 会话里（或 `curl`）验证：

```bash
# 未认证：必须被 Connection 拒绝（不是 200）
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3080/extra-paths/resolved?cwd=$HOME/work"
```
Expected: `401`（或 `403`）——**绝不能是 200**；若返回 200，说明漏调了 `connection.requestRejection`。

- [ ] **Step 5: 提交**

```bash
git add src/preview.ts tests/preview.test.ts
git commit -m "feat(preview): authenticated effective-roots route over the shared resolver"
```

---

## Task 12: 客户端半边脚手架与构建产物契约

**Files:**
- Create: `src/client/index.tsx`, `src/client/styles.ts`
- Modify: `package.json`（若需要）

- [ ] **Step 1: 写最小客户端半边 `src/client/index.tsx`（先只注册一张卡片，验证契约）**

```tsx
/**
 * Client half: registers the Extra paths page into the Plugins settings
 * section. Every @deepseek-ai/* import here is TYPE-ONLY (erased): the runtime
 * services arrive through cordis, and react/@deepseek-ai/dsh-client-ui-settings
 * are resolved from the page's module table (see dsh.client in package.json).
 * @module dsh-extra-paths/client
 */

import * as React from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { styles } from './styles'

/** Client services this half needs. */
export const inject = ['slots', 'settingsScope']

/** Minimal client context surface (the real types come from the merges above). */
interface ClientContext {
  slots: {
    inject(key: string, callback: () => unknown): unknown
    register(options: { name: string; id: string; order?: number; label?: string }, component: () => unknown): () => void
  }
  /** Bound in Task 13; declared here so the inject list and the interface agree. */
  settingsScope: {
    bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): unknown
  }
}

/**
 * Client entry.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('plugins.item', () => ctx.slots.register(
    { name: 'plugins.item', id: 'extra-paths', order: 100, label: 'Extra paths' },
    () => React.createElement('div', { style: styles.page }, 'Extra paths'),
  ))
}
```

- [ ] **Step 2: 写 `src/client/styles.ts`（内联样式，避免给第三方 bundle 引一条 CSS 管线）**

```ts
/**
 * Inline style constants. The framework's own client preset compiles CSS
 * modules through workspace-internal tsdown plugins that a third-party package
 * cannot import, so this page carries its styles as plain objects instead.
 * @module dsh-extra-paths/client/styles
 */

import type * as React from 'react'

/** The page's style map. */
export const styles: Record<'page' | 'row' | 'path' | 'hint' | 'preview' | 'warn', React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' },
  row: { display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) auto auto auto auto', gap: 8, alignItems: 'center' },
  path: { fontFamily: 'var(--dsh-font-mono, monospace)' },
  hint: { opacity: 0.7, fontSize: 12, lineHeight: 1.5 },
  preview: { fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'var(--dsh-font-mono, monospace)' },
  warn: { color: 'var(--dsh-color-warning, #b45309)', fontSize: 12 },
}
```

- [ ] **Step 3: 构建并核对产物外壳与 external**

Run:
```bash
cd $REPO
pnpm run build:client
head -c 220 lib/client.js; echo; grep -c 'require("react")' lib/client.js
```
Expected: 产物以 `window.__ModuleLoader__.load({ id: "dsh-extra-paths", factory: (require) => {` 开头，且结尾为 `return module.exports; } });`；`require("react")` 至少出现 1 次（说明 react 被 external 而不是打包进来）。

- [ ] **Step 4: 在 GUI 里确认卡片出现**

重启 `dsh web`（或让 HMR 生效），打开 设置 → 插件。
Expected: 出现 **Extra paths** 卡片，点进去显示 "Extra paths" 占位内容。

> 若页面不出现：依次确认 ① `~/.dsh/profiles/<name>/package.json` 的 bundles 列表含 `dsh-extra-paths`；② 浏览器控制台无模块加载错误；③ `dsh.client.external` 含 `@deepseek-ai/dsh-client-ui-settings`（它是非基线 external，缺了会在构建期报 purity 错误或运行期 require 失败）。

- [ ] **Step 5: 提交**

```bash
git add src/client tsdown.config.ts package.json
git commit -m "feat(client): register the Extra paths page (contract verified end to end)"
```

---

## Task 13: 设置页主体（列表编辑 + 保存 + 预览）

**Files:**
- Create: `src/client/page.tsx`, `src/client/preview.ts`
- Modify: `src/client/index.tsx`

- [ ] **Step 1: 写 `src/client/preview.ts`（预览 fetch，失败降级）**

> 客户端半边的相对导入一律**不带扩展名**（`./page`、`./preview`）：客户端走 `moduleResolution: bundler` 由 tsdown 解析；
> Host 半边相反，必须写 `.js`（`nodenext` 要求显式扩展名）。不要互相"统一"。

```ts
/**
 * Preview transport. A missing route (older host half, or a composition
 * without the web carrier) degrades to `undefined` so the page renders its
 * configured rows without the resolved column.
 * @module dsh-extra-paths/client/preview
 */

/** One entry as the host resolved it. */
export interface PreviewEntry {
  readonly raw: string
  readonly resolved: string
  readonly scope: 'write' | 'always-write'
  readonly surfaces: readonly ('fs' | 'shell')[]
  readonly status: 'ok' | 'missing' | 'rejected'
}

/** The preview payload. */
export interface PreviewResult {
  readonly workspaceCwd: string
  readonly entries: readonly PreviewEntry[]
  readonly effective: readonly string[]
  readonly warnings: readonly string[]
}

const ROUTE = '/extra-paths/resolved'

/**
 * Fetch the effective roots for one workspace.
 * @param cwd - the workspace path to resolve against.
 * @param signal - optional abort signal.
 * @returns the preview, or undefined when the route is unavailable.
 */
export async function fetchPreview(cwd: string, signal?: AbortSignal): Promise<PreviewResult | undefined> {
  try {
    const response = await fetch(`${ROUTE}?cwd=${encodeURIComponent(cwd)}`, { signal, credentials: 'same-origin' })
    if (!response.ok) return undefined
    return await response.json() as PreviewResult
  } catch {
    return undefined
  }
}
```

- [ ] **Step 2: 写 `src/client/page.tsx`**

```tsx
/**
 * The Extra paths settings page: one row per configured path, staged edits, a
 * single atomic save of the `paths` field, and the host-resolved preview for
 * the workspace the user picks.
 * @module dsh-extra-paths/client/page
 */

import * as React from 'react'
import { styles } from './styles'
import { fetchPreview, type PreviewResult } from './preview'

type Scope = 'write' | 'always-write'
type Surface = 'fs' | 'shell'

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

/** Workspace list surface (optional: absent compositions lose only the preview). */
export interface WorkspaceListSurface {
  list?: { getSnapshot?: () => { items?: readonly { path?: string }[] } }
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
 * @param props - the bound settings scope, and the client context for optional services.
 */
export function ExtraPathsPage({ scope, workspaces }: { scope: PageScope; workspaces?: WorkspaceListSurface }): React.ReactElement {
  const snapshot = useSnapshot(scope)
  const [rows, setRows] = React.useState<Row[]>(() => rowsOf(snapshot.value))
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [preview, setPreview] = React.useState<PreviewResult | undefined>(undefined)
  const candidates = (workspaces?.list?.getSnapshot?.().items ?? [])
    .map(item => item.path)
    .filter((path): path is string => typeof path === 'string' && path !== '')
  const [cwd, setCwd] = React.useState<string | undefined>(candidates[0])

  // Adopt host changes only while the user has no staged edits.
  React.useEffect(() => {
    if (!dirty) setRows(rowsOf(snapshot.value))
  }, [snapshot, dirty])

  React.useEffect(() => {
    if (cwd === undefined) return
    let live = true
    void fetchPreview(cwd).then(result => { if (live) setPreview(result) })
    return () => { live = false }
  }, [cwd, snapshot])

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
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    void scope.set('paths', payloadOf(rows))
      .then(() => { setDirty(false) })
      .catch((cause: unknown) => { setError(String(cause)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <div style={styles.page}>
      {rows.map((row, index) => (
        <div style={styles.row} key={`${index}-${row.path}`}>
          <input
            style={styles.path}
            value={row.path}
            placeholder="~/projects/notes/home or ../../shared/notes"
            onChange={event => { update(index, { path: event.target.value }) }}
          />
          <select value={row.scope} onChange={event => { update(index, { scope: event.target.value as Scope }) }}>
            <option value="write">write</option>
            <option value="always-write">always-write</option>
          </select>
          <label>
            <input type="checkbox" checked={row.surfaces.includes('fs')} onChange={() => { toggleSurface(index, 'fs') }} />
            fs
          </label>
          <label>
            <input type="checkbox" checked={row.surfaces.includes('shell')} onChange={() => { toggleSurface(index, 'shell') }} />
            shell
          </label>
          <button type="button" onClick={() => { setDirty(true); setRows(current => current.filter((_, i) => i !== index)) }}>
            remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" onClick={() => { setDirty(true); setRows(current => [...current, { path: '', scope: 'write', surfaces: ['fs', 'shell'] }]) }}>
          add path
        </button>{' '}
        <button type="button" disabled={busy || !dirty} onClick={save}>{busy ? 'saving…' : 'save'}</button>
      </div>
      {error !== undefined && <div style={styles.warn}>{error}</div>}
      <div style={styles.hint}>
        相对路径按<strong>各会话的工作区</strong>解析，因此同一份配置在不同工作区指向不同目录。
        <code>write</code> 只在 workspace-write 下生效；<code>always-write</code> 在 read-only 下也生效。
      </div>
      {candidates.length > 1 && (
        <div>
          <select value={cwd} onChange={event => { setCwd(event.target.value) }}>
            {candidates.map(path => <option key={path} value={path}>{path}</option>)}
          </select>
        </div>
      )}
      {preview === undefined
        ? <div style={styles.hint}>预览不可用（宿主未提供路由或鉴权服务）。</div>
        : (
          <div style={styles.preview}>
            <div>生效根（workspace: {preview.workspaceCwd}）：</div>
            {preview.entries.map((entry, index) => (
              <div key={`${index}-${entry.raw}`}>
                {entry.raw} → {entry.resolved || '(unresolved)'} [{entry.status}]
              </div>
            ))}
            {preview.warnings.map(warning => <div style={styles.warn} key={warning}>{warning}</div>)}
          </div>
        )}
    </div>
  )
}
```

- [ ] **Step 3: 改 `src/client/index.tsx` 绑定 scope 并渲染页面**

```tsx
/**
 * Client half: contributes the Extra paths configuration page to the settings
 * dialog twice — as a `settings.section` nav row (the settings sidebar) and as
 * the plugin's card in 设置 → 插件 (`settings.plugin.item`, keyed by the settings
 * namespace the card edits).
 *
 * Both slot keys and shapes come from the RUNNING DSH version's own official
 * occupant (`dsh-client-ui-settings-plugins/lib/client.js` + its published
 * `slot-contract.d.ts`), never from a newer checkout: 0.1.6 renamed the card
 * slot to `plugins.item` with an `id`/`order`/`label` shape, and a registration
 * into a key no mounted entry declares simply never fires (no error, no page).
 *
 * Every @deepseek-ai/* import here is TYPE-ONLY (erased): the runtime services
 * arrive through cordis, and react/dsh-client-ui-settings resolve from the
 * page's module table (see dsh.client in package.json).
 * @module dsh-extra-paths/client
 */

import * as React from 'react'
// Type-only: documents where `ctx.settingsScope` comes from. `@deepseek-ai/dsh-client-ui-slots`
// is deliberately NOT imported — the installed app does not carry its types (the page's
// module table provides it at runtime), and this file declares the surface it uses anyway.
import type {} from '@deepseek-ai/dsh-client-ui-settings'
import { ExtraPathsPage, type PageScope, type WorkspaceListSurface } from './page'

/** Client services this half needs. */
export const inject = ['slots', 'settingsScope']

/** The settings namespace this page edits — the one the host half registers. */
export const NAMESPACE = 'extra-paths'

/** Minimal client context surface (the real types come from the merges above). */
interface ClientContext {
  get(name: string, strict?: boolean): unknown
  slots: {
    inject(key: string, callback: () => unknown): unknown
    register(options: Record<string, unknown>, component: () => unknown): () => void
  }
  settingsScope: {
    bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): PageScope
  }
}

/**
 * Client entry.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
  // `workspaces` is optional: without it the page loses only the preview.
  const workspaces = ctx.get('workspaces', false) as WorkspaceListSurface | undefined
  // Never hand an optional prop an explicit `undefined`: that is an error under
  // `exactOptionalPropertyTypes`, which the host tsconfig turns on.
  const props = (): { scope: PageScope } | { scope: PageScope; workspaces: WorkspaceListSurface } =>
    workspaces === undefined ? { scope } : { scope, workspaces }
  const page = (): React.ReactElement => React.createElement(ExtraPathsPage, props())

  // A nav row in the settings dialog's left column (`settings.section`), and the
  // same page as this plugin's card in 设置 → 插件 (`settings.plugin.item`, keyed
  // by the settings namespace the card edits).
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
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NAMESPACE,
    locale: NAMESPACE,
    inject: props,
  }, page))
}
```

- [ ] **Step 4: 类型检查、构建、GUI 验收**

Run:
```bash
cd $REPO
pnpm run typecheck
pnpm run build:client
```
Expected: 类型检查通过；`lib/client.js` 重新生成。

GUI 验收（设置 → 插件 → Extra paths）：
1. 新增一行 `<工作根>/notes/home`，scope=`write`，两个 surface 都勾 → `save`；
2. 页面刷新后该行仍在（说明写进了 settings 文档，且 `~/.dsh/settings.yaml` 可见）；
3. 预览区显示 `<工作根>/notes/home → $KB [ok]`；
4. 新增一行相对路径 `../../notes/home` → 预览显示解析后的绝对路径（随上面选择的工作区变化）；
5. 删掉一行 → save → 预览与 `~/.dsh/settings.yaml` 同步；
6. 输入 `/` → save → 被拒绝并显示错误。

- [ ] **Step 5: 提交**

```bash
git add src/client
git commit -m "feat(client): editable path table with live save and resolved-root preview"
```

---

## Task 14: 全量验收、构建产物与仓库交付（M6）

**Files:**
- Modify: `README.md`（如验收中发现偏差）

- [ ] **Step 1: 跑 7 条 GUI 验收**

逐条执行并在下方记录结果（全部通过才算完成）：

1. [ ] `write` 工具写 `<工作根>/notes/home/x.md` → 成功且**无审批提示**
2. [ ] `bash` 执行 `touch <工作根>/notes/home/x2` → 成功（exit 0）
3. [ ] 相对路径条目 + 预览解析结果与实际授权一致
4. [ ] 会话切 `read-only`：`write` 条目被拒（提示可升级），`always-write` 条目仍可写
5. [ ] 未配置路径（`$PARENT/deepseek-harness/x.md`）仍被拒且仍可升级
6. [ ] `surfaces: [fs]` 条目：`write` 工具可写、`bash` 不可写
7. [ ] 配置清空 → 立即恢复原状（live，无需重启）

清理所有探针文件。

- [ ] **Step 2: 全量单测 + 类型检查 + 构建**

Run:
```bash
cd $REPO
pnpm test
pnpm run typecheck
pnpm run build
```
Expected: 单测全绿；类型检查无错；`lib/index.js`、`lib/client.js`、`lib/types/**` 均生成。

- [ ] **Step 3: 确认 `lib/` 按设计提交（安装方式是"按路径 add"）**

Run:
```bash
git status --short
git check-ignore -v lib/index.js || echo "lib/ is NOT ignored (correct)"
```
Expected: `lib/` 未被 `.gitignore` 忽略。

- [ ] **Step 4: 提交构建产物与验收记录**

```bash
git add -A
git commit -m "build: ship lib/ artifacts for path-based installation

Verified GUI acceptance (7/7): fs write without approval, bash write,
relative-path preview, read-only semantics, unconfigured paths still denied,
surfaces filtering, live clear."
```

- [ ] **Step 5: 绑定远程并交接推送（凭据在用户侧）**

```bash
git remote add origin https://github.com/0x7a76/dsh-extra-paths.git
git branch -M main
git log --oneline | head -20
git remote -v
```

Expected: 本地历史完整、远程已绑定。

**推送给用户执行**（凭据由本机 `credential.helper` 提供，无需把 token 贴进对话）：

```bash
cd $REPO && git push -u origin main
```

> 远程必须是**空仓库**（在 GitHub 上创建时不要勾选初始化 README / .gitignore / License），否则首次 push 会因历史不相关被拒。

---

## 自检记录（写计划时逐项核对）

**1. 覆盖设计文档的每一节**

| 设计文档章节 | 落到的任务 |
|---|---|
| §3.2 机制（internal/get + 透明 Proxy） | Task 7、8、9 |
| §3.3 组件（listener/wrappers/纯核心） | Task 2–9 |
| §3.4 运行时依赖策略 + 加载期自检 | Task 1（peer 类型表、唯一依赖）、Task 9 Step 5（自检） |
| §4 配置模型与 scope 语义 | Task 2、3、4、5 |
| §4.5 保存时校验 | Task 2（`validateConfig`）、Task 10 Step 3 |
| §5.1 fs 策略翻译 | Task 5（`syntheticPolicy`）、Task 7 |
| §5.2 shell 方言追加 | Task 6、8 |
| §5.3 system-prompt 可见性 | Task 9（`renderExtraPathsContext` + 注册） |
| §6.1/6.2 设置页与 client 契约 | Task 12、13 |
| §6.3/6.4 预览通路与安全 | Task 11、13 |
| §7 失败模式 | Task 7（无 policy→委托）、Task 8（未知方言→不改写+告警）、Task 9（自检告警）、Task 11（400/500）、Task 13（预览降级） |
| §8 测试与 7 条验收 | Task 2–8、11 单测；Task 14 Step 1 |
| §9 交付与安装 | Task 1、14 |
| §11 里程碑 M1–M6 | Task 1–6（M1）、7–9（M2）、10（M3）、11（M4）、12–13（M5）、14（M6） |

**2. 占位符扫描**：无 TODO/TBD；每个代码步骤都给了完整代码；每条验收都给了命令与期望结果。
**3. 类型一致性**：`ExtraPathsConfig`/`PathEntry`/`ResolvedRoot`/`EntryResolution`/`PolicyLike`/`FsInnerLike`/`SandboxInnerLike`/`ConfinedArgvLike`/`ListenerState` 在 Task 2–9 定义后，Task 10–13 只引用不重定义；`PREVIEW_PATH`、`SETTINGS_NAMESPACE`、`resolveRoots`、`grantFor`、`syntheticPolicy`、`widenArgv`、`isUnder`、`normalizeConfig`、`validateConfig` 名称全程一致。
**5. 质量审查提出的两条跨任务要求（已写进对应任务的代码，不要退回去）**：
- **Task 4**：过宽根的告警必须是"**包含**家目录"而非"等于家目录"——`~/..` 会规范化成 `/Users`（比 `~` 更宽）却原本不告警；`homedir()` 的规范化已提到循环外（每次执法决策都会走这里，不能每条目重复 realpath）。
- **Task 9/10**：**入口 config 是不可信输入**——`cordis.patch.yml` 里一个 YAML 笔误（如 `paths:` 空值）原本会在 `apply()` 抛错，导致 GUI 起不来，违反"软失败"承诺；现在统一走 `safeEntryConfig()`（告警 + 退回文档化空配置），且该值同时用于 live 快照与 settings 的 `base` 层。

**4. 与设计文档的两处有意细化（不改语义）**：
- 设置页只暴露 `paths` 一个字段（单字段写入 = 单次原子、revision 栅栏），`defaultScope`/`defaultSurfaces` 仍由 schema 支持、可直接写 YAML，但页面不暴露——换取保存的原子性与实现简单。
- `lib/` 按设计提交进仓库（安装方式是"按绝对路径 add"）。
