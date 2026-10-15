/**
 * Runner-dialect widening: append one write grant per configured root to an
 * argv the base provider already wrapped. Detection is structural (flags, not
 * program names) and every unrecognised shape fails closed by returning
 * `undefined` — the caller then leaves the argv untouched, so the write is
 * denied rather than silently mis-granted.
 * @module dsh-extra-paths/argv
 */
/** Quote one path as an SBPL string literal. */
function sbplString(path) {
    return `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
/**
 * Insert write grants for `roots` into a confined argv.
 * @param confined - the argv the base provider produced (runner, profile, `--`, command).
 * @param wrappedLength - length of the caller's original argv, which locates the separator.
 * @param roots - canonical roots to grant.
 * @returns the widened argv, the unchanged argv when there is nothing to grant,
 *   or `undefined` when the dialect is unrecognised (the caller must not grant).
 */
export function widenArgv(confined, wrappedLength, roots) {
    if (roots.length === 0)
        return confined;
    const separatorIndex = confined.length - wrappedLength - 1;
    if (separatorIndex <= 0 || confined[separatorIndex] !== '--')
        return undefined;
    const head = confined.slice(0, separatorIndex);
    const tail = confined.slice(separatorIndex);
    // Seatbelt: sandbox-exec -p <profile> -- <argv>
    if (head[1] === '-p' && head[2]?.startsWith('(version 1)') === true) {
        const extra = roots.map(root => ` (allow file-write* (subpath ${sbplString(root)}))`).join('');
        return [...head.slice(0, 2), `${head[2]}${extra}`, ...head.slice(3), ...tail];
    }
    // bwrap: --ro-bind / / ... (a writable bind per root)
    if (head.includes('--ro-bind')) {
        return [...head, ...roots.flatMap(root => ['--bind', root, root]), ...tail];
    }
    // Landlock launcher: --ro <path> / --rw <path> grants
    if (head.includes('--ro') || head.includes('--rw')) {
        return [...head, ...roots.flatMap(root => ['--rw', root]), ...tail];
    }
    // windows-acl and any future runner: not expressible here.
    return undefined;
}
//# sourceMappingURL=argv.js.map