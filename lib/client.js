window.__ModuleLoader__.load({
	id: "dsh-extra-paths",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** English copy — the fallback locale for every non-Chinese UI language. */
		const en = {
			navLabel: "Extra writable paths",
			summaryLoading: "Extra writable paths: loading…",
			summaryUnavailable: "Extra writable paths: not offered by this host",
			summaryEmpty: "Extra writable paths: not configured yet",
			summaryCount: "Extra writable paths: {count} saved · writing needs no approval",
			introCollapsed: "Extra writable paths outside the workspace, writable without approval; edit them line by line.",
			expand: "Show details",
			collapse: "Hide details",
			introBefore: "These paths stay writable outside the session workspace, ",
			introNoApproval: "without approval",
			introAfter: "; each rule's access level and surfaces decide what the write tools and the terminal may do.",
			introRuleBefore: "Relative spellings resolve against the base workspace; enforcement uses ",
			introRuleEmphasis: "each session's own workspace",
			introRuleAfter: ", so one configuration points at different directories in different sessions. deny/read rules win over writable ones.",
			baseWorkspace: "Base workspace",
			notSelected: "(none selected)",
			basePlaceholder: "Absolute path (drive letters / UNC included), or start with ~/",
			manualBase: "Type a path",
			pickBase: "Pick from list",
			baseHint: "Preview and inline resolution only",
			baseForeign: "This host cannot express that base path (platform mismatch); the same configuration still works on a matching host.",
			baseWaiting: "Waiting for the host platform facts (first preview)…",
			save: "Save",
			saving: "Saving…",
			dirty: "Unsaved changes",
			synced: "In sync with the configuration",
			textMode: "Text mode",
			textModeHint: "One rule per line: path | access | surfaces. The last two may be omitted — they then inherit the defaults shown below. Expand \"Examples and supported forms\" for the common spellings.",
			editorDefaults: "Omitted fields use: access = {access}, surfaces = {surfaces} (from the config document: defaultAccess / defaultSurfaces).",
			examplesTitle: "Examples and supported forms",
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
			textModeInvalid: "The text has errors and was not applied:",
			textErrorAtLine: "Line {line}: ",
			textErrorEmptyPath: "the path must not be empty",
			textErrorUnknownAccess: "unknown access level \"{value}\" (use deny, read, write or always-write)",
			textErrorUnknownSurfaces: "unknown surfaces \"{value}\" (use fs, shell or fs+shell)",
			textErrorTooManyFields: "too many fields (at most path | access | surfaces)",
			accessDeny: "Deny access",
			accessRead: "Read-only",
			accessWrite: "Writable (follows session)",
			accessAlways: "Always writable",
			statusOk: "active",
			statusMissing: "missing",
			statusRejected: "rejected",
			statusForeign: "not applicable on this host",
			resolveBaseInvalid: "The base workspace must be absolute (a drive or UNC path on Windows too) or start with ~/; a relative path cannot be the base",
			nameRuleHint: "Name rule: matches this component at any depth under the workspace and all configured writable roots — fs tools only; bash is not restricted by it (use a **/<name> path pattern if bash must be covered)",
			nameRuleMatches: "{count} matches right now",
			nameRuleNoMatches: "No matches right now (it still applies to paths created later)",
			previewTitle: "Resolution preview",
			previewDirty: " (including unsaved changes)",
			previewEffective: "{count} effective writable roots",
			previewReadOnly: "{count} read-only",
			previewDenied: "{count} denied",
			previewNoBase: "Choose or type a base workspace above and the host's effective roots appear here.",
			previewBadBase: "The base workspace must be absolute or start with ~/; a relative path cannot be the base.",
			previewExpandingHome: "Expanding ~: the host home directory arrives with the first preview.",
			previewUnavailable: "Preview unavailable (the host did not offer the route, the connection is not ready, or it rejected the base workspace).",
			previewEmpty: "Nothing to resolve yet.",
			unresolved: "(unresolved)",
			capabilityShellLimit: "The shell sandbox on this host ({dialect}) cannot enforce deny/read rules: bash will not honor them, but the fs tools still enforce them.",
			saveRefused: "The host refused the save: this configuration may be overridden by a home patch or a command-line overlay (the settings page only writes the profile cordis.patch.yml). Remove the same-id override from ~/.dsh/cordis.patch.yml, or edit the profile patch and restart."
		};
		/** Simplified Chinese copy. */
		const zh = {
			navLabel: "额外可写路径",
			summaryLoading: "额外可写路径：读取中…",
			summaryUnavailable: "额外可写路径：宿主未提供该设置",
			summaryEmpty: "额外可写路径：尚未配置",
			summaryCount: "额外可写路径：{count} 条 · 保存即生效，写入无需审批",
			introCollapsed: "工作区之外的额外可写路径，写入无需审批；支持按行批量编辑。",
			expand: "展开",
			collapse: "收起",
			introBefore: "这些路径在会话工作区之外也可以写，",
			introNoApproval: "不需要审批",
			introAfter: "；访问级别与「作用面」决定写工具和终端各自的行为。",
			introRuleBefore: "相对路径按「基准工作区」解析——执法时用的是",
			introRuleEmphasis: "各会话自己的工作区",
			introRuleAfter: "，所以同一份配置在不同会话会指向不同目录。deny/只读规则优先于可写规则。",
			baseWorkspace: "基准工作区",
			notSelected: "（未选择）",
			basePlaceholder: "绝对路径（含 Windows 盘符/UNC），或以 ~/ 开头",
			manualBase: "手填",
			pickBase: "从列表选",
			baseHint: "仅用于预览与行内解析",
			baseForeign: "当前宿主无法表达这个基准路径（平台不匹配）；同一份配置在匹配的宿主上仍然可用。",
			baseWaiting: "正在等待宿主返回平台信息（首次预览）…",
			save: "保存",
			saving: "保存中…",
			dirty: "有未保存的修改",
			synced: "已与配置同步",
			textMode: "文本模式",
			textModeHint: "每行一条规则：路径 | 访问级别 | 作用面。后两段可省略，省略时使用下方显示的默认值。展开「示例与支持的写法」查看常用形式。",
			editorDefaults: "省略字段时的默认值：访问级别 = {access}，作用面 = {surfaces}（来自配置文档的 defaultAccess / defaultSurfaces）。",
			examplesTitle: "示例与支持的写法",
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
			textModeInvalid: "文本有误，尚未应用：",
			textErrorAtLine: "第 {line} 行：",
			textErrorEmptyPath: "路径不能为空",
			textErrorUnknownAccess: "未知的访问级别「{value}」（可用 deny、read、write、always-write）",
			textErrorUnknownSurfaces: "未知的作用面「{value}」（可用 fs、shell、fs+shell）",
			textErrorTooManyFields: "字段过多（最多 path | access | surfaces 三段）",
			accessDeny: "禁止访问",
			accessRead: "只读",
			accessWrite: "可写（随会话）",
			accessAlways: "始终可写",
			statusOk: "生效",
			statusMissing: "缺失",
			statusRejected: "已拒绝",
			statusForeign: "当前平台不适用",
			resolveBaseInvalid: "基准工作区需要绝对路径（含 Windows 盘符/UNC），或以 ~/ 开头；相对路径不能当基准用",
			nameRuleHint: "名称规则：工作区与所有可写根内任意深度匹配（仅 fs 工具；bash 不受此规则约束；要让 bash 也生效请改用 **/<名字> 模式）",
			nameRuleMatches: "当前匹配 {count} 处",
			nameRuleNoMatches: "当前暂无匹配（对新建路径仍生效）",
			previewTitle: "解析预览",
			previewDirty: "（含未保存修改）",
			previewEffective: "生效根 {count} 条",
			previewReadOnly: "只读 {count} 条",
			previewDenied: "禁止 {count} 条",
			previewNoBase: "先在上面选择或填写「基准工作区」，这里就会显示宿主解析出的生效根。",
			previewBadBase: "基准工作区需要绝对路径，或以 ~/ 开头；相对路径不能当基准用。",
			previewExpandingHome: "正在展开 ~：宿主的家目录会在第一次预览返回后给出。",
			previewUnavailable: "预览不可用（宿主没提供该路由、连接还没就绪，或基准工作区被宿主拒绝）。",
			previewEmpty: "还没有可解析的路径。",
			unresolved: "（未解析）",
			capabilityShellLimit: "当前 shell 沙箱（{dialect}）无法执行「禁止访问/只读」规则：bash 不受该限制，但 fs 工具仍按规则拦截。",
			saveRefused: "保存被宿主拒绝：该配置可能被 home patch 或命令行覆盖（设置页只写 profile 的 cordis.patch.yml）。请删掉 ~/.dsh/cordis.patch.yml 里同 id 的覆盖，或直接改 profile patch 后重启。"
		};
		/** Fill `{name}` placeholders; unknown names stay verbatim, like the host seat. */
		function format(template, params) {
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
		}
		/**
		* The built-in translate function: Chinese copy, `{name}` placeholders.
		* Used when the host supplies no locale seat (0.1.5 slots, unit tests).
		*/
		const fallbackTranslate = (key, params) => format(zh[key], params);
		//#endregion
		//#region src/platform.ts
		/** The default WSL drive mount root. */
		const DEFAULT_WSL_MOUNT_ROOT = "/mnt";
		/** Extended-length prefix `\\?\` (and `\\?\UNC\`). */
		const EXTENDED_PREFIX = /^\\\\\?\\/;
		const EXTENDED_UNC_PREFIX = /^\\\\\?\\UNC\\/i;
		/** `C:\` or `C:/` — a drive-rooted absolute path. */
		const WIN_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
		/** `C:foo` — drive-RELATIVE (resolved against that drive's current directory). */
		const WIN_DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;
		/** `\\server\share\x` — a UNC path (two leading backslashes, a server name). */
		const WIN_UNC = /^\\\\[^\\]/;
		/** `//server/share/x` — UNC spelled with forward separators. */
		const WIN_UNC_FORWARD = /^\/\/[^/]+\/[^/]+/;
		/** A single leading separator that is neither `\\` nor `/`: `\foo` (current drive). */
		const WIN_CURRENT_DRIVE = /^\\(?!\\)/;
		/** Strip a Windows extended-length prefix, which only adds noise to comparison. */
		function stripWindowsPrefix(spelling) {
			if (EXTENDED_UNC_PREFIX.test(spelling)) return `\\\\${spelling.slice(8)}`;
			if (EXTENDED_PREFIX.test(spelling)) return spelling.slice(4);
			return spelling;
		}
		/** The logical host dialect. */
		function hostDialect(facts) {
			return facts.platform === "win32" ? "windows" : "posix";
		}
		/**
		* Classify one spelling without consulting the host.
		* @param spelling - the raw configured spelling (trimmed by the caller).
		* @returns what kind of path it is.
		*/
		function classifySpelling(spelling) {
			if (spelling === "~") return "home";
			if (spelling.startsWith("~/")) return "home";
			if (spelling.startsWith("~\\")) return "windows-home";
			const stripped = stripWindowsPrefix(spelling);
			if (WIN_DRIVE_ABSOLUTE.test(stripped) || WIN_UNC.test(stripped)) return "windows-absolute";
			if (WIN_UNC_FORWARD.test(stripped)) return "windows-absolute";
			if (WIN_DRIVE_RELATIVE.test(stripped)) return "windows-drive-relative";
			if (spelling.startsWith("/")) return "posix-absolute";
			if (WIN_CURRENT_DRIVE.test(stripped)) return "windows-current-drive";
			return "relative";
		}
		/**
		* Whether a spelling is a BARE NAME (`.git`, `.env`, `node_modules`): one path
		* component, no separator, no wildcard, not the `.`/`..` relative specials and
		* not a `~` spelling. A bare name is a NAME RULE — it matches that component at
		* any depth under the rule's scope roots rather than naming one literal path.
		*
		* The `./name` spelling is the escape hatch for a literal single-component
		* relative path (it contains a separator, so it stays a normal relative path).
		* @param spelling - the raw configured spelling.
		* @returns true when the spelling is a name rule.
		*/
		function isBareNameSpelling(spelling) {
			if (spelling === "" || spelling === "." || spelling === "..") return false;
			if (spelling.startsWith("~")) return false;
			if (spelling.includes("*")) return false;
			if (/^[A-Za-z]:/.test(spelling)) return false;
			return !spelling.includes("/") && !spelling.includes("\\");
		}
		/**
		* Whether a spelling is absolute in its own dialect (a `~` spelling counts:
		* the caller expands home first).
		* @param spelling - the raw configured spelling.
		* @returns true for home, POSIX-absolute and Windows-absolute spellings.
		*/
		function isAbsoluteSpelling(spelling) {
			const kind = classifySpelling(spelling);
			return kind === "home" || kind === "windows-home" || kind === "posix-absolute" || kind === "windows-absolute";
		}
		/** Collapse `.`, `..` and duplicate separators in an absolute POSIX spelling. */
		function collapsePosix(path) {
			const segments = [];
			for (const segment of path.split("/")) {
				if (segment === "" || segment === ".") continue;
				if (segment === "..") {
					segments.pop();
					continue;
				}
				segments.push(segment);
			}
			return `/${segments.join("/")}`;
		}
		/**
		* Collapse an absolute Windows spelling (drive or UNC) into its native form.
		* The result uses `\` separators; case is preserved (Windows comparison folds
		* case later, but the host's `realpath`/ACL layers still want the real spelling).
		* @param path - an absolute Windows spelling using either separator.
		* @returns the collapsed spelling, e.g. `C:\Users\me\x` or `\\server\share\x`.
		*/
		function collapseWindows(path) {
			const stripped = stripWindowsPrefix(path).replaceAll("/", "\\");
			if (WIN_UNC.test(stripped)) {
				const parts = stripped.slice(2).split("\\");
				const server = parts.shift() ?? "";
				const share = parts.shift() ?? "";
				const rest = collapseWindowsSegments(parts);
				return `\\\\${server}\\${share}${rest === "" ? "" : `\\${rest}`}`;
			}
			return `${stripped.slice(0, 2)}\\${collapseWindowsSegments(stripped.slice(2).split("\\"))}`;
		}
		/** Collapse one segment list, clamping `..` at the start. */
		function collapseWindowsSegments(segments) {
			const out = [];
			for (const segment of segments) {
				if (segment === "" || segment === ".") continue;
				if (segment === "..") {
					out.pop();
					continue;
				}
				out.push(segment);
			}
			return out.join("\\");
		}
		/** Join a home directory and a `~`-relative rest in the host's dialect. */
		function homeJoin(home, rest, dialect) {
			const trimmed = rest.replace(dialect === "windows" ? /^[\\/]+/ : /^\/+/, "");
			if (trimmed === "") return dialect === "windows" ? collapseWindows(home) : collapsePosix(home);
			return dialect === "windows" ? collapseWindows(`${home}\\${trimmed}`) : collapsePosix(`${home}/${trimmed}`);
		}
		/** Resolve a relative spelling against the workspace base in one dialect. */
		function resolveRelative(base, spelling, dialect) {
			if (dialect === "windows") return collapseWindows(`${base}\\${spelling}`);
			return collapsePosix(`${base}/${spelling}`);
		}
		/** Build a `foreign` outcome: the spelling has no meaning on this host. */
		function foreign(reason) {
			return {
				ok: false,
				foreign: reason
			};
		}
		/**
		* Translate a Windows absolute spelling into its WSL spelling.
		* @param spelling - a drive-rooted or UNC spelling (any separator).
		* @param mountRoot - the WSL mount root, normally `/mnt`.
		* @returns the POSIX spelling, or undefined for a share UNC path (no mapping).
		*/
		function windowsToWsl(spelling, mountRoot = DEFAULT_WSL_MOUNT_ROOT) {
			const stripped = stripWindowsPrefix(spelling).replaceAll("\\", "/");
			const drive = /^([A-Za-z]):(?:\/|$)/.exec(stripped);
			if (drive === null) return void 0;
			const letter = (drive[1] ?? "").toLowerCase();
			const rest = stripped.slice(drive[0].length);
			const root = mountRoot.replace(/\/+$/, "");
			const tail = rest.replace(/^\/+/, "");
			return tail === "" ? `${root}/${letter}` : `${root}/${letter}/${tail}`;
		}
		/**
		* Translate a POSIX spelling that names a Windows drive into its Windows form.
		* Two conventions are recognized: WSL's `/mnt/<letter>/…` and the MSYS/git-bash
		* `/c/…` form. The caller verifies the result by resolving it (existence is the
		* only proof that the drive really exists on this host).
		* @param spelling - an absolute POSIX spelling.
		* @param mountRoot - the WSL drive mount root, normally `/mnt`.
		* @returns the Windows spelling, or undefined when the spelling is not a drive.
		*/
		function posixToWindows(spelling, mountRoot = DEFAULT_WSL_MOUNT_ROOT) {
			const root = mountRoot.replace(/\/+$/, "");
			const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const mounted = new RegExp(`^${escape(root)}/([A-Za-z])(?:/(.*))?$`).exec(spelling);
			if (mounted !== null) return windowsFromParts(mounted[1] ?? "", mounted[2]);
			const msys = /^\/([A-Za-z])(?:\/(.*))?$/.exec(spelling);
			if (msys !== null) return windowsFromParts(msys[1] ?? "", msys[2]);
		}
		/** Assemble a Windows drive path from a drive letter and a `/`-separated rest. */
		function windowsFromParts(letter, rest) {
			const drive = letter.toUpperCase();
			return rest === void 0 || rest === "" ? `${drive}:\\` : `${drive}:\\${rest.replaceAll("/", "\\")}`;
		}
		/**
		* Resolve one configured spelling to a HOST-NATIVE absolute path.
		*
		* Translation happens only when the spelling's dialect differs from the host's:
		* a Windows spelling inside WSL becomes `/mnt/<drive>/…`, a `/mnt/<drive>/…`
		* spelling on a native Windows host becomes `<Drive>:\…`. A spelling with no
		* mapping on this host is `foreign`: the caller marks the entry inactive with a
		* warning instead of failing the whole configuration.
		* @param spelling - the configured spelling (already trimmed).
		* @param workspaceRoot - the session workspace a relative spelling resolves against.
		* @param facts - host platform facts.
		* @returns the host-native absolute path, or the reason it is foreign.
		*/
		function expandPath(spelling, workspaceRoot, facts) {
			const dialect = hostDialect(facts);
			switch (classifySpelling(spelling)) {
				case "home": return {
					ok: true,
					path: homeJoin(facts.home, spelling.slice(1), dialect),
					dialect,
					translated: false
				};
				case "windows-home":
					if (dialect === "windows") return {
						ok: true,
						path: homeJoin(facts.home, spelling.slice(1), dialect),
						dialect,
						translated: false
					};
					return foreign(`the Windows home spelling ${JSON.stringify(spelling)} is only understood on a Windows host`);
				case "posix-absolute":
					if (dialect === "posix") return {
						ok: true,
						path: collapsePosix(spelling),
						dialect,
						translated: false
					};
					{
						const mapped = posixToWindows(spelling, facts.wslMountRoot);
						if (mapped !== void 0) return {
							ok: true,
							path: collapseWindows(mapped),
							dialect,
							translated: true
						};
						return foreign(`the POSIX path ${JSON.stringify(spelling)} cannot be expressed on a Windows host`);
					}
				case "windows-absolute":
					if (dialect === "windows") return {
						ok: true,
						path: collapseWindows(spelling),
						dialect,
						translated: false
					};
					if (facts.wsl) {
						const mapped = windowsToWsl(spelling, facts.wslMountRoot);
						if (mapped !== void 0) return {
							ok: true,
							path: collapsePosix(mapped),
							dialect,
							translated: true
						};
						return foreign(`the UNC path ${JSON.stringify(spelling)} has no reliable WSL mapping`);
					}
					return foreign(`the Windows path ${JSON.stringify(spelling)} is only understood on a Windows host or inside WSL`);
				case "windows-drive-relative": return foreign(`the drive-relative spelling ${JSON.stringify(spelling)} is ambiguous and refused`);
				case "windows-current-drive":
					if (dialect === "windows") return foreign(`the current-drive spelling ${JSON.stringify(spelling)} is ambiguous and refused`);
					return {
						ok: true,
						path: resolveRelative(workspaceRoot, spelling, dialect),
						dialect,
						translated: false
					};
				default: return {
					ok: true,
					path: resolveRelative(workspaceRoot, spelling, dialect),
					dialect,
					translated: false
				};
			}
		}
		//#endregion
		//#region src/client/paths.ts
		/** All access levels, in the order the dropdown offers them (strict → permissive). */
		const ACCESSES = [
			"deny",
			"read",
			"write",
			"always-write"
		];
		/** All enforcement surfaces. */
		const SURFACES = ["fs", "shell"];
		/** The plugin's default surfaces when a stored entry does not say. */
		const DEFAULT_SURFACES = ["fs", "shell"];
		function accessOf(value) {
			return typeof value === "string" && ACCESSES.includes(value) ? value : void 0;
		}
		function surfacesOf(value) {
			if (!Array.isArray(value)) return void 0;
			const surfaces = [];
			for (const item of value) {
				if (typeof item !== "string" || !SURFACES.includes(item)) continue;
				if (!surfaces.includes(item)) surfaces.push(item);
			}
			return surfaces.length > 0 ? surfaces : void 0;
		}
		/**
		* The defaults a stored section declares, with the legacy `defaultScope` alias
		* and the plugin defaults as fallbacks.
		* @param section - the stored section, when the host has one.
		* @returns access + surfaces to use for entries that omit them.
		*/
		function defaultsOf(section) {
			return {
				access: accessOf(section?.defaultAccess) ?? accessOf(section?.defaultScope) ?? "write",
				surfaces: surfacesOf(section?.defaultSurfaces) ?? [...DEFAULT_SURFACES]
			};
		}
		/**
		* Turn a stored section into editable rows. Accepts every shape the host half
		* still accepts: a bare string (the defaults apply), an entry with `access`, and
		* the legacy `scope` (mapped onto the same vocabulary). Unknown vocabulary falls
		* back to the defaults instead of crashing the page — the save-time validator is
		* where an invalid document is reported.
		* @param section - the stored section.
		* @returns the editable rows in stored order.
		*/
		function rowsOf(section) {
			const defaults = defaultsOf(section);
			const rows = [];
			for (const item of section?.paths ?? []) {
				if (typeof item === "string") {
					rows.push({
						path: item,
						access: defaults.access,
						surfaces: [...defaults.surfaces]
					});
					continue;
				}
				if (item === null || typeof item !== "object") continue;
				rows.push({
					path: typeof item.path === "string" ? item.path : "",
					access: accessOf(item.access) ?? accessOf(item.scope) ?? defaults.access,
					surfaces: surfacesOf(item.surfaces) ?? [...defaults.surfaces]
				});
			}
			return rows;
		}
		/**
		* Serialise the rows into the structured payload the page saves and previews.
		* Empty paths (a row just added and not typed into yet) are dropped, matching
		* the host's own "path must be a non-empty string" rule.
		* @param rows - the editable rows.
		* @returns `{path, access, surfaces}` objects with trimmed paths.
		*/
		function payloadOf(rows) {
			const payload = [];
			for (const row of rows) {
				const path = row.path.trim();
				if (path === "") continue;
				payload.push({
					path,
					access: row.access,
					surfaces: [...row.surfaces]
				});
			}
			return payload;
		}
		/** The canonical `+`-joined surface spelling (`fs+shell`). */
		function surfacesText(surfaces) {
			return SURFACES.filter((surface) => surfaces.includes(surface)).join("+");
		}
		/**
		* Render one rule in the EXPLICIT text form: `path | access | surfaces`.
		*
		* The editor deliberately does not omit values that happen to equal the plugin
		* defaults: the user configured those fields in the list view and expects to
		* see them when switching to text mode (a bare `path` looked like the access
		* and surface settings had been lost). Explicit output also round-trips
		* independent of any future default change. The parser still accepts the short
		* forms (`path`, `path | access`) when hand-typing.
		* @param row - one rule.
		* @returns one text-mode line.
		*/
		function formatRule(row) {
			return `${row.path.trim()} | ${row.access} | ${surfacesText(row.surfaces)}`;
		}
		/**
		* Render the current rows for the text-mode editor.
		* @param rows - the current rows.
		* @returns one explicit line per non-empty rule.
		*/
		function serializeRules(rows) {
			return rows.filter((row) => row.path.trim() !== "").map(formatRule).join("\n");
		}
		/** Parse the optional `| surfaces` field (`fs`, `shell`, `fs+shell`, also `shell+fs`). */
		function parseSurfacesField(value) {
			const parts = value.split(/[+,\s]+/).filter((part) => part !== "");
			const surfaces = [];
			for (const part of parts) {
				if (!SURFACES.includes(part)) return void 0;
				if (!surfaces.includes(part)) surfaces.push(part);
			}
			const ordered = SURFACES.filter((surface) => surfaces.includes(surface));
			return ordered.length > 0 ? ordered : void 0;
		}
		/**
		* Parse the bulk text editor. Blank lines and lines whose first non-space
		* character is `#` are comments/separators and are skipped. A line is
		* `path`, `path | access`, or `path | access | surfaces`.
		* @param text - the editor content.
		* @param defaults - the defaults a missing access/surfaces field inherits.
		* @returns the parsed rules, or every per-line error (nothing is applied then).
		*/
		function parseRules(text, defaults = defaultsOf(void 0)) {
			const rules = [];
			const errors = [];
			text.split(/\r?\n/).forEach((line, index) => {
				const lineNo = index + 1;
				const trimmed = line.trim();
				if (trimmed === "" || trimmed.startsWith("#")) return;
				const fields = trimmed.split("|").map((field) => field.trim());
				if (fields.length > 3) {
					errors.push({
						line: lineNo,
						code: "too-many-fields"
					});
					return;
				}
				const path = fields[0] ?? "";
				if (path === "") {
					errors.push({
						line: lineNo,
						code: "empty-path"
					});
					return;
				}
				let access = defaults.access;
				if (fields.length >= 2) {
					const parsed = accessOf(fields[1]);
					if (parsed === void 0) {
						errors.push({
							line: lineNo,
							code: "unknown-access",
							value: fields[1] ?? ""
						});
						return;
					}
					access = parsed;
				}
				let surfaces = [...defaults.surfaces];
				if (fields.length === 3) {
					const parsed = parseSurfacesField(fields[2] ?? "");
					if (parsed === void 0) {
						errors.push({
							line: lineNo,
							code: "unknown-surfaces",
							value: fields[2] ?? ""
						});
						return;
					}
					surfaces = parsed;
				}
				rules.push({
					path,
					access,
					surfaces
				});
			});
			return errors.length > 0 ? {
				ok: false,
				errors
			} : {
				ok: true,
				rules
			};
		}
		/**
		* Whether a configured spelling is a NAME RULE (`.git`, `.env`, `node_modules`):
		* one component, no separator, matched at ANY depth under the session workspace
		* and every configured writable root. It is not a path, so it has no lexical
		* resolution — the host matches it live per call and reports a match count for
		* the preview.
		*
		* The spelling vocabulary is shared with the host half through `../platform`
		* (pure string functions). The node-only rule engine (`../name-rule`) must never
		* be imported here: this module is bundled into the browser client.
		* @param path - the raw configured spelling.
		* @returns true when the host treats the entry as a name rule.
		*/
		function isNameRulePath(path) {
			return isBareNameSpelling(path.trim());
		}
		/** The POSIX-ish fallback used before the host reports its real platform. */
		const FALLBACK_FACTS = Object.freeze({
			platform: "unknown",
			wsl: false,
			wslMountRoot: "/mnt",
			home: ""
		});
		/**
		* Build the path facts from a preview payload. Before the first preview there
		* are no facts: the page then assumes a POSIX host for its instant hint and
		* refuses to claim ANY Windows spelling resolves (it waits for the host's platform facts).
		* @param preview - the preview payload, when one has arrived.
		* @returns the facts plus a flag saying whether they came from the host.
		*/
		function hostViewOf(preview) {
			const report = preview?.platform;
			if (report === void 0) return {
				facts: FALLBACK_FACTS,
				known: false
			};
			return {
				known: true,
				facts: {
					platform: report.platform,
					wsl: report.wsl,
					wslMountRoot: report.wslMountRoot ?? "/mnt",
					home: preview?.home ?? ""
				}
			};
		}
		/**
		* Resolve the base-workspace field the way the host will. The field accepts an
		* absolute spelling in the HOST's dialect (`C:\…`, `\\server\share\…`), a `~`
		* spelling, and nothing relative.
		* @param spelling - the raw field value.
		* @param host - the host facts view.
		* @returns the host-native absolute base, or why it cannot be used.
		*/
		function resolveBase(spelling, host) {
			const trimmed = spelling.trim();
			if (trimmed === "") return {
				ok: false,
				problem: "empty"
			};
			const kind = classifySpelling(trimmed);
			if (kind === "home" || kind === "windows-home") {
				if (host.facts.home === "") return {
					ok: false,
					problem: "waiting"
				};
			} else if (kind === "windows-absolute") {
				if (!host.known) return {
					ok: false,
					problem: "waiting"
				};
			} else if (!isAbsoluteSpelling(trimmed)) return {
				ok: false,
				problem: "relative"
			};
			const outcome = expandPath(trimmed, "", host.facts);
			if (outcome.ok) return {
				ok: true,
				base: outcome.path
			};
			if (!host.known) return {
				ok: false,
				problem: "waiting"
			};
			return {
				ok: false,
				problem: "foreign",
				reason: outcome.foreign
			};
		}
		/**
		* Which base spelling to send with the preview request.
		*
		* Normally it is the resolved host-native base. While the page still waits for
		* the platform facts it sends the RAW absolute spelling instead: the HOST is the
		* one that knows its dialect, so it accepts `C:\…` on Windows, `/mnt/c/…` in
		* WSL and `~` anywhere (expanding it with the real home directory). Without this
		* a Windows workspace candidate would leave the page waiting for facts forever —
		* it refuses to claim the Windows base resolves, but the host can prove it.
		* Relative/empty spellings are never sent (the host rejects them anyway).
		* @param spelling - the raw base field value.
		* @param base - the lexical base outcome.
		* @returns the query value, or '' when there is nothing usable to ask about.
		*/
		function previewBaseOf(spelling, base) {
			if (base.ok) return base.base;
			const trimmed = spelling.trim();
			if (base.problem === "waiting" && isAbsoluteSpelling(trimmed)) return trimmed;
			return "";
		}
		//#endregion
		//#region src/client/preview.ts
		const ROUTE = "/extra-paths/resolved";
		/**
		* Fetch the host's answer for one workspace.
		*
		* The unsaved rows travel with the request so the answer describes the DRAFT:
		* previously the preview only ever described the stored document, which is what
		* made configuring a relative path a guess-until-you-save exercise.
		* @param cwd - the (host-native, absolute) workspace path to resolve against.
		* @param paths - the page's current rows as `{path, access, surfaces}`.
		* @param signal - optional abort signal.
		* @returns the preview, or undefined when the route is unavailable.
		*/
		async function fetchPreview(cwd, paths, signal) {
			try {
				const query = new URLSearchParams({ cwd });
				if (paths !== void 0) query.set("paths", JSON.stringify(paths));
				const response = await fetch(`${ROUTE}?${query.toString()}`, {
					signal,
					credentials: "same-origin"
				});
				if (!response.ok) return void 0;
				return await response.json();
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/styles.ts
		const box = { boxSizing: "border-box" };
		const button = {
			...box,
			padding: "4px 10px",
			borderRadius: 6,
			border: "1px solid var(--dsh-color-border, rgba(128,128,128,0.35))",
			background: "transparent",
			color: "inherit",
			fontSize: 12,
			cursor: "pointer"
		};
		({ ...box });
		/** The page's style map. */
		const styles = {
			page: {
				display: "flex",
				flexDirection: "column",
				gap: 10,
				padding: "4px 0",
				maxWidth: 860
			},
			introLine: {
				display: "flex",
				gap: 6,
				alignItems: "baseline",
				flexWrap: "wrap"
			},
			intro: {
				fontSize: 12,
				lineHeight: 1.6,
				opacity: .75
			},
			label: {
				fontSize: 12,
				fontWeight: 600,
				opacity: .8,
				whiteSpace: "nowrap"
			},
			baseRow: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			},
			baseField: {
				...box,
				width: 380,
				maxWidth: "100%",
				height: 30
			},
			toolbar: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			},
			textEditor: {
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			examples: {
				...box,
				fontSize: 12
			},
			examplesSummary: {
				cursor: "pointer",
				opacity: .75,
				userSelect: "none"
			},
			examplesBody: {
				...box,
				margin: "6px 0 0",
				padding: "8px 10px",
				maxHeight: 260,
				overflow: "auto",
				border: "1px solid var(--dsh-color-border, rgba(128,128,128,0.25))",
				borderRadius: 8,
				background: "var(--dsh-color-surface-secondary, rgba(128,128,128,0.06))",
				fontFamily: "var(--dsh-font-mono, monospace)",
				fontSize: 11.5,
				lineHeight: 1.55,
				whiteSpace: "pre",
				opacity: .9
			},
			textarea: {
				...box,
				width: "100%",
				minHeight: 220,
				padding: "8px 10px",
				borderRadius: 8,
				border: "1px solid var(--dsh-color-border, rgba(128,128,128,0.35))",
				background: "transparent",
				color: "inherit",
				fontFamily: "var(--dsh-font-mono, monospace)",
				fontSize: 12,
				lineHeight: 1.6,
				resize: "vertical"
			},
			textErrors: {
				display: "flex",
				flexDirection: "column",
				gap: 2
			},
			capability: {
				...box,
				padding: "8px 10px",
				borderRadius: 8,
				border: "1px solid var(--dsh-color-warning, #b45309)",
				background: "var(--dsh-color-warning-soft, rgba(180,83,9,0.08))",
				fontSize: 12,
				lineHeight: 1.5
			},
			panel: {
				...box,
				display: "flex",
				flexDirection: "column",
				gap: 6,
				padding: "8px 10px",
				border: "1px solid var(--dsh-color-border, rgba(128,128,128,0.25))",
				borderRadius: 8
			},
			panelHead: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
				fontSize: 12,
				fontWeight: 600,
				opacity: .8
			},
			panelHeadRight: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				whiteSpace: "nowrap",
				fontWeight: 400
			},
			entry: {
				display: "flex",
				gap: 6,
				alignItems: "baseline",
				flexWrap: "wrap",
				fontSize: 12
			},
			code: {
				fontFamily: "var(--dsh-font-mono, monospace)",
				fontSize: 12,
				wordBreak: "break-all"
			},
			dim: {
				opacity: .6,
				fontSize: 12,
				lineHeight: 1.5
			},
			warn: {
				color: "var(--dsh-color-warning, #b45309)",
				fontSize: 12,
				lineHeight: 1.5
			},
			danger: {
				color: "var(--dsh-color-danger, #b91c1c)",
				fontSize: 12,
				lineHeight: 1.5
			},
			statusOk: { color: "var(--dsh-color-success, #15803d)" },
			statusMissing: { color: "var(--dsh-color-warning, #b45309)" },
			statusRejected: { color: "var(--dsh-color-danger, #b91c1c)" },
			statusForeign: {
				color: "var(--dsh-color-text-secondary, inherit)",
				opacity: .7
			},
			button
		};
		/**
		* Interactive states cannot live in a style OBJECT (there is no `:focus` key),
		* and the shell's default focus ring is a heavy black outline on these fields.
		* One small stylesheet, scoped by the `xp-` prefix, supplies a friendly accent
		* ring plus hover feedback; the inline styles above stay the source of truth for
		* everything static.
		*/
		const css = `
.xp-input, .xp-select {
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsh-color-border, rgba(128,128,128,0.35));
  background: transparent;
  color: inherit;
  font-size: 13px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.xp-input:hover, .xp-select:hover, .xp-textarea:hover { border-color: var(--dsh-color-border-strong, rgba(128,128,128,0.6)); }
.xp-input:focus, .xp-select:focus, .xp-textarea:focus { outline: none; }
.xp-input:focus-visible, .xp-select:focus-visible, .xp-textarea:focus-visible {
  outline: none;
  border-color: var(--dsh-color-accent, #2f6fd0);
  box-shadow: 0 0 0 2px var(--dsh-color-accent-soft, rgba(47,111,208,0.25));
}
.xp-input::placeholder, .xp-textarea::placeholder { color: currentColor; opacity: 0.38; }
.xp-textarea {
  box-sizing: border-box;
  border: 1px solid var(--dsh-color-border, rgba(128,128,128,0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.xp-button {
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsh-color-border, rgba(128,128,128,0.35));
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.xp-button:hover:not(:disabled) { background: var(--dsh-color-hover, rgba(128,128,128,0.12)); }
.xp-button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsh-color-accent-soft, rgba(47,111,208,0.25)); }
.xp-button:disabled { opacity: 0.45; cursor: default; }
.xp-button-on { border-color: var(--dsh-color-accent, #2f6fd0); background: var(--dsh-color-accent-soft, rgba(47,111,208,0.15)); }
.xp-link { border: none; background: none; padding: 2px 4px; opacity: 0.7; font-size: 12px; cursor: pointer; color: inherit; }
.xp-link:hover { opacity: 1; text-decoration: underline; }

/* One column template for a rule row (the row component is kept for tests and
   compositions; the page itself edits plain text). */
  display: grid;
  grid-template-columns: 10px 150px minmax(0, 1fr) 66px 96px 22px;
  column-gap: 8px;
  align-items: center;
}
/* One control height for every cell; the previous flex row mixed 26px buttons
   with 31px inputs, so nothing sat on one baseline. */
.xp-toolbar .xp-button { height: 28px; display: inline-flex; align-items: center; }

/* Preview entries share their own template: status / access / spelling → resolution. */
.xp-entry {
  display: grid;
  grid-template-columns: 62px 116px minmax(0, 1fr);
  column-gap: 8px;
  align-items: baseline;
  font-size: 12px;
}
.xp-entry-paths { display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
`;
		//#endregion
		//#region src/client/page.tsx
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
		/**
		* Marker carried by a refusal raised in the late-bound scope. The page maps it
		* to localized copy instead of showing the scope's internal message.
		*/
		const SAVE_REFUSED_CODE = "extra-paths/save-refused";
		/**
		* Message carried by that marker error (Chinese). The page shows the localized
		* `saveRefused` copy; this text only reaches logs/tests.
		*/
		const SAVE_REFUSED_MESSAGE = zh.saveRefused;
		/** Build the refusal error the page recognizes. */
		function saveRefusedError() {
			const error = new Error(SAVE_REFUSED_MESSAGE);
			error.code = SAVE_REFUSED_CODE;
			return error;
		}
		/** Whether a rejected save is the host refusing the write. */
		function isSaveRefused(cause) {
			return cause?.code === SAVE_REFUSED_CODE;
		}
		const NOOP_HOOK = () => void 0;
		const IDENTITY = (snapshot) => snapshot;
		const ACCESS_LABEL = {
			deny: "accessDeny",
			read: "accessRead",
			write: "accessWrite",
			"always-write": "accessAlways"
		};
		const STATUS_LABEL = {
			ok: "statusOk",
			missing: "statusMissing",
			rejected: "statusRejected",
			foreign: "statusForeign"
		};
		const STATUS_STYLE = {
			ok: styles.statusOk,
			missing: styles.statusMissing,
			rejected: styles.statusRejected,
			foreign: styles.statusForeign
		};
		const TEXT_ERROR_LABEL = {
			"empty-path": "textErrorEmptyPath",
			"unknown-access": "textErrorUnknownAccess",
			"unknown-surfaces": "textErrorUnknownSurfaces",
			"too-many-fields": "textErrorTooManyFields"
		};
		function itemsOf(value) {
			const items = value?.items;
			return Array.isArray(items) ? items : [];
		}
		/**
		* Localized one-line message for a rejected text-mode line.
		* @param tr - the host's translate seat (or the Chinese fallback).
		* @param error - one parser error with its 1-based line number.
		* @returns `第 n 行：…` / `Line n: …`.
		*/
		function textErrorMessage(tr, error) {
			const params = error.value === void 0 ? void 0 : { value: error.value };
			return `${tr("textErrorAtLine", { line: error.line })}${tr(TEXT_ERROR_LABEL[error.code], params)}`;
		}
		/**
		* The tooltip of a NAME RULE row: what the spelling means, plus — once the
		* host's preview has walked the scope roots — how many paths currently match
		* (zero is a valid answer: the rule still applies to paths created later).
		* @param tr - the host's translate seat (or the Chinese fallback).
		* @param hostEntry - the host's preview entry for this row, when it has arrived.
		* @returns the localized one-line explanation.
		*/
		function nameRuleText(tr, hostEntry) {
			const hint = tr("nameRuleHint");
			const matches = hostEntry?.matches;
			if (matches === void 0) return hint;
			return `${hint} · ${matches > 0 ? tr("nameRuleMatches", { count: matches }) : tr("nameRuleNoMatches")}`;
		}
		/**
		* Whether the shell surface cannot enforce a configured restriction on this host.
		* Before the host reports capabilities (undefined) nothing is claimed.
		* @param capabilities - the host's shell capability matrix.
		* @param rows - the current rules.
		* @returns true when a deny/read rule targets a shell that cannot honor it.
		*/
		function needsShellLimitWarning(capabilities, rows) {
			if (capabilities === void 0) return false;
			if (!rows.some((row) => (row.access === "deny" || row.access === "read") && row.surfaces.includes("shell"))) return false;
			return !capabilities.shellReadDeny || !capabilities.shellWriteDeny;
		}
		/**
		* The honesty banner: a deny/read rule that targets `shell` on a dialect that
		* cannot subtract permissions (landlock, Windows ACL) is still enforced for the
		* fs tools — but bash will not honor it. The page must say that out loud.
		* @param props - capability matrix, current rules and the translate seat.
		*/
		function CapabilityBanner({ capabilities, rows, t }) {
			const tr = t ?? fallbackTranslate;
			if (!needsShellLimitWarning(capabilities, rows)) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.capability,
				role: "status",
				children: tr("capabilityShellLimit", { dialect: capabilities?.shellDialect ?? "unknown" })
			});
		}
		/**
		* The rule editor: the syntax hint, the live defaults line, the collapsible
		* examples, a monospace textarea and per-line errors. It owns NO action — Save
		* lives in the page toolbar and parses the whole draft (all-or-nothing), so the
		* editor can never disagree with the stored configuration.
		* @param props - editor content, parser errors, defaults copy and the change hook.
		*/
		function TextModeEditor({ tr, value, errors, defaultsText, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.textEditor,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.dim,
						children: tr("textModeHint")
					}),
					defaultsText === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.dim,
						children: defaultsText
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						style: styles.examples,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
							style: styles.examplesSummary,
							children: tr("examplesTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							style: styles.examplesBody,
							children: tr("examplesBody")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "xp-textarea",
						style: styles.textarea,
						rows: 12,
						spellCheck: false,
						value,
						"aria-label": tr("textMode"),
						onChange: (event) => {
							onChange?.(event.target.value);
						}
					}),
					errors !== void 0 && errors.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.textErrors,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.warn,
							children: tr("textModeInvalid")
						}), errors.map((error) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.warn,
							children: textErrorMessage(tr, error)
						}, `${error.line}-${error.code}`))]
					}) : null
				]
			});
		}
		/** Why the base field cannot be used yet, localized (undefined when it is fine). */
		function baseProblemText(tr, base) {
			if (base.ok) return void 0;
			switch (base.problem) {
				case "empty": return;
				case "relative": return tr("resolveBaseInvalid");
				case "waiting": return tr("baseWaiting");
				case "foreign": return tr("baseForeign");
			}
		}
		/**
		* The host's resolution report, collapsed by default: the text editor is the
		* main view, and the preview is the authoritative detail when the user wants it.
		* @param props - expansion state, the base outcome, the preview payload and dirty flag.
		*/
		function PreviewPanel({ tr, expanded, onToggle, typedBase, base, preview, dirty }) {
			const writable = preview?.writable ?? preview?.effective ?? [];
			const readOnly = preview?.readOnly ?? [];
			const denied = preview?.denied ?? [];
			let body;
			if (typedBase === "") body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.dim,
				children: tr("previewNoBase")
			});
			else if (!base.ok) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.dim,
				children: base.problem === "relative" ? tr("previewBadBase") : base.problem === "waiting" ? tr("previewExpandingHome") : tr("baseForeign")
			});
			else if (preview === void 0) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.dim,
				children: tr("previewUnavailable")
			});
			else if (preview.entries.length === 0 && readOnly.length === 0 && denied.length === 0) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.dim,
				children: tr("previewEmpty")
			});
			else body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				preview.entries.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "xp-entry",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: STATUS_STYLE[entry.status],
							children: [
								"[",
								tr(STATUS_LABEL[entry.status]),
								"]"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.dim,
							children: entry.access === void 0 ? "" : tr(ACCESS_LABEL[entry.access])
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "xp-entry-paths",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									style: styles.code,
									children: entry.raw
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.dim,
									children: "→"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									style: styles.code,
									children: entry.resolved !== "" ? entry.resolved : isNameRulePath(entry.raw) ? nameRuleText(tr, entry) : tr("unresolved")
								})
							]
						})
					]
				}, `${index}-${entry.raw}`)),
				readOnly.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.entry,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.dim,
						children: tr("previewReadOnly", { count: readOnly.length })
					}), readOnly.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: styles.code,
						children: path
					}, path))]
				}) : null,
				denied.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.entry,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: styles.dim,
						children: tr("previewDenied", { count: denied.length })
					}), denied.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: styles.code,
						children: path
					}, path))]
				}) : null,
				preview.warnings.map((warning) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: styles.warn,
					children: warning
				}, warning))
			] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.panel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.panelHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [tr("previewTitle"), dirty ? tr("previewDirty") : ""] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: styles.panelHeadRight,
						children: [preview === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.dim,
							children: tr("previewEffective", { count: writable.length })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "xp-link",
							onClick: onToggle,
							children: expanded ? tr("collapse") : tr("expand")
						})]
					})]
				}), expanded ? body : null]
			});
		}
		function useSnapshot(scope) {
			const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
			react.useEffect(() => scope.subscribe(() => {
				setSnapshot(scope.getSnapshot());
			}), [scope]);
			return snapshot;
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
		function ExtraPathsSummary({ scope, t }) {
			const translate = t ?? fallbackTranslate;
			const { status, value } = useSnapshot(scope);
			const rows = rowsOf(value).filter((row) => row.path.trim() !== "");
			const text = status === "loading" ? translate("summaryLoading") : status === "unavailable" ? translate("summaryUnavailable") : rows.length === 0 ? translate("summaryEmpty") : translate("summaryCount", { count: rows.length });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: styles.dim,
				children: text
			});
		}
		/**
		* Render the page.
		* @param props - the bound settings scope, the host's translate seat, the
		* standard workspace hook, and the lazy fallback used when the composition
		* supplies no standard props.
		*/
		function ExtraPathsPage({ scope, t, getWorkspaces, useWorkspaces }) {
			const tr = t ?? fallbackTranslate;
			const snapshot = useSnapshot(scope);
			const fromHook = itemsOf((useWorkspaces ?? NOOP_HOOK)(IDENTITY));
			const candidates = (fromHook.length > 0 ? fromHook : itemsOf(getWorkspaces?.()?.list?.getSnapshot?.())).map((item) => item.path).filter((path) => typeof path === "string" && path !== "");
			const defaults = defaultsOf(snapshot.value);
			const [rows, setRows] = react.useState(() => rowsOf(snapshot.value));
			const [text, setText] = react.useState(() => serializeRules(rowsOf(snapshot.value)));
			const [dirty, setDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(void 0);
			const [textErrors, setTextErrors] = react.useState(void 0);
			const [preview, setPreview] = react.useState(void 0);
			const [cwd, setCwd] = react.useState(() => candidates[0] ?? "");
			const [cwdPinned, setCwdPinned] = react.useState(false);
			const [manualBase, setManualBase] = react.useState(false);
			const [introExpanded, setIntroExpanded] = react.useState(false);
			const [previewExpanded, setPreviewExpanded] = react.useState(false);
			react.useEffect(() => {
				if (dirty) return;
				const nextRows = rowsOf(snapshot.value);
				const parsed = parseRules(text, defaultsOf(snapshot.value));
				const sameAsStored = parsed.ok && JSON.stringify(payloadOf(parsed.rules)) === JSON.stringify(payloadOf(nextRows));
				setRows(nextRows);
				if (!sameAsStored) {
					setText(serializeRules(nextRows));
					setTextErrors(void 0);
				}
			}, [
				snapshot,
				dirty,
				text
			]);
			const first = candidates[0];
			react.useEffect(() => {
				if (!cwdPinned && cwd === "" && first !== void 0) setCwd(first);
			}, [
				cwdPinned,
				cwd,
				first
			]);
			const base = resolveBase(cwd, hostViewOf(preview));
			const previewBase = previewBaseOf(cwd, base);
			const request = JSON.stringify(payloadOf(rows));
			react.useEffect(() => {
				if (previewBase === "") {
					setPreview(void 0);
					return;
				}
				let live = true;
				const timer = setTimeout(() => {
					const draft = JSON.parse(request);
					fetchPreview(previewBase, draft).then((result) => {
						if (live) setPreview(result);
					});
				}, 250);
				return () => {
					live = false;
					clearTimeout(timer);
				};
			}, [
				previewBase,
				request,
				snapshot
			]);
			/**
			* Edit the one text form. A parse failure is reported per line and the last
			* VALID rows stay in place for the preview; Save refuses until it parses.
			*/
			const change = (value) => {
				setDirty(true);
				setText(value);
				setError(void 0);
				const parsed = parseRules(value, defaults);
				if (parsed.ok) {
					setRows(parsed.rules);
					setTextErrors(void 0);
				} else setTextErrors(parsed.errors);
			};
			/**
			* The page's only action: parse the whole text (all-or-nothing) and write the
			* structured `paths` array. A host refusal keeps the text intact.
			*/
			const save = () => {
				const parsed = parseRules(text, defaults);
				if (!parsed.ok) {
					setTextErrors(parsed.errors);
					return;
				}
				setBusy(true);
				setError(void 0);
				scope.set("paths", payloadOf(parsed.rules)).then((accepted) => {
					if (accepted === false) setError(tr("saveRefused"));
					else {
						setRows(parsed.rules);
						setDirty(false);
						setTextErrors(void 0);
					}
				}).catch((cause) => {
					setError(isSaveRefused(cause) ? tr("saveRefused") : cause instanceof Error ? cause.message : String(cause));
				}).finally(() => {
					setBusy(false);
				});
			};
			const picker = !manualBase && candidates.length > 0;
			const known = candidates.includes(cwd.trim());
			const baseNotice = baseProblemText(tr, base);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: css }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.introLine,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.intro,
							children: tr("introCollapsed")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "xp-link",
							onClick: () => {
								setIntroExpanded(!introExpanded);
							},
							children: introExpanded ? tr("collapse") : tr("expand")
						})]
					}),
					introExpanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.intro,
						children: [
							tr("introBefore"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: tr("introNoApproval") }),
							tr("introAfter"),
							tr("introRuleBefore"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: tr("introRuleEmphasis") }),
							tr("introRuleAfter")
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.baseRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.label,
								children: tr("baseWorkspace")
							}),
							picker ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "xp-select",
								style: styles.baseField,
								value: known ? cwd.trim() : "",
								onChange: (event) => {
									setCwdPinned(true);
									setCwd(event.target.value);
								},
								children: [known ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: cwd.trim(),
									children: cwd.trim() === "" ? tr("notSelected") : cwd.trim()
								}), candidates.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: path,
									children: path
								}, path))]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "xp-input",
								style: styles.baseField,
								value: cwd,
								placeholder: tr("basePlaceholder"),
								onChange: (event) => {
									setCwdPinned(true);
									setCwd(event.target.value);
								}
							}),
							candidates.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "xp-link",
								onClick: () => {
									setCwdPinned(true);
									setManualBase(!manualBase);
								},
								children: picker ? tr("manualBase") : tr("pickBase")
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.dim,
								children: tr("baseHint")
							})
						]
					}),
					baseNotice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.dim,
						children: baseNotice
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "xp-toolbar",
						style: styles.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "xp-button xp-button-on",
							disabled: busy || !dirty,
							onClick: save,
							children: busy ? tr("saving") : tr("save")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.dim,
							children: dirty ? tr("dirty") : tr("synced")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityBanner, {
						capabilities: preview?.capabilities,
						rows,
						t: tr
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextModeEditor, {
						tr,
						value: text,
						errors: textErrors,
						defaultsText: tr("editorDefaults", {
							access: defaults.access,
							surfaces: defaults.surfaces.join("+")
						}),
						onChange: change
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.danger,
						children: error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreviewPanel, {
						tr,
						expanded: previewExpanded,
						onToggle: () => {
							setPreviewExpanded(!previewExpanded);
						},
						typedBase: cwd.trim(),
						base,
						preview,
						dirty
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client half: contributes the Extra paths configuration page to the settings
		* dialog and to the plugin manager.
		*
		* THREE ENTRY POINTS, ONE PAGE — and the plugin manager asks for two different
		* views of it. `view: 'summary'` is the one-liner it lays out in its list;
		* anything else is the editor (`view: 'page'` on the entry's own page). Ignoring
		* that split is what used to render the whole form inline in the plugin list,
		* under the built-in plugins group, and pushed everything else off screen.
		*
		* - `settings.section` — a nav row in the settings dialog's left column. Declared
		*   by both host generations, so this is the entry point that always exists.
		* - 0.2.x `plugins.row.config` — a KEYED slot spelled `<bundle name>#<entry id>`.
		*   Our own row inside the `dsh-extra-paths` bundle gains a 配置 control that
		*   opens this page in the plugin manager. Present in every 0.2.x release
		*   (checked against 0.2.0-rc.2 and 0.2.1-rc.5).
		* - 0.1.5 `settings.plugin.item` — the keyed card of the older settings dialog,
		*   keyed by the settings namespace.
		*
		* The 0.2.x `plugins.item` slot is deliberately NOT registered: the shipped
		* contract reserves it for the host's own plugins ("用于官方插件", rendered in the
		* 内置插件配置 group). A third-party bundle belongs on its own row instead.
		*
		* TWO HOST GENERATIONS, ONE SCOPE. The settings scope this page edits moved in
		* 0.2.0: `ctx.settingsScope` (0.1.5) is gone and replaced by `ctx.configForms`
		* — which however exposes the SAME three methods the page was written against
		* (`getSnapshot`/`subscribe`/`set`). So the page keeps its narrow `PageScope`
		* interface and this file supplies whichever implementation the running host
		* has, through a late-bound proxy: the scope may not exist yet when the plugin
		* activates, and listing an absent service in `inject` would leave the plugin
		* waiting forever.
		*
		* Slot keys, register shapes and the module table were taken from the RUNNING
		* version's own official occupants (`dsh-client-ui-settings-agent-loop`,
		* `dsh-client-ui-settings-shell`) and their published contracts. A slot key that
		* nothing declares is inert under `ctx.slots.inject` (the callback never runs),
		* which is what lets one build register into both generations.
		*
		* LOCALIZED COPY FOLLOWS THE HOST'S OWN LANGUAGE SELECTION. The client half
		* registers its `zh`/`en` dictionaries under this plugin's namespace through
		* `ctx.locale.register`, and every slot registration declares `locale: NAMESPACE`
		* so the renderer hands each page render the framework `t` seat. Switching
		* Settings → General → Language therefore switches this page too, without a
		* reload; languages without a dictionary fall back to English (the host's
		* documented baseline), and a host without a locale seat (0.1.5 slots, tests)
		* falls back to the built-in Chinese copy.
		*
		* Every @deepseek-ai/* import here is TYPE-ONLY (erased): the runtime services
		* arrive through cordis, and react resolves from the page's module table
		* (see dsh.client in package.json).
		* @module dsh-extra-paths/client
		*/
		/**
		* Client services this half needs.
		*
		* `locale` ships in every supported host generation and backs the framework `t`
		* seat; the settings scope itself is fetched late-bound below, because the
		* 0.1.5 (`settingsScope`) and 0.2.x (`configForms`) providers differ and an
		* `inject` entry for a service that never appears would block activation.
		*/
		const inject = ["slots", "locale"];
		/** The settings namespace this page edits — the one the host half registers. */
		const NAMESPACE = "extra-paths";
		/**
		* The plugin manager's key for our row: `<bundle name>#<entry id>`.
		*
		* The bundle name is the package name and the row id is the entry this repo's
		* `cordis.patch.yml` inserts; `tests/client-slots.test.ts` pins it against both
		* files so a rename cannot silently detach the config control.
		*/
		const ROW_KEY = "dsh-extra-paths#extra-paths";
		/**
		* A `PageScope` that forwards to whichever real scope arrives.
		*
		* Subscribers are held here rather than on the real scope so a page that mounted
		* before the service appeared still repaints once it does.
		* @returns a stable scope plus its attach hook.
		*/
		function lateBoundScope() {
			const listeners = /* @__PURE__ */ new Set();
			let real;
			let unsubscribe;
			const notify = () => {
				for (const listener of [...listeners]) listener();
			};
			return {
				scope: {
					getSnapshot: () => real?.getSnapshot() ?? {
						status: "loading",
						value: void 0
					},
					subscribe: (listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					set: (field, value) => {
						if (real === void 0) return Promise.resolve();
						return real.set(field, value).then((accepted) => {
							if (accepted === false) throw saveRefusedError();
							return accepted;
						});
					}
				},
				attach: (next) => {
					if (next === void 0) return;
					unsubscribe?.();
					real = next;
					unsubscribe = next.subscribe(notify);
					notify();
				}
			};
		}
		/**
		* Client entry.
		* @param ctx - the client context.
		*/
		function apply(ctx) {
			const { scope, attach } = lateBoundScope();
			const registerLocales = () => ctx.locale.register(NAMESPACE, {
				zh,
				en
			});
			if (typeof ctx.effect === "function") ctx.effect(registerLocales, "extra-paths: locales");
			else registerLocales();
			const t = ctx.locale.bind(NAMESPACE);
			ctx.inject(["settingsScope"], (child) => {
				const { settingsScope } = child;
				attach(settingsScope.bind({ namespace: NAMESPACE }));
			});
			ctx.inject(["configForms"], (child) => {
				const { configForms } = child;
				attach({
					getSnapshot: () => configForms.get(NAMESPACE).getSnapshot(),
					subscribe: (listener) => configForms.get(NAMESPACE).subscribe(listener),
					set: (field, value) => configForms.get(NAMESPACE).set(field, value)
				});
			});
			const getWorkspaces = () => ctx.get("workspaces", false);
			const props = () => ({
				scope,
				getWorkspaces
			});
			/** The editor, forwarding the shell's workspace hook when the slot carries one. */
			const renderPage = (slotProps) => react.createElement(ExtraPathsPage, {
				scope,
				t: typeof slotProps?.t === "function" ? slotProps.t : void 0,
				getWorkspaces,
				useWorkspaces: typeof slotProps?.useWorkspaces === "function" ? slotProps.useWorkspaces : void 0
			});
			/** The slot component: one line for `summary`, the editor for every other view. */
			const card = (slotProps) => slotProps?.view === "summary" ? react.createElement(ExtraPathsSummary, {
				scope,
				t: typeof slotProps.t === "function" ? slotProps.t : void 0
			}) : renderPage(slotProps);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: NAMESPACE,
				order: 40,
				label: () => t("navLabel"),
				locale: NAMESPACE,
				inject: props
			}, card));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NAMESPACE,
				locale: NAMESPACE,
				inject: props
			}, card));
			const registerRow = () => ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
				name: "plugins.row.config",
				key: ROW_KEY,
				locale: NAMESPACE,
				inject: props
			}, card));
			const forms = ctx.get("configForms", false);
			if (typeof forms?.whileServed === "function" && typeof ctx.effect === "function") ctx.effect(() => forms.whileServed?.(["extra-paths"], registerRow) ?? registerRow(), "extra-paths: row page while served");
			else registerRow();
		}
		//#endregion
		exports.NAMESPACE = NAMESPACE;
		exports.ROW_KEY = ROW_KEY;
		exports.apply = apply;
		exports.inject = inject;
		exports.lateBoundScope = lateBoundScope;
		return module.exports;
	}
});
