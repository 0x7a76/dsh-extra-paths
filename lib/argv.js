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
/** Quote one path as an SBPL string literal. */
function sbplString(path) {
    return `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
/** One SBPL subpath operation, with the leading space that joins it to a profile. */
function sbplSubpath(verb, operations, path) {
    return ` (${verb} ${operations} (subpath ${sbplString(path)}))`;
}
/**
 * The SBPL forms to append to the base profile, in decision order: grants first,
 * then the write downgrade, then the full denial (SBPL: the LAST matching rule
 * wins, so the denial must come last).
 * @param rules - canonical roots to append.
 * @returns the concatenated forms (each with its own leading space).
 */
function seatbeltRules(rules) {
    const grants = rules.grants.map(root => sbplSubpath('allow', 'file-write*', root)).join('');
    const readOnly = rules.readOnly.map(root => sbplSubpath('deny', 'file-write*', root)).join('');
    const denied = rules.denied
        .map(root => sbplSubpath('deny', 'file-read*', root) + sbplSubpath('deny', 'file-write*', root))
        .join('');
    return `${grants}${readOnly}${denied}`;
}
/** Whether a head carries one of the flags in `list`. */
function hasFlag(head, ...flags) {
    return flags.some(flag => head.includes(flag));
}
/** The runner basename: `--`-safe, prefix-directory-safe, Windows-separator-safe. */
function runnerName(argv) {
    return (argv[0] ?? '').replaceAll('\\', '/').split('/').pop() ?? '';
}
/**
 * Whether the base provider's head is the windows-acl runner. Its argv carries a
 * workspace root and a mode flag and REJECTS unknown arguments, so the plugin
 * must never append anything to it.
 * @param head - the confined argv before the caller's separator.
 * @returns true when the runner is windows-acl.
 */
function isWindowsAcl(head) {
    return runnerName(head).includes('windows-acl') || (hasFlag(head, '--workspace') && hasFlag(head, '--mode'));
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
export function widenArgv(confined, wrappedLength, rules) {
    const hasRules = rules.grants.length > 0 || rules.readOnly.length > 0 || rules.denied.length > 0;
    if (!hasRules)
        return { argv: confined };
    const separatorIndex = confined.length - wrappedLength - 1;
    if (separatorIndex <= 0 || confined[separatorIndex] !== '--')
        return undefined;
    const head = confined.slice(0, separatorIndex);
    const tail = confined.slice(separatorIndex);
    // Seatbelt: sandbox-exec -p <profile> -- <argv>; the profile is the only
    // element edited so the base provider's own rules survive verbatim.
    if (head[1] === '-p' && head[2]?.startsWith('(version 1)') === true) {
        return { argv: [...head.slice(0, 2), `${head[2]}${seatbeltRules(rules)}`, ...head.slice(3), ...tail] };
    }
    // bwrap: later mounts cover earlier ones, so grants bind writable, read-only
    // rules rebind read-only, and deny rules mask the path — in that order.
    if (hasFlag(head, '--ro-bind')) {
        const extra = [
            ...rules.grants.flatMap(root => ['--bind', root, root]),
            ...rules.readOnly.flatMap(root => ['--ro-bind', root, root]),
            ...rules.denied.flatMap(root => ['--mask', root]),
        ];
        return { argv: [...head, ...extra, ...tail] };
    }
    // Landlock: an allow-list. New writable roots are expressible (`--rw`), a
    // subtraction is NOT: report the dialect so the caller warns honestly.
    if (hasFlag(head, '--ro', '--rw')) {
        const widened = rules.grants.length === 0
            ? confined
            : [...head, ...rules.grants.flatMap(root => ['--rw', root]), ...tail];
        const restrictive = rules.readOnly.length > 0 || rules.denied.length > 0;
        return restrictive ? { argv: widened, unsupported: 'landlock' } : { argv: widened };
    }
    // windows-acl: the runner rejects arguments it does not know, so nothing can
    // be appended — not even grants (the current fail-closed behaviour).
    if (isWindowsAcl(head))
        return { argv: confined, unsupported: 'windows-acl' };
    // `sandbox-ssh`, a future runner, or a malformed shape: fail closed.
    return undefined;
}
//# sourceMappingURL=argv.js.map