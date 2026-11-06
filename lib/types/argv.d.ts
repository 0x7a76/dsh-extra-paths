/**
 * Runner-dialect widening: append the configured write grants AND the configured
 * restrictions to an argv the base provider already wrapped.
 *
 * The two outer runners can express a restriction by APPENDING to what the base
 * provider built, but only because both dialects resolve conflicts in favour of
 * the LATER entry:
 * - seatbelt (macOS): SBPL is last-match-wins, so a deny rule appended after the
 *   host's `(allow default)` + `(deny file-write*)` + per-root allows wins;
 * - bwrap (Linux): a later mount covers an earlier one, so `--ro-bind`/`--mask`
 *   appended after the writable binds win.
 * The inner runners cannot: landlock is a pure allow-list (nothing can be
 * subtracted) and windows-acl's runner rejects unknown flags. Those return the
 * unchanged argv plus the dialect that could not express the rules, and the
 * caller warns honestly instead of inventing a flag.
 *
 * Detection is structural (flags, never a program-name grep) and every
 * unrecognised shape fails closed by returning `undefined` — the caller then
 * leaves the argv untouched, so the write is denied rather than silently
 * mis-granted.
 * @module dsh-extra-paths/argv
 */
import type { ShellDialect } from './shell-dialect.js';
/** The canonical roots to append, already filtered to the shell surface. */
export interface WidenRules {
    /** `write`/`always-write` roots these rules grant (grants are first). */
    readonly grants: readonly string[];
    /** `read` roots: shell writes into them must be denied. */
    readonly readOnly: readonly string[];
    /** `deny` roots: shell reads AND writes into them must be denied. */
    readonly denied: readonly string[];
}
/**
 * The widened argv, or the unchanged one when the runner dialect cannot express
 * part of the rules. `unsupported` names the dialect that fell short; the caller
 * must log it once per dialect+rule signature (never silently claim enforcement).
 */
export interface WidenedArgv {
    readonly argv: readonly string[];
    readonly unsupported?: ShellDialect;
}
/**
 * Append the shell-surface rules to a confined argv.
 *
 * The caller's separator (`--`) is located from `wrappedLength`, exactly like the
 * grant path always has: it is the anchor that guarantees the appended flags land
 * in the WRAPPER's argv and never in the user's command.
 * @param confined - the argv the base provider produced.
 * @param wrappedLength - length of the caller's original argv.
 * @param rules - canonical roots to append (grants/readOnly/denied).
 * @returns the widened argv; the unchanged argv plus `unsupported` when the
 *   dialect cannot express the restrictions; `undefined` when the dialect is
 *   unrecognised (the caller must not claim enforcement and must warn).
 */
export declare function widenArgv(confined: readonly string[], wrappedLength: number, rules: WidenRules): WidenedArgv | undefined;
