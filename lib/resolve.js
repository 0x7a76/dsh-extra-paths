/**
 * The one place a configuration becomes a set of effective writable roots.
 * Enforcement (both wrappers) and the settings preview call this, so what the
 * page shows and what the sandbox grants cannot drift.
 * @module dsh-extra-paths/resolve
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { SURFACES, isFilesystemRoot } from './config.js';
import { expandPattern, isPattern, parsePattern, PATTERN_LIMITS } from './pattern.js';
import { canonicalizeRoot, expandPath, isUnder } from './paths.js';
/**
 * How long one pattern's expansion is reused (milliseconds). Long enough that a
 * broad `**` walk costs one hiccup rather than one per five seconds; short enough
 * that a worktree created a moment ago shows up without any manual refresh.
 */
export const PATTERN_CACHE_MS = 30000;
/** Expansions seen recently, keyed by the configured spelling. */
const patternCache = new Map();
/** Drop every cached expansion (a fresh directory should not wait out the TTL). */
export function clearPatternCache() {
    patternCache.clear();
}
/**
 * Expand one pattern, reusing a recent expansion.
 * @param raw - the configured spelling.
 * @param workspaceRoot - the session workspace a relative anchor resolves against.
 * @param now - current time in milliseconds (injected for tests).
 * @returns the matches and whether a cap was hit.
 */
function expansionOf(raw, workspaceRoot, now) {
    const cached = patternCache.get(raw);
    if (cached !== undefined && now - cached.at < PATTERN_CACHE_MS) {
        return {
            matches: cached.matches,
            capped: cached.capped,
            ...(cached.cap === undefined ? {} : { cap: cached.cap }),
            ...(cached.truncated === undefined ? {} : { truncated: cached.truncated }),
        };
    }
    const parsed = parsePattern(raw, workspaceRoot);
    const expansion = parsed === undefined
        ? { matches: [], capped: true, cap: 'anchor' }
        : expandPattern(parsed);
    patternCache.set(raw, {
        at: now,
        matches: expansion.matches,
        capped: expansion.capped,
        ...(expansion.cap === undefined ? {} : { cap: expansion.cap }),
        ...('truncated' in expansion && expansion.truncated === true ? { truncated: true } : {}),
    });
    return {
        matches: expansion.matches,
        capped: expansion.capped,
        ...(expansion.cap === undefined ? {} : { cap: expansion.cap }),
        ...('truncated' in expansion && expansion.truncated === true ? { truncated: true } : {}),
    };
}
/**
 * Whether a root contains (or is) the home directory. Exact equality alone is
 * not enough: `~/..` canonicalises to the directory holding every user's home,
 * which is strictly broader than `~` yet would otherwise pass unwarned.
 * @param root - canonical root under test.
 * @param homeRoot - canonical home directory, resolved once per pass.
 * @returns true when home lies at or beneath the root.
 */
function containsHome(root, homeRoot) {
    return isUnder(homeRoot, root);
}
/**
 * Resolve every configured entry against one session workspace.
 * @param config - the normalised configuration.
 * @param workspaceRoot - the session workspace a relative entry resolves against.
 * @returns effective roots plus per-entry detail and warnings.
 */
export function resolveRoots(config, workspaceRoot) {
    const entries = [];
    const warnings = [];
    const byRoot = new Map();
    // Probed at most once per pass — and not at all when no entry is active,
    // because this runs on every enforcement decision.
    let homeRoot;
    const now = Date.now();
    const acceptEntry = (raw, scope, surfaces, root) => {
        // A COPY of the caller's array: handing the config's own instance to a
        // report lets a caller mutate future grants through it.
        const shared = { raw, resolved: root, scope, surfaces: [...surfaces] };
        if (isFilesystemRoot(root)) {
            entries.push({ ...shared, status: 'rejected' });
            warnings.push(`extra-paths: ${JSON.stringify(raw)} resolves to the filesystem root; the entry is ignored`);
            return;
        }
        if (!existsSync(root)) {
            entries.push({ ...shared, status: 'missing' });
            warnings.push(`extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which does not exist; the entry is inactive until it does`);
            return;
        }
        entries.push({ ...shared, status: 'ok' });
        homeRoot ??= canonicalizeRoot(homedir());
        if (containsHome(root, homeRoot)) {
            warnings.push(`extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which contains your entire home directory; `
                + 'prefer a narrower root');
        }
        if (root !== workspaceRoot && isUnder(workspaceRoot, root)) {
            warnings.push(`extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which contains this session's workspace; `
                + 'prefer a sibling-scoped root');
        }
        const existing = byRoot.get(root);
        if (existing === undefined) {
            // SURFACES order here too, not only on merge: a lone entry spelled
            // ['shell', 'fs'] must yield the same root identity as ['fs', 'shell'].
            const ordered = SURFACES.filter(surface => surfaces.includes(surface));
            byRoot.set(root, { raw, root, scope, surfaces: ordered });
            return;
        }
        const merged = existing.scope === 'always-write' || scope === 'always-write' ? 'always-write' : 'write';
        // SURFACES order, not insertion order: a config edit that only reorders
        // surfaces must not change a report's identity.
        const present = new Set([...existing.surfaces, ...surfaces]);
        byRoot.set(root, { raw: existing.raw, root, scope: merged, surfaces: SURFACES.filter(surface => present.has(surface)) });
    };
    for (const entry of config.paths) {
        if (!isPattern(entry.path)) {
            acceptEntry(entry.path, entry.scope, entry.surfaces, canonicalizeRoot(expandPath(entry.path, workspaceRoot)));
            continue;
        }
        const expansion = expansionOf(entry.path, workspaceRoot, now);
        if (expansion.capped) {
            entries.push({ raw: entry.path, resolved: '', scope: entry.scope, surfaces: [...entry.surfaces], status: 'rejected' });
            const reason = expansion.cap === 'anchor'
                ? 'its anchor is not walkable (needs a literal absolute or ~/ path at least two segments deep)'
                : expansion.cap === 'matches'
                    ? `it matches more than ${PATTERN_LIMITS.maxMatches} directories`
                    : `it examined more than ${PATTERN_LIMITS.maxDirs} directories`;
            warnings.push(`extra-paths: pattern ${JSON.stringify(entry.path)} was not expanded because ${reason}; `
                + 'nothing is granted for it — narrow the pattern, name a deeper anchor, or spell the levels explicitly');
            continue;
        }
        if (expansion.truncated === true) {
            warnings.push(`extra-paths: pattern ${JSON.stringify(entry.path)} searched only ${PATTERN_LIMITS.maxDepth} levels below its anchor; `
                + 'spell the deeper levels explicitly if a matching directory lives further down');
        }
        if (expansion.matches.length === 0) {
            entries.push({ raw: entry.path, resolved: '', scope: entry.scope, surfaces: [...entry.surfaces], status: 'missing' });
            warnings.push(`extra-paths: pattern ${JSON.stringify(entry.path)} matches no existing directory; the entry is inactive until one appears`);
            continue;
        }
        for (const match of expansion.matches)
            acceptEntry(entry.path, entry.scope, entry.surfaces, match);
    }
    return { roots: [...byRoot.values()], entries, warnings: [...new Set(warnings)] };
}
//# sourceMappingURL=resolve.js.map