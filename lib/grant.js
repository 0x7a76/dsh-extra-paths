/**
 * The mode gate: which configured roots one call may write under.
 * `write` rides the session mode; `always-write` survives `read-only` too.
 * @module dsh-extra-paths/grant
 */
/**
 * Select the roots a call under `mode` may write under for one surface.
 * @param mode - the resolved per-call sandbox mode.
 * @param roots - effective roots for this session workspace.
 * @param surface - the enforcement surface asking.
 * @returns the roots to grant; empty means "delegate unchanged".
 */
export function grantFor(mode, roots, surface) {
    if (mode === 'danger-full-access')
        return [];
    const candidates = roots.filter(root => root.surfaces.includes(surface));
    if (mode === 'workspace-write')
        return candidates;
    return candidates.filter(root => root.scope === 'always-write');
}
//# sourceMappingURL=grant.js.map