/**
 * The shared vocabulary of a refusal: which configured rule covers a target, and
 * what the user sees when that rule fires.
 *
 * Why a plain `Error` subclass instead of the host's `FsError`: the plugin must
 * not import an `@deepseek-ai/*` VALUE (every peer is optional and a runtime
 * import would make the plugin fail to load on a host generation that renamed the
 * error class). The tool layer renders a thrown ordinary `Error` as
 * `Error: <message>`, so a self-explanatory message plus a stable
 * {@link ACCESS_DENIED_CODE} is all a consumer needs.
 *
 * `matchDenied` / `matchReadOnly` are the ONE containment test both enforcement
 * surfaces share: they filter by surface and access, then delegate to
 * `isUnder`, whose identity fallback (dev+ino) is what makes a DENY as hard to
 * dodge as a grant (a casing/8.3/WSL alias must not slip past it).
 * @module dsh-extra-paths/denial
 */
import type { Surface } from './config.js';
import { type PlatformFacts } from './paths.js';
import type { ResolvedRule } from './resolve.js';
/** The stable error code a tool result or a consumer can match on. */
export declare const ACCESS_DENIED_CODE = "EXTRA_PATHS_ACCESS_DENIED";
/**
 * A configured `deny`/`read` rule refused one operation.
 *
 * Deliberately an ordinary Error: the message is the user-visible explanation,
 * and the `code` lets a caller distinguish "the plugin said no" from a backend
 * failure without depending on the host's error hierarchy.
 */
export declare class AccessDeniedError extends Error {
    /** Stable machine-readable reason (see {@link ACCESS_DENIED_CODE}). */
    readonly code: string;
    /**
     * @param message - the user-visible explanation.
     */
    constructor(message: string);
}
/**
 * Whether a `deny` rule covers this target on this surface.
 * @param rules - resolved rules (normally a report's `denied` list).
 * @param surface - the enforcement surface asking.
 * @param targetKey - a canonical path.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the matching deny rule, or undefined (no opinion).
 */
export declare function matchDenied(rules: readonly ResolvedRule[], surface: Surface, targetKey: string, facts?: PlatformFacts): ResolvedRule | undefined;
/**
 * Whether a `read` rule covers this target on this surface: reads still pass,
 * writes must be refused (a downgrade, not a denial).
 * @param rules - resolved rules (normally a report's `readOnly` list).
 * @param surface - the enforcement surface asking.
 * @param targetKey - a canonical path.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the matching read-only rule, or undefined (no opinion).
 */
export declare function matchReadOnly(rules: readonly ResolvedRule[], surface: Surface, targetKey: string, facts?: PlatformFacts): ResolvedRule | undefined;
/**
 * The error for a content read refused by a `deny` rule.
 * @param displayPath - the path as the caller spelled it (for the message).
 * @param rule - the rule that refused it.
 * @returns the error to throw.
 */
export declare function readDenied(displayPath: string, rule: ResolvedRule): AccessDeniedError;
/**
 * The error for a write refused by a `deny` rule.
 * @param displayPath - the path as the caller spelled it.
 * @param rule - the rule that refused it.
 * @returns the error to throw.
 */
export declare function writeDenied(displayPath: string, rule: ResolvedRule): AccessDeniedError;
/**
 * The error for a write refused by a `read` rule: the path is readable but the
 * configuration downgraded it, even inside the writable workspace.
 * @param displayPath - the path as the caller spelled it.
 * @param rule - the rule that downgraded it.
 * @returns the error to throw.
 */
export declare function writeReadOnly(displayPath: string, rule: ResolvedRule): AccessDeniedError;
/**
 * The refusal reason a tool-level guard returns (a string, not a throw: the tool
 * layer renders it as `Error: <reason>`). Names the tool, the argument path and
 * the configured rule so the model does not retry with a different spelling.
 * @param toolName - the tool call about to run.
 * @param displayPath - the argument path that matched the rule.
 * @param rule - the rule that refused it.
 * @returns the one-line reason.
 */
export declare function toolAccessDenied(toolName: string, displayPath: string, rule: ResolvedRule): string;
