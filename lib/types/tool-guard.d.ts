/**
 * The tool-layer deny guard: the second, honest seam beside the fs proxy.
 *
 * Some host tools read files WITHOUT going through `ctx.fs`:
 * `grep`/`glob` spawn the host's bundled ripgrep, MCP/LSP children have their own
 * filesystem access, and a service that cached `ctx.fs` at load time keeps the
 * unwrapped instance. Those paths are documented boundaries (§11 of the 0.3.0
 * plan) — the plugin does not pretend to intercept them. What it CAN do is ask
 * the tool runtime to refuse a call whose own arguments name a denied path:
 * `ctx.tools.guard((exec) => reason | undefined)` runs synchronously before
 * dispatch and a returned string becomes `Error: <reason>` for the model. This
 * reliably catches `grep`/`glob` with an explicit `path`; a default workspace
 * scan can still surface a denied SUBdirectory (documented, not silently denied).
 *
 * The guard is deliberately conservative: it only refuses on a positive
 * containment match, and any failure to resolve a candidate means "no opinion"
 * (never throw from a guard — a bug in the plugin must not brick every tool).
 *
 * NAME RULES (`.git`, `.env`) apply here too: a tool call whose own argument
 * names a path containing a denied name component is refused exactly like a
 * literal denial. The lexical test is shared with the fs wrapper
 * ({@link matchNameRule}) so a tool guard and the fs proxy cannot disagree about
 * what a bare name covers; the walk the shell surface needs is never performed
 * here.
 * @module dsh-extra-paths/tool-guard
 */
import type { ExtraPathsConfig } from './config.js';
/**
 * The fields of one tool execution this guard reads. A structural subset of the
 * host's `ToolExecution` (name/arguments/agent) so this module imports no
 * `@deepseek-ai/*` value and stays testable without a runtime.
 */
export interface ToolExecutionLike {
    /** The tool being dispatched (`grep`, `glob`, `read`, `bash`, …). */
    readonly name?: string;
    /** The raw, untrusted tool arguments. */
    readonly arguments?: unknown;
    /** The owning agent, whose session header carries the workspace cwd. */
    readonly agent?: {
        readonly session?: {
            readonly header?: {
                readonly cwd?: string;
            };
        };
    };
}
/** What the guard needs from the plugin. */
export interface ToolGuardDeps {
    readConfig(): ExtraPathsConfig;
    warn(message: string): void;
}
/**
 * Collect the candidate path strings of one tool call.
 *
 * Strings and string arrays under one of {@link PATH_KEYS} are candidates; the
 * walk descends at most {@link MAX_ARGUMENT_DEPTH} levels so batch shapes such as
 * `files: [{ path }]` or `targets: [{ file_path }]` are covered without turning
 * into a full recursive scan of every tool's payload. Duplicates are removed so
 * one path named twice resolves once.
 * @param args - the raw `execution.arguments`.
 * @returns the deduplicated candidate spellings, in argument order.
 */
export declare function extractPathCandidates(args: unknown): readonly string[];
/**
 * The potential refusal reason for one tool execution.
 *
 * Pure and synchronous (the host's guard contract): resolve the calling
 * session's cwd, normalise every candidate path the way a configured entry is
 * normalised, and refuse when a `deny` rule covers it — literally or as a NAME
 * rule on one of the path's components (the candidate's fs-surface equivalent of
 * `repo/.git/config` under a `.git | deny` rule). `read` rules do NOT deny a tool
 * call — they only stop writes, which the fs proxy already enforces; a
 * parameter-level guard cannot tell whether a tool will read or write.
 * @param execution - the tool call about to be dispatched.
 * @param deps - live configuration source.
 * @returns the denial reason for the tool layer, or undefined for "no opinion".
 */
export declare function guardReason(execution: ToolExecutionLike, deps: ToolGuardDeps): string | undefined;
/** The host tools-service surface this module needs (feature-detected, never imported). */
export interface ToolServiceLike {
    /** The synchronous deny registration seam (`@deepseek-ai/dsh-tools`). */
    guard?(guard: (execution: Readonly<ToolExecutionLike>) => string | undefined): unknown;
}
/** The context shape `src/index.ts` can pass (structurally a cordis entry context). */
export interface ToolGuardInstallContext {
    /** Cordis injection: runs `callback` once the `tools` service is available. */
    inject?(names: readonly string[], callback: (scope: unknown) => void): unknown;
    /** Already-available service (tests / an entry that injected directly). */
    tools?: ToolServiceLike;
}
/**
 * Register the deny guard on the tools service, feature-detected.
 *
 * Registration goes through `ctx.inject(['tools'], …)` because the tool runtime
 * may not be composed yet when the plugin applies — and because an older host
 * generation may not have `guard` at all, in which case the plugin silently
 * keeps the fs-only enforcement instead of failing to load.
 * @param ctx - the plugin/entry context.
 * @param deps - live configuration source.
 * @returns the disposer that unregisters the guard (no-op when nothing was
 *   registered).
 */
export declare function installToolGuard(ctx: ToolGuardInstallContext, deps: ToolGuardDeps): () => void;
