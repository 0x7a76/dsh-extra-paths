/**
 * The plugin's configuration vocabulary: a plugin-level default access level and
 * surface set, plus per-path entries that override them. Everything here is
 * pure so the settings schema, the CLI-facing validator, and the enforcement
 * layers share one normalisation.
 *
 * 0.3.0 widened the old `scope` (`write` | `always-write`) into a full access
 * level: `deny` (no read, no write), `read` (read-only, even inside the
 * workspace), `write` (writable while the session policy is workspace-write)
 * and `always-write` (writable under read-only too). The legacy `scope` field
 * and `defaultScope` are still accepted and map onto the new vocabulary, so an
 * existing settings document keeps working unchanged.
 * @module dsh-extra-paths/config
 */
import { classifySpelling, isAbsoluteSpelling, isBareNameSpelling, isVolumeRootSpelling, normalizePatternSpelling } from './platform.js';
/** All access levels, from most restrictive to most permissive. */
export const ACCESSES = ['deny', 'read', 'write', 'always-write'];
/** All surfaces. `fs` is the write/edit tool family; `shell` is the subprocess sandbox. */
export const SURFACES = ['fs', 'shell'];
const DEFAULT_ACCESS = 'write';
const DEFAULT_SURFACES = [...SURFACES];
function readAccess(value, fallback, label) {
    if (value === undefined)
        return fallback;
    if (typeof value === 'string' && ACCESSES.includes(value))
        return value;
    throw new Error(`${label}: access must be one of ${ACCESSES.join(' | ')}, received ${JSON.stringify(value)}`);
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
 * Pick one entry's access level, resolving the legacy `scope` alias. Writing
 * both spellings with DIFFERENT meanings is a configuration error: silently
 * preferring one would store a rule the user did not intend.
 */
function readEntryAccess(entry, fallback, label) {
    const access = readAccess(entry.access, fallback, `${label}.access`);
    if (entry.scope === undefined)
        return access;
    const legacy = readAccess(entry.scope, fallback, `${label}.scope`);
    if (entry.access !== undefined && legacy !== access) {
        throw new Error(`${label}: access ${JSON.stringify(access)} conflicts with legacy scope ${JSON.stringify(legacy)}; `
            + 'use one spelling');
    }
    // Without an explicit `access`, the legacy `scope` is the entry's level (the
    // old document only ever stored `scope`, so this is the migration path).
    return entry.access === undefined ? legacy : access;
}
/**
 * The canonical comparison key used by the duplicate check. Windows spellings
 * are compared case-insensitively with both separator kinds stripped (Windows
 * treats them as the same path); POSIX spellings only lose a trailing `/`.
 */
function duplicateKey(path) {
    // A bare name is a NAME RULE, not a path: two identical names are one rule.
    if (isBareNameSpelling(path))
        return `name:${path}`;
    const kind = classifySpelling(path);
    if (kind === 'windows-absolute' || kind === 'windows-home') {
        // `windows-home` cannot be collapsed without the home directory; a lexical
        // separator/case fold is enough for a duplicate check.
        return path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
    }
    return path.replace(/\/+$/, '') || '/';
}
/**
 * Normalise untrusted configuration, applying defaults and rejecting anything
 * the enforcement layers could not act on.
 * @param raw - the settings section or entry config.
 * @returns the normalised configuration.
 * @throws {Error} on a malformed entry, unknown vocabulary, or empty surfaces.
 */
export function normalizeConfig(raw) {
    const legacyDefault = raw?.defaultScope === undefined ? undefined : readAccess(raw.defaultScope, DEFAULT_ACCESS, 'defaultScope');
    const defaultAccess = raw?.defaultAccess === undefined
        ? (legacyDefault ?? DEFAULT_ACCESS)
        : readAccess(raw.defaultAccess, legacyDefault ?? DEFAULT_ACCESS, 'defaultAccess');
    if (legacyDefault !== undefined && raw?.defaultAccess !== undefined && legacyDefault !== defaultAccess) {
        throw new Error(`defaultAccess ${JSON.stringify(defaultAccess)} conflicts with legacy defaultScope `
            + `${JSON.stringify(legacyDefault)}; use one spelling`);
    }
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
        return { path: entry.path.trim(), access: readEntryAccess(entry, defaultAccess, label), surfaces };
    });
    return { defaultAccess, defaultSurfaces, paths };
}
/**
 * Whether a spelling names a filesystem root (or a bare drive), which would
 * disable the sandbox outright. A bare drive (`C:`) is drive-RELATIVE rather
 * than a root, but it is rejected conservatively: on Windows it can still
 * resolve to a whole volume, and the message says so instead of mislabelling it.
 * @param path - a path spelling.
 * @returns true for `/`, `C:`, `C:\`, `C:/` and a UNC share root.
 */
export function isFilesystemRoot(path) {
    return isVolumeRootSpelling(path);
}
/**
 * Reject one pattern the resolver could never walk safely. The grammar and the
 * walk caps live in `pattern.ts`; this is the SAVE-TIME gate so the user learns
 * before a walk is ever attempted.
 *
 * Two anchor families:
 * - ABSOLUTE (`/…`, `~`, `C:\…`): needs at least two literal segments and must
 *   not start at a volume root — `/**` and `~/**` would walk a filesystem/home;
 * - WORKSPACE-RELATIVE (a leading `**` then `.git`, an anchor directory then
 *   the same, or a leading `..` then `**` then the name): anchored at
 *   the session workspace like a relative path, so no minimum depth; a leading
 *   wildcard pattern must still contain one literal segment, or it would sweep
 *   the whole workspace.
 */
function validatePattern(path, label) {
    const source = normalizePatternSpelling(path);
    if (!source.includes('*'))
        return;
    const segments = source.split('/').filter(segment => segment !== '');
    const firstWildcard = segments.findIndex(segment => segment.includes('*'));
    const anchorPrefix = source.slice(0, source.indexOf('*'));
    // Absoluteness is judged on the RAW prefix (see pattern.ts): `/**` strips to
    // an empty anchor but is still an absolute root pattern.
    const absoluteAnchor = isAbsoluteSpelling(anchorPrefix);
    const anchorSpelling = anchorPrefix.replace(/\/+$/, '');
    const walk = segments.slice(firstWildcard);
    if (absoluteAnchor) {
        const anchorDepth = segments.slice(0, firstWildcard).length;
        if (anchorDepth < 2) {
            throw new Error(`${label}: pattern ${JSON.stringify(path)} needs a literal anchor of at least two segments `
                + '(for example ~/projects/**/.worktrees/..)');
        }
        if (isVolumeRootSpelling(anchorSpelling)) {
            throw new Error(`${label}: pattern ${JSON.stringify(path)} starts at a volume root and would walk a whole volume`);
        }
    }
    else if (anchorSpelling === '' && !walk.some(segment => !segment.includes('*') && segment !== '..')) {
        throw new Error(`${label}: pattern ${JSON.stringify(path)} would sweep the whole workspace; `
            + 'add a literal segment (for example **/.git) or an anchor directory');
    }
    let last = walk.length - 1;
    while (last >= 0 && walk[last] === '..')
        last -= 1;
    if (walk.slice(0, last + 1).includes('..')) {
        throw new Error(`${label}: '..' may only appear at the END of a pattern, received ${JSON.stringify(path)}`);
    }
}
/**
 * The settings service's `validate` hook: refuse a write the plugin could never
 * act on, so the user learns at save time instead of storing a dead section.
 * A `foreign` entry (a Windows path on a POSIX host) is NOT an error: one shared
 * configuration must remain savable on every platform and simply stays inactive.
 * @param raw - the resolved section the write would store.
 * @throws {Error} on a duplicate literal entry, an ambiguous drive-relative
 *   spelling, a volume root, or an unsafe pattern.
 */
export function validateConfig(raw) {
    const config = normalizeConfig(raw);
    const firstSeen = new Map();
    config.paths.forEach((entry, index) => {
        const label = `paths[${index}]`;
        // A bare name (`.git`, `.env`) is matched at any depth; it is neither a
        // volume root nor a wildcard pattern, so only the duplicate check applies.
        // All four access levels stay legal (the docs recommend deny/read, but a
        // name-scoped grant is expressible and the user may want it).
        if (isBareNameSpelling(entry.path)) {
            const key = `name:${entry.path}`;
            const first = firstSeen.get(key);
            if (first !== undefined) {
                throw new Error(`${label}: duplicate name rule ${JSON.stringify(entry.path)} (first configured at paths[${first}])`);
            }
            firstSeen.set(key, index);
            return;
        }
        // The root check runs FIRST: for ['//', '/'] the duplicate key would
        // otherwise report the less useful of two true reasons.
        if (isFilesystemRoot(entry.path)) {
            throw new Error(`${label}: ${JSON.stringify(entry.path)} names a filesystem root (or a bare drive) `
                + 'and would disable the sandbox');
        }
        if (classifySpelling(entry.path) === 'windows-drive-relative') {
            throw new Error(`${label}: ${JSON.stringify(entry.path)} is a drive-relative path (it depends on that drive's current `
                + 'directory); use an absolute path such as C:\\<dir>');
        }
        const key = duplicateKey(entry.path);
        const first = firstSeen.get(key);
        if (first !== undefined) {
            throw new Error(`${label}: duplicate path entry ${JSON.stringify(entry.path)} (first configured at paths[${first}])`);
        }
        firstSeen.set(key, index);
        validatePattern(entry.path, label);
    });
}
//# sourceMappingURL=config.js.map