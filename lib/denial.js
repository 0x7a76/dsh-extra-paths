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
import { isUnder } from './paths.js';
/** The stable error code a tool result or a consumer can match on. */
export const ACCESS_DENIED_CODE = 'EXTRA_PATHS_ACCESS_DENIED';
/**
 * A configured `deny`/`read` rule refused one operation.
 *
 * Deliberately an ordinary Error: the message is the user-visible explanation,
 * and the `code` lets a caller distinguish "the plugin said no" from a backend
 * failure without depending on the host's error hierarchy.
 */
export class AccessDeniedError extends Error {
    /** Stable machine-readable reason (see {@link ACCESS_DENIED_CODE}). */
    code = ACCESS_DENIED_CODE;
    /**
     * @param message - the user-visible explanation.
     */
    constructor(message) {
        super(message);
        this.name = 'AccessDeniedError';
    }
}
/**
 * The first rule of `access` that applies to `targetKey` on `surface`.
 *
 * "First" is report order (configured order per canonical root). Because a
 * target cannot be under two rules of DIFFERENT severity with the more permissive
 * one selected — deny wins by call order — a caller checks deny before read-only.
 * @param rules - resolved rules (a report's `denied` or `readOnly` list).
 * @param surface - the enforcement surface asking.
 * @param access - the level the rules must carry.
 * @param targetKey - a canonical path (the identity the host resolved).
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the matching rule, or undefined.
 */
function matchRule(rules, surface, access, targetKey, facts) {
    for (const rule of rules) {
        if (rule.access !== access)
            continue;
        if (!rule.surfaces.includes(surface))
            continue;
        if (isUnder(targetKey, rule.root, facts))
            return rule;
    }
    return undefined;
}
/**
 * Whether a `deny` rule covers this target on this surface.
 * @param rules - resolved rules (normally a report's `denied` list).
 * @param surface - the enforcement surface asking.
 * @param targetKey - a canonical path.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the matching deny rule, or undefined (no opinion).
 */
export function matchDenied(rules, surface, targetKey, facts) {
    return matchRule(rules, surface, 'deny', targetKey, facts);
}
/**
 * Whether a `read` rule covers this target on this surface: reads still pass,
 * writes must be refused (a downgrade, not a denial).
 * @param rules - resolved rules (normally a report's `readOnly` list).
 * @param surface - the enforcement surface asking.
 * @param targetKey - a canonical path.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the matching read-only rule, or undefined (no opinion).
 */
export function matchReadOnly(rules, surface, targetKey, facts) {
    return matchRule(rules, surface, 'read', targetKey, facts);
}
/** Quote one path the way the existing warning messages quote spellings. */
function quoted(value) {
    return JSON.stringify(value);
}
/**
 * The error for a content read refused by a `deny` rule.
 * @param displayPath - the path as the caller spelled it (for the message).
 * @param rule - the rule that refused it.
 * @returns the error to throw.
 */
export function readDenied(displayPath, rule) {
    return new AccessDeniedError(`cannot read ${quoted(displayPath)}: denied by the extra-paths rule ${quoted(rule.raw)}`);
}
/**
 * The error for a write refused by a `deny` rule.
 * @param displayPath - the path as the caller spelled it.
 * @param rule - the rule that refused it.
 * @returns the error to throw.
 */
export function writeDenied(displayPath, rule) {
    return new AccessDeniedError(`cannot write ${quoted(displayPath)}: denied by the extra-paths rule ${quoted(rule.raw)} (access: deny)`);
}
/**
 * The error for a write refused by a `read` rule: the path is readable but the
 * configuration downgraded it, even inside the writable workspace.
 * @param displayPath - the path as the caller spelled it.
 * @param rule - the rule that downgraded it.
 * @returns the error to throw.
 */
export function writeReadOnly(displayPath, rule) {
    return new AccessDeniedError(`cannot write ${quoted(displayPath)}: the path is configured read-only by the extra-paths rule `
        + `${quoted(rule.raw)} (access: read)`);
}
/**
 * The refusal reason a tool-level guard returns (a string, not a throw: the tool
 * layer renders it as `Error: <reason>`). Names the tool, the argument path and
 * the configured rule so the model does not retry with a different spelling.
 * @param toolName - the tool call about to run.
 * @param displayPath - the argument path that matched the rule.
 * @param rule - the rule that refused it.
 * @returns the one-line reason.
 */
export function toolAccessDenied(toolName, displayPath, rule) {
    return `extra-paths: the ${toolName} tool cannot access ${quoted(displayPath)}: `
        + `denied by the extra-paths rule ${quoted(rule.raw)} (access: deny)`;
}
//# sourceMappingURL=denial.js.map