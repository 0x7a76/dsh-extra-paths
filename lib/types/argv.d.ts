/**
 * Runner-dialect widening: append one write grant per configured root to an
 * argv the base provider already wrapped. Detection is structural (flags, not
 * program names) and every unrecognised shape fails closed by returning
 * `undefined` — the caller then leaves the argv untouched, so the write is
 * denied rather than silently mis-granted.
 * @module dsh-extra-paths/argv
 */
/**
 * Insert write grants for `roots` into a confined argv.
 * @param confined - the argv the base provider produced (runner, profile, `--`, command).
 * @param wrappedLength - length of the caller's original argv, which locates the separator.
 * @param roots - canonical roots to grant.
 * @returns the widened argv, the unchanged argv when there is nothing to grant,
 *   or `undefined` when the dialect is unrecognised (the caller must not grant).
 */
export declare function widenArgv(confined: readonly string[], wrappedLength: number, roots: readonly string[]): readonly string[] | undefined;
