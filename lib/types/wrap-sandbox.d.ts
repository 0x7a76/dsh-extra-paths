/**
 * The subprocess half of the plugin: a transparent Proxy over `ctx.sandbox`
 * that appends one write grant per configured root to the argv the base
 * provider already wrapped. An unrecognised runner dialect fails closed: the
 * argv is returned untouched (the write stays denied) and a warning is logged.
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
 * A dialect the wrapper does not recognise (`windows-acl`, a remote
 * `sandbox-ssh` runner) also fails closed, as does an unknown one.
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
 * @returns a transparent proxy that widens profiles for configured roots.
 */
export declare function wrapSandbox(inner: SandboxInnerLike, deps: SandboxWrapDeps): SandboxInnerLike;
