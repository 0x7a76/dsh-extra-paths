/**
 * The plugin's configuration vocabulary: a plugin-level default scope and
 * surface set, plus per-path entries that override them. Everything here is
 * pure so the settings schema, the CLI-facing validator, and the enforcement
 * layers share one normalisation.
 * @module dsh-extra-paths/config
 */
/** All scopes, in escalation order. */
export const SCOPES = ['write', 'always-write'];
/** All surfaces. `fs` is the write/edit tool family; `shell` is the subprocess sandbox. */
export const SURFACES = ['fs', 'shell'];
const DEFAULT_SCOPE = 'write';
const DEFAULT_SURFACES = [...SURFACES];
function readScope(value, fallback, label) {
    if (value === undefined)
        return fallback;
    if (typeof value === 'string' && SCOPES.includes(value))
        return value;
    throw new Error(`${label}: scope must be one of ${SCOPES.join(' | ')}, received ${JSON.stringify(value)}`);
}
function readSurfaces(value, fallback, label) {
    if (value === undefined)
        return [...fallback];
    if (!Array.isArray(value))
        throw new Error(`${label}: surfaces must be an array, received ${JSON.stringify(value)}`);
    const surfaces = [];
    for (const item of value) {
        if (typeof item !== 'string' || !SURFACES.includes(item)) {
            throw new Error(`${label}: unknown surface ${JSON.stringify(item)}; expected ${SURFACES.join(' | ')}`);
        }
        if (!surfaces.includes(item))
            surfaces.push(item);
    }
    return surfaces;
}
/**
 * Normalise untrusted configuration, applying defaults and rejecting anything
 * the enforcement layers could not act on.
 * @param raw - the settings section or entry config.
 * @returns the normalised configuration.
 * @throws {Error} on a malformed entry, unknown vocabulary, or empty surfaces.
 */
export function normalizeConfig(raw) {
    const defaultScope = readScope(raw?.defaultScope, DEFAULT_SCOPE, 'defaultScope');
    const defaultSurfaces = readSurfaces(raw?.defaultSurfaces, DEFAULT_SURFACES, 'defaultSurfaces');
    const list = raw?.paths;
    if (list !== undefined && !Array.isArray(list)) {
        throw new Error(`paths: expected an array, received ${JSON.stringify(list)}`);
    }
    const paths = (list ?? []).map((item, index) => {
        const label = `paths[${index}]`;
        const entry = (typeof item === 'string' ? { path: item } : item ?? {});
        if (typeof entry.path !== 'string' || entry.path.trim() === '') {
            throw new Error(`${label}: path must be a non-empty string, received ${JSON.stringify(entry.path)}`);
        }
        const surfaces = readSurfaces(entry.surfaces, defaultSurfaces, label);
        if (surfaces.length === 0) {
            const cause = entry.surfaces === undefined && defaultSurfaces.length === 0 ? ' (defaultSurfaces is empty)' : '';
            throw new Error(`${label}: at least one surface is required${cause}`);
        }
        return { path: entry.path.trim(), scope: readScope(entry.scope, defaultScope, label), surfaces };
    });
    return { defaultScope, defaultSurfaces, paths };
}
/**
 * Whether a path names a filesystem root, which would disable the sandbox
 * outright. A bare drive (`C:`) is drive-RELATIVE rather than a root, but it is
 * rejected conservatively: on Windows it can still resolve to a whole volume,
 * and the message says so instead of mislabelling it.
 */
export function isFilesystemRoot(path) {
    return path === '/' || /^[A-Za-z]:[\\/]?$/.test(path);
}
/**
 * The settings service's `validate` hook: refuse a write the plugin could never
 * act on, so the user learns at save time instead of storing a dead section.
 * @param raw - the resolved section the write would store.
 * @throws {Error} on a duplicate literal entry or a filesystem root.
 */
export function validateConfig(raw) {
    const config = normalizeConfig(raw);
    // Trailing separators are stripped for the duplicate key so `/a` and `/a/`
    // collide here rather than silently merging later; `/` keeps its meaning.
    const firstSeen = new Map();
    config.paths.forEach((entry, index) => {
        // The root check runs FIRST: for ['//', '/'] the duplicate key would
        // otherwise report the less useful of two true reasons.
        if (isFilesystemRoot(entry.path)) {
            throw new Error(`paths[${index}]: ${JSON.stringify(entry.path)} names a filesystem root (or a bare drive) `
                + 'and would disable the sandbox');
        }
        // Both separator kinds are stripped so the rule matches its own name on
        // either platform's spelling; a spelling that strips to empty is the root
        // itself (already rejected above).
        const key = entry.path.replace(/[\\/]+$/, '') || '/';
        const first = firstSeen.get(key);
        if (first !== undefined) {
            throw new Error(`paths[${index}]: duplicate path entry ${JSON.stringify(entry.path)} (first configured at paths[${first}])`);
        }
        firstSeen.set(key, index);
        // A PATTERN (see `pattern.ts`) is only walkable when its literal anchor is
        // deep enough to bound the search: `~/projects/**` is fine, `~/**` and `/**`
        // would walk a whole home directory or the filesystem and are refused here
        // rather than silently yielding nothing at resolve time.
        if (entry.path.includes('*')) {
            const segments = entry.path.split('/').filter(segment => segment !== '');
            const firstWildcard = segments.findIndex(segment => segment.includes('*'));
            const anchorDepth = segments.slice(0, firstWildcard).length;
            if (anchorDepth < 2) {
                throw new Error(`paths[${index}]: pattern ${JSON.stringify(entry.path)} needs a literal anchor of at least two segments `
                    + '(for example ~/projects/**/.worktrees/..)');
            }
            const walk = segments.slice(firstWildcard);
            let last = walk.length - 1;
            while (last >= 0 && walk[last] === '..')
                last -= 1;
            if (walk.slice(0, last + 1).includes('..')) {
                throw new Error(`paths[${index}]: '..' may only appear at the END of a pattern, received ${JSON.stringify(entry.path)}`);
            }
        }
    });
}
//# sourceMappingURL=config.js.map