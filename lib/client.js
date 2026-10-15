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
		//#region src/client/paths.ts
		/**
		* Lexical path resolution for the settings page's live column. It mirrors the
		* host's `expandPath` (a relative entry resolves against the session workspace,
		* `~` against the home directory) WITHOUT touching the filesystem, so a
		* half-typed row can show where it would land before it is saved.
		*
		* Symbolic links are deliberately not resolved here — the browser cannot
		* realpath. The host's own preview is the authoritative answer, and the page
		* keeps showing both: this one instantly, the host's on every settled edit.
		* @module dsh-extra-paths/client/paths
		*/
		/**
		* Collapse `.`, `..` and duplicate separators in an absolute POSIX spelling.
		* @param path - an absolute spelling (the caller guarantees the leading `/`).
		* @returns the collapsed absolute path; `..` above the root is clamped there.
		*/
		function collapse(path) {
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
		* Resolve one configured entry the way the host will, lexically.
		* @param entry - the row's raw spelling.
		* @param workspaceRoot - the workspace a relative entry resolves against.
		* @param home - the host's home directory, once the preview has reported it.
		* @returns the absolute path, or undefined when it cannot be resolved yet
		* (`~` before the home directory is known, or a relative entry with no usable
		* workspace base).
		*/
		function resolveLexically(entry, workspaceRoot, home) {
			const trimmed = entry.trim();
			if (trimmed === "") return void 0;
			if (trimmed === "~" || trimmed.startsWith("~/")) {
				if (home === void 0 || home === "") return void 0;
				return collapse(trimmed === "~" ? home : `${home}/${trimmed.slice(2)}`);
			}
			if (trimmed.startsWith("/")) return collapse(trimmed);
			if (!workspaceRoot.startsWith("/")) return void 0;
			return collapse(`${workspaceRoot}/${trimmed}`);
		}
		//#endregion
		//#region src/client/preview.ts
		const ROUTE = "/extra-paths/resolved";
		/**
		* Fetch the effective roots for one workspace.
		*
		* The unsaved rows travel with the request so the answer describes the DRAFT:
		* previously the preview only ever described the stored document, which is what
		* made configuring a relative path a guess-until-you-save exercise.
		* @param cwd - the workspace path to resolve against.
		* @param paths - the page's current rows (strings or `{path, scope, surfaces}`).
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
		const card = {
			...box,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: "10px 12px",
			border: "1px solid var(--dsh-color-border, rgba(128,128,128,0.25))",
			borderRadius: 8
		};
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
		/** The page's style map. */
		const styles = {
			page: {
				display: "flex",
				flexDirection: "column",
				gap: 12,
				padding: "4px 0",
				maxWidth: 760
			},
			intro: {
				fontSize: 12,
				lineHeight: 1.6,
				opacity: .75
			},
			baseRow: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			},
			baseField: { width: 380 },
			toolbar: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			},
			card,
			cardHead: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8
			},
			cardHeadRight: {
				display: "flex",
				alignItems: "center",
				gap: 8
			},
			cardTitle: {
				fontSize: 12,
				fontWeight: 600,
				opacity: .75
			},
			pathInput: {
				...box,
				width: "100%",
				padding: "6px 8px",
				borderRadius: 6,
				border: "1px solid var(--dsh-color-border, rgba(128,128,128,0.35))",
				background: "transparent",
				color: "inherit",
				fontFamily: "var(--dsh-font-mono, monospace)",
				fontSize: 13
			},
			resolvedRow: {
				display: "flex",
				gap: 6,
				alignItems: "baseline",
				minHeight: 18,
				fontSize: 12,
				flexWrap: "wrap"
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
			controlsRow: {
				display: "flex",
				gap: 16,
				alignItems: "center",
				flexWrap: "wrap"
			},
			field: {
				display: "flex",
				gap: 6,
				alignItems: "center",
				fontSize: 12,
				opacity: .85
			},
			select: {
				padding: "3px 6px",
				borderRadius: 6,
				background: "transparent",
				color: "inherit",
				fontSize: 12
			},
			pills: {
				display: "flex",
				gap: 6,
				alignItems: "center"
			},
			pillOn: {
				...button,
				borderColor: "var(--dsh-color-accent, #2f6fd0)",
				background: "var(--dsh-color-accent-soft, rgba(47,111,208,0.15))"
			},
			pillOff: {
				...button,
				opacity: .55
			},
			button,
			primary: {
				...button,
				borderColor: "var(--dsh-color-accent, #2f6fd0)",
				fontWeight: 600
			},
			linkButton: {
				...button,
				border: "none",
				opacity: .7,
				padding: "2px 4px"
			},
			panel: {
				...box,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: "10px 12px",
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
			entry: {
				display: "flex",
				gap: 6,
				alignItems: "baseline",
				flexWrap: "wrap",
				fontSize: 12
			},
			statusOk: { color: "var(--dsh-color-success, #15803d)" },
			statusMissing: { color: "var(--dsh-color-warning, #b45309)" },
			statusRejected: { color: "var(--dsh-color-danger, #b91c1c)" },
			warn: {
				color: "var(--dsh-color-warning, #b45309)",
				fontSize: 12,
				lineHeight: 1.5
			}
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
.xp-input:hover, .xp-select:hover { border-color: var(--dsh-color-border-strong, rgba(128,128,128,0.6)); }
.xp-input:focus, .xp-select:focus { outline: none; }
.xp-input:focus-visible, .xp-select:focus-visible {
  outline: none;
  border-color: var(--dsh-color-accent, #2f6fd0);
  box-shadow: 0 0 0 2px var(--dsh-color-accent-soft, rgba(47,111,208,0.25));
}
.xp-input::placeholder { color: currentColor; opacity: 0.38; }
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
.xp-button-off { opacity: 0.55; }
.xp-link { border: none; background: none; padding: 2px 4px; opacity: 0.7; font-size: 12px; cursor: pointer; color: inherit; }
.xp-link:hover { opacity: 1; text-decoration: underline; }
`;
		//#endregion
		//#region src/client/page.tsx
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
		const NOOP_HOOK = () => void 0;
		const IDENTITY = (snapshot) => snapshot;
		function itemsOf(value) {
			const items = value?.items;
			return Array.isArray(items) ? items : [];
		}
		const STATUS_LABEL = {
			ok: "生效",
			missing: "目录不存在",
			rejected: "已拒绝"
		};
		const STATUS_STYLE = {
			ok: styles.statusOk,
			missing: styles.statusMissing,
			rejected: styles.statusRejected
		};
		const SCOPE_LABEL = {
			write: "随会话模式（read-only 下拒绝）",
			"always-write": "始终可写（read-only 下也允许）"
		};
		function rowsOf(section) {
			const rows = [];
			for (const item of section?.paths ?? []) if (typeof item === "string") rows.push({
				path: item,
				scope: "write",
				surfaces: ["fs", "shell"]
			});
			else rows.push({
				path: item.path ?? "",
				scope: item.scope ?? "write",
				surfaces: [...item.surfaces ?? ["fs", "shell"]]
			});
			return rows;
		}
		function payloadOf(rows) {
			return rows.filter((row) => row.path.trim() !== "").map((row) => ({
				path: row.path.trim(),
				scope: row.scope,
				surfaces: [...row.surfaces]
			}));
		}
		function useSnapshot(scope) {
			const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
			react.useEffect(() => scope.subscribe(() => {
				setSnapshot(scope.getSnapshot());
			}), [scope]);
			return snapshot;
		}
		/**
		* Render the page.
		* @param props - the bound settings scope, the standard workspace hook, and the
		* lazy fallback used when the composition supplies no standard props.
		*/
		function ExtraPathsPage({ scope, getWorkspaces, useWorkspaces }) {
			const snapshot = useSnapshot(scope);
			const fromHook = itemsOf((useWorkspaces ?? NOOP_HOOK)(IDENTITY));
			const candidates = (fromHook.length > 0 ? fromHook : itemsOf(getWorkspaces?.()?.list?.getSnapshot?.())).map((item) => item.path).filter((path) => typeof path === "string" && path !== "");
			const [rows, setRows] = react.useState(() => rowsOf(snapshot.value));
			const [dirty, setDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(void 0);
			const [preview, setPreview] = react.useState(void 0);
			const [cwd, setCwd] = react.useState(() => candidates[0] ?? "");
			const [cwdPinned, setCwdPinned] = react.useState(false);
			const [manualBase, setManualBase] = react.useState(false);
			react.useEffect(() => {
				if (!dirty) setRows(rowsOf(snapshot.value));
			}, [snapshot, dirty]);
			const first = candidates[0];
			react.useEffect(() => {
				if (!cwdPinned && cwd === "" && first !== void 0) setCwd(first);
			}, [
				cwdPinned,
				cwd,
				first
			]);
			const typedBase = cwd.trim();
			const usableBase = typedBase.startsWith("/") || typedBase === "~" || typedBase.startsWith("~/");
			const base = typedBase.startsWith("~") ? resolveLexically(typedBase, "", preview?.home) ?? "" : typedBase;
			const request = JSON.stringify(payloadOf(rows));
			react.useEffect(() => {
				if (base === "") return;
				let live = true;
				const timer = setTimeout(() => {
					const draft = JSON.parse(request);
					fetchPreview(base, draft).then((result) => {
						if (live) setPreview(result);
					});
				}, 250);
				return () => {
					live = false;
					clearTimeout(timer);
				};
			}, [
				base,
				request,
				snapshot
			]);
			const update = (index, patch) => {
				setDirty(true);
				setRows((current) => current.map((row, i) => i === index ? {
					...row,
					...patch
				} : row));
			};
			const toggleSurface = (index, surface) => {
				const row = rows[index];
				if (row === void 0) return;
				const surfaces = row.surfaces.includes(surface) ? row.surfaces.filter((item) => item !== surface) : [...row.surfaces, surface];
				update(index, { surfaces });
			};
			const append = (path) => {
				setDirty(true);
				setRows((current) => [...current, {
					path,
					scope: "write",
					surfaces: ["fs", "shell"]
				}]);
			};
			const reset = () => {
				setRows(rowsOf(snapshot.value));
				setDirty(false);
				setError(void 0);
			};
			const save = () => {
				setBusy(true);
				setError(void 0);
				scope.set("paths", payloadOf(rows)).then(() => {
					setDirty(false);
				}).catch((cause) => {
					setError(String(cause));
				}).finally(() => {
					setBusy(false);
				});
			};
			const hostEntriesOf = (path) => preview?.entries.filter((entry) => entry.raw === path.trim()) ?? [];
			const hostEntryOf = (path) => hostEntriesOf(path)[0];
			const picker = !manualBase && candidates.length > 0;
			const known = candidates.includes(typedBase);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: css }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.intro,
						children: [
							"这些路径在会话工作区之外也可以写，",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "不需要审批" }),
							"；写工具与终端都按下面的「作用面」生效。 相对路径按「基准工作区」解析——执法时用的是",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "各会话自己的工作区" }),
							"，所以同一份配置在不同会话会指向不同目录。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.baseRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.cardTitle,
								children: "基准工作区"
							}),
							picker ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "xp-select",
								style: styles.baseField,
								value: known ? typedBase : "",
								onChange: (event) => {
									setCwdPinned(true);
									setCwd(event.target.value);
								},
								children: [known ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: typedBase,
									children: typedBase === "" ? "（未选择）" : typedBase
								}), candidates.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: path,
									children: path
								}, path))]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "xp-input",
								style: styles.baseField,
								value: cwd,
								placeholder: "绝对路径，或以 ~/ 开头（例如 ~/projects）",
								onChange: (event) => {
									setCwdPinned(true);
									setCwd(event.target.value);
								}
							}),
							candidates.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "xp-link",
								onClick: () => {
									setManualBase(!manualBase);
								},
								children: picker ? "手填" : "从列表选"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.dim,
								children: "仅用于预览与行内解析"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.toolbar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "xp-button xp-button-on",
								disabled: busy || !dirty,
								onClick: save,
								children: busy ? "保存中…" : "保存"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "xp-button",
								onClick: () => {
									append("");
								},
								children: "添加路径"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "xp-button",
								onClick: () => {
									append("..");
								},
								children: "添加工作区上一层（..）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "xp-button",
								disabled: !dirty,
								onClick: reset,
								children: "放弃修改"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.dim,
								children: dirty ? "有未保存的修改" : "已与配置同步"
							})
						]
					}),
					rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.dim,
						children: "还没有配置路径：用上面的「添加路径」或「添加工作区上一层（..）」开始。"
					}) : null,
					rows.map((row, index) => {
						const patternRow = row.path.includes("*");
						const resolved = patternRow ? void 0 : resolveLexically(row.path, base, preview?.home);
						const hostMatches = hostEntriesOf(row.path);
						const hostEntry = hostEntryOf(row.path);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.cardHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: styles.cardTitle,
										children: ["路径 ", index + 1]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: styles.cardHeadRight,
										children: [hostEntry !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: STATUS_STYLE[hostEntry.status],
											children: [
												"[",
												STATUS_LABEL[hostEntry.status],
												hostMatches.length > 1 ? ` ×${hostMatches.length}` : "",
												"]"
											]
										}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "xp-link",
											onClick: () => {
												setDirty(true);
												setRows((current) => current.filter((_, i) => i !== index));
											},
											children: "删除"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "xp-input",
									style: styles.pathInput,
									value: row.path,
									placeholder: "~/projects/notes/home、../某仓库、..（上一层）、~/projects/**/.worktrees/..（模式）",
									onChange: (event) => {
										update(index, { path: event.target.value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: styles.resolvedRow,
									children: patternRow ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: styles.dim,
										children: [
											"模式：由宿主按目录结构展开",
											" ",
											hostMatches.length > 0 ? `当前命中 ${hostMatches.length} 个目录（见下方预览）` : "（暂无命中，或被展开上限拦截）"
										]
									}) : resolved === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.dim,
										children: row.path.trim() === "" ? "填入路径后这里会显示解析结果" : typedBase === "" ? "相对路径需要基准工作区：请在上面选择或填写" : !usableBase ? "基准工作区需要绝对路径，或以 ~/ 开头（例如 ~/projects）" : "~ 需要宿主的家目录（第一次预览返回后即可解析）"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.dim,
											children: "解析为"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											style: styles.code,
											children: resolved
										}),
										hostEntry !== void 0 && hostEntry.resolved !== resolved ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: styles.dim,
											children: [
												"（宿主解析：",
												hostEntry.resolved,
												"）"
											]
										}) : null
									] })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.controlsRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: ["生效模式", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: "xp-select",
											value: row.scope,
											onChange: (event) => {
												update(index, { scope: event.target.value });
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "write",
												children: SCOPE_LABEL.write
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "always-write",
												children: SCOPE_LABEL["always-write"]
											})]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.pills,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.dim,
												children: "作用面"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: row.surfaces.includes("fs") ? "xp-button xp-button-on" : "xp-button xp-button-off",
												onClick: () => {
													toggleSurface(index, "fs");
												},
												children: "写工具"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: row.surfaces.includes("shell") ? "xp-button xp-button-on" : "xp-button xp-button-off",
												onClick: () => {
													toggleSurface(index, "shell");
												},
												children: "终端"
											})
										]
									})]
								})
							]
						}, index);
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.warn,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.panel,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.panelHead,
							children: [
								"解析预览",
								dirty ? "（含未保存修改）" : "",
								preview !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: styles.dim,
									children: [
										"生效根 ",
										preview.effective.length,
										" 条"
									]
								}) : null
							]
						}), typedBase === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.dim,
							children: "先在上面选择或填写「基准工作区」，这里就会显示宿主解析出的生效根。"
						}) : !usableBase ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.dim,
							children: "基准工作区需要绝对路径，或以 ~/ 开头（例如 ~/projects）；相对路径不能当基准用。"
						}) : base === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.dim,
							children: "正在展开 ~：宿主的家目录会在第一次预览返回后给出。"
						}) : preview === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.dim,
							children: "预览不可用（宿主没提供该路由、连接还没就绪，或基准工作区被宿主拒绝）。"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [preview.entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.dim,
							children: "还没有可解析的路径。"
						}) : preview.entries.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.entry,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: STATUS_STYLE[entry.status],
									children: [
										"[",
										STATUS_LABEL[entry.status],
										"]"
									]
								}),
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
									children: entry.resolved === "" ? "（未解析）" : entry.resolved
								})
							]
						}, `${index}-${entry.raw}`)), preview.warnings.map((warning) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.warn,
							children: warning
						}, warning))] })]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client half: contributes the Extra paths configuration page to the settings
		* dialog twice — as a `settings.section` nav row (the settings sidebar) and as
		* the plugin's own card (0.1.5: `settings.plugin.item`, keyed by the settings
		* namespace; 0.2.x: `plugins.item`, a list slot).
		*
		* TWO HOST GENERATIONS, ONE PAGE. The settings scope this page edits moved in
		* 0.2.0: `ctx.settingsScope` (0.1.5) is gone and replaced by `ctx.configForms`
		* — which however exposes the SAME three methods the page was written against
		* (`getSnapshot`/`subscribe`/`set`). So the page keeps its narrow `PageScope`
		* interface and this file supplies whichever implementation the running host
		* has, through a late-bound proxy: the scope may not exist yet when the plugin
		* activates, and listing an absent service in `inject` would leave the plugin
		* waiting forever.
		*
		* Slot keys, register shapes and the module table were taken from the RUNNING
		* version's own official occupants (`dsh-client-ui-settings-plugins`,
		* `dsh-client-ui-settings-agent-loop`) and their published contracts. A slot key
		* that nothing declares is inert under `ctx.slots.inject` (the callback never
		* runs), which is what lets one build register into both generations' cards.
		*
		* Every @deepseek-ai/* import here is TYPE-ONLY (erased): the runtime services
		* arrive through cordis, and react resolves from the page's module table
		* (see dsh.client in package.json).
		* @module dsh-extra-paths/client
		*/
		/**
		* Client services this half needs.
		*
		* Only `slots`: the settings scope is fetched late-bound below, because the
		* 0.1.5 (`settingsScope`) and 0.2.x (`configForms`) providers differ and an
		* `inject` entry for a service that never appears would block activation.
		*/
		const inject = ["slots"];
		/** The settings namespace this page edits — the one the host half registers. */
		const NAMESPACE = "extra-paths";
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
					set: (field, value) => real?.set(field, value) ?? Promise.resolve()
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
			ctx.inject(["settingsScope"], (child) => {
				const { settingsScope } = child;
				attach(settingsScope.bind({ namespace: NAMESPACE }));
			});
			ctx.inject(["configForms"], (child) => {
				const { configForms } = child;
				attach({
					getSnapshot: () => configForms.get(NAMESPACE).getSnapshot(),
					subscribe: (listener) => configForms.get(NAMESPACE).subscribe(listener),
					set: (field, value) => configForms.get(NAMESPACE).set(field, value).then(() => void 0)
				});
			});
			const getWorkspaces = () => ctx.get("workspaces", false);
			const props = () => ({
				scope,
				getWorkspaces
			});
			const page = () => react.createElement(ExtraPathsPage, props());
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: NAMESPACE,
				order: 40,
				label: () => "额外可写路径",
				locale: NAMESPACE,
				inject: props
			}, page));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NAMESPACE,
				locale: NAMESPACE,
				inject: props
			}, page));
			const registerCard = () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
				name: "plugins.item",
				id: NAMESPACE,
				order: 40,
				label: () => "额外可写路径",
				locale: NAMESPACE,
				inject: props
			}, page));
			const forms = ctx.get("configForms", false);
			if (typeof forms?.whileServed === "function" && typeof ctx.effect === "function") ctx.effect(() => forms.whileServed?.(["extra-paths"], registerCard) ?? registerCard(), "extra-paths: card while served");
			else registerCard();
		}
		//#endregion
		exports.NAMESPACE = NAMESPACE;
		exports.apply = apply;
		exports.inject = inject;
		exports.lateBoundScope = lateBoundScope;
		return module.exports;
	}
});
