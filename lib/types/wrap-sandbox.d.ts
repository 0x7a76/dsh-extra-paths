/**
 * The subprocess half of the plugin: a transparent Proxy over `ctx.sandbox`
 * that appends the configured shell-surface rules to the argv the base provider
 * already wrapped — write grants AND the deny/read-only restrictions the runner
 * dialect can express (see {@link widenArgv}).
 *
 * A sandbox profile can only name CONCRETE paths, so a BARE NAME rule
 * (`.git`, `.env`, `node_modules`) is deliberately NOT enforced here: expanding
 * a name into "the paths it currently matches" means walking the workspace plus
 * every writable root before commands — costly, stale by up to the cache TTL,
 * and silently partial when one root is deep or unreadable (the real host hit
 * exactly that). Name rules therefore protect the fs tools only, where the
 * match is lexical, exact and live on every call. A configured `shell` surface
 * on a name rule gets an explicit one-time notice (see
 * {@link warnNameRulesAreFsOnly}) instead of a stale or partial mask set.
 *
 * THE WRAPPER MIRRORS THE INNER PROVIDER'S SYNC-NESS, because that changed
 * between host generations and both must work:
 *
 * - 0.1.5 returns the confinement record SYNCHRONOUSLY and its callers read
 *   `.argv` off the result without awaiting
 *   (`return sandbox.confine(argv, policy).argv`). An `async` wrapper there
 *   yields `undefined` and every confined process dies with "Cannot read
 *   properties of undefined (reading '0')".
 * - 0.2.x declares `confine(argv, policy, signal): Promise<ConfinedArgv>` and
 *   every caller awaits it.
 *
 * So a synchronous result is widened synchronously, and a thenable result is
 * widened in a continuation instead of being forced through `async` — the same
 * code satisfies a caller that awaits and one that does not.
 *
 * Every confinement also records the OBSERVED runner dialect (shell-dialect.ts),
 * which drives the settings page's capability badges. A dialect that cannot
 * express the rules must never be silently mis-claimed:
 * - `danger-full-access` has no runner to inject into, so the record is returned
 *   untouched (the fs half still enforces the hard rules);
 * - `landlock` can grant but cannot subtract, and `windows-acl` can do neither:
 *   both warn ONCE per dialect + rule signature and the command still runs.
 *   Warning only once is the fix for a real log-flood: a denied rule sits in the
 *   configuration and every single command would otherwise re-report it.
 * @module dsh-extra-paths/wrap-sandbox
 */
import type { ExtraPathsConfig } from './config.js';
import type { PolicyLike } from './policy.js';
/** The base provider's confinement result (the fields this plugin preserves verbatim). */
export interface ConfinedArgvLike {
    readonly argv: readonly string[];
    readonly enforcement: unknown;
    readonly denialSignatures: readonly string[];
    readonly runnerFailureRules: readonly unknown[];
}
/** The subset of the sandbox provider this wrapper intercepts. */
export interface SandboxInnerLike {
    confine(argv: readonly string[], policy: PolicyLike, signal?: AbortSignal): ConfinedArgvLike | Promise<ConfinedArgvLike>;
}
/** What the wrapper needs from the plugin. */
export interface SandboxWrapDeps {
    readConfig(): ExtraPathsConfig;
    warn(message: string): void;
}
/** Test-only: forget the capability warnings that have been logged. */
export declare function resetShellWarnings(): void;
/**
 * Whether a service is a process-sandbox provider.
 *
 * Only `confine` is probed: it is the provider's whole public surface, the
 * abstract base declares it, and every concrete runner implements it. A false
 * positive could only wrap a service that already answers `confine`.
 * @param value - the service read from the context.
 * @returns true when the value looks like a sandbox provider.
 */
export declare function isConfiningSandbox(value: unknown): value is SandboxInnerLike;
/**
 * Wrap one sandbox provider.
 * @param inner - the provider read from the context.
 * @param deps - configuration source and warning sink.
 * @returns a transparent proxy that widens profiles for configured roots and
 *   appends the shell-surface restrictions the runner can express.
 */
export declare function wrapSandbox(inner: SandboxInnerLike, deps: SandboxWrapDeps): SandboxInnerLike;
