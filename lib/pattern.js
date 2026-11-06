/**
 * Root patterns: a configured spelling may describe a SET of directories instead
 * of one literal path, so a grant can be anchored to a structure (a directory
 * that CONTAINS `.worktrees`) rather than to a hand-written path.
 *
 * Grammar — every other segment is a literal directory name:
 * - `*`  exactly one existing directory name;
 * - `**` zero or more existing directory names (any depth);
 * - one or more TRAILING `..` segments are applied to each MATCH, after
 *   matching, so `…/**​/.worktrees/..` means "the directory that contains a
 *   `.worktrees` child" and is not eaten by lexical collapsing.
 *
 * Matching only ever yields directories that EXIST, which is what makes "the path
 * contains `.worktrees`" a structural condition rather than a spelling.
 *
 * A Windows spelling is parsed in its OWN dialect first (`C:\a\**`, `\\server\…`):
 * separators are normalised for the grammar, and the literal anchor is translated
 * through `expandConfiguredPath`, so the same configuration also works on the
 * other platform. A spelling whose anchor cannot be expressed on this host is
 * `foreign`: inactive with one warning, never a save failure.
 *
 * Safety envelope, enforced here and validated again at save time:
 * - the literal prefix before the first wildcard is the anchor; it must be
 *   absolute in its own dialect after `~` expansion, must not resolve to a
 *   volume root (including a translated WSL drive root), and must not CONTAIN
 *   the home directory — a pattern can never walk `/`, `/Users` or `~`;
 * - the walk never descends into `node_modules` or `.git`;
 * - every cap (depth, directories scanned, matches) makes the WHOLE pattern yield
 *   nothing (fail closed) instead of a partial set: a half-expanded grant would
 *   be an unpredictable permission.
 * @module dsh-extra-paths/pattern
 */
import { readdirSync, statSync } from 'node:fs';
import { isAbsoluteSpelling, normalizePatternSpelling } from './platform.js';
import { canonicalizeRoot, discoverPlatformFacts, expandConfiguredPath, isHostVolumeRootPath, isUnder, pathApiOf, } from './paths.js';
/** Caps that keep one pattern's expansion bounded. */
export const PATTERN_LIMITS = {
    /** Directory entries examined in one expansion. */
    maxDirs: 4096,
    /** Matches one pattern may yield. */
    maxMatches: 256,
    /**
     * `**` levels walked below the anchor. Deliberately small: a repository that
     * keeps its worktrees in `.worktrees` sits one or two levels down, and every
     * extra level multiplies the walk into unrelated source trees. A deeper
     * structure is spelled explicitly, level by level, instead of with `**`.
     */
    maxDepth: 3,
};
/** Names the walk never descends into. */
const PRUNED = new Set(['node_modules', '.git']);
/** Whether a spelling is a pattern rather than a literal path. */
export function isPattern(raw) {
    // The wildcard may sit after Windows separators, so detection runs on the
    // normalised spelling — a `\` is a legal POSIX filename character and is left
    // untouched there.
    return normalizePatternSpelling(raw).includes('*');
}
/**
 * Parse a pattern spelling and keep the reason when it cannot be walked.
 * @param raw - the configured spelling (POSIX or Windows).
 * @param workspaceRoot - the base a relative anchor resolves against.
 * @param facts - host facts (defaults to the discovered ones); the anchor is
 *   translated into the host's dialect with these.
 * @returns the pattern, or a rejection that says whether it is merely foreign.
 */
export function parsePatternOutcome(raw, workspaceRoot, facts = discoverPlatformFacts()) {
    // The grammar is separator-agnostic: a Windows spelling keeps its dialect for
    // translation, but '*' detection and segment splitting see `/`.
    const spelling = normalizePatternSpelling(raw);
    const segments = spelling.split('/').filter(segment => segment !== '');
    const firstWildcard = segments.findIndex(segment => segment.includes('*'));
    if (firstWildcard < 0)
        return { ok: false };
    // Trailing `..` run: applied AFTER matching, so it must not be part of the walk.
    let end = segments.length;
    let up = 0;
    while (end > firstWildcard && segments[end - 1] === '..') {
        up += 1;
        end -= 1;
    }
    const walk = segments.slice(firstWildcard, end);
    if (walk.length === 0)
        return { ok: false };
    // The anchor spelling keeps its own leading `/`, `~` or drive prefix. Rebuilding
    // it from the filtered segments would turn `/a/b/**` into the RELATIVE `a/b` and
    // resolve the walk against the session workspace instead of `/a/b` — the defect
    // this guard was extracted from.
    const anchorPrefix = spelling.slice(0, spelling.indexOf('*'));
    // Absoluteness is judged on the RAW prefix: `/\*\*` strips to an empty
    // anchor and must stay an absolute (and rejected) root, not become a
    // workspace-relative sweep.
    const absoluteAnchor = isAbsoluteSpelling(anchorPrefix);
    const anchorSpelling = anchorPrefix.replace(/\/+$/, '');
    // A workspace-ROOT anchor (leading wildcard, no literal prefix) must not be a
    // pure sweep: `**` / `**/*` alone would walk everything under the workspace.
    // Patterns with a literal anchor keep the documented trailing-`**` meaning.
    if (!absoluteAnchor && anchorSpelling === ''
        && !walk.some(segment => !segment.includes('*') && segment !== '..')) {
        return { ok: false };
    }
    let anchor;
    if (absoluteAnchor) {
        // `/**`, `~/**` and `/srv/**` would walk the filesystem, a whole home
        // directory, or a top-level directory: an ABSOLUTE anchor needs two literal
        // segments.
        if (firstWildcard < 2)
            return { ok: false };
        const expanded = expandConfiguredPath(anchorSpelling, workspaceRoot, facts);
        if (!expanded.ok)
            return { ok: false, foreign: expanded.foreign };
        anchor = canonicalizeRoot(expanded.path, facts);
    }
    else {
        // Workspace-relative anchor: an empty prefix (leading wildcard, `**/.git`)
        // walks the workspace itself; a literal prefix walks its subdirectory. The
        // safety checks below apply exactly as for an absolute anchor.
        const expanded = expandConfiguredPath(anchorSpelling === '' ? '.' : anchorSpelling, workspaceRoot, facts);
        if (!expanded.ok)
            return { ok: false, foreign: expanded.foreign };
        anchor = canonicalizeRoot(expanded.path, facts);
    }
    // The anchor is host-native now: the literal-root rejection must run AFTER
    // translation, so `C:\` inside WSL (⇒ `/mnt/c`) is refused as the drive root it
    // is instead of being walked as an ordinary directory.
    if (isHostVolumeRootPath(anchor, facts))
        return { ok: false };
    const homeRoot = canonicalizeRoot(facts.home, facts);
    // An anchor that IS or CONTAINS the home directory would walk far too much.
    if (anchor === homeRoot || isUnder(homeRoot, anchor, facts))
        return { ok: false };
    return { ok: true, pattern: { source: raw, anchor, segments: walk, up, platform: facts } };
}
/**
 * Parse a pattern spelling.
 * @param raw - the configured spelling.
 * @param workspaceRoot - the base a relative anchor resolves against.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the parsed pattern, or undefined when it cannot be walked safely.
 */
export function parsePattern(raw, workspaceRoot, facts = discoverPlatformFacts()) {
    const outcome = parsePatternOutcome(raw, workspaceRoot, facts);
    return outcome.ok ? outcome.pattern : undefined;
}
/**
 * List one directory's direct children, including hidden entries and the pruned
 * names (`node_modules`, `.git`). Pruning is applied by the CALLER: the names
 * themselves must stay matchable — a pattern has to be able to FIND a `.git`
 * directory, it just must never descend inside one. A final LITERAL segment may
 * match a file, so non-directory entries are reported too.
 * @param directory - the directory to list.
 * @param api - the host's `node:path` arithmetic.
 * @returns the child entries, sorted by name; empty when unreadable.
 */
function listChildren(directory, api) {
    let names;
    try {
        names = readdirSync(directory);
    }
    catch {
        return [];
    }
    const children = [];
    for (const name of names.sort()) {
        const child = api.join(directory, name);
        try {
            children.push({ name, path: child, isDirectory: statSync(child).isDirectory() });
        }
        catch {
            // A vanishing entry is not an error: the next pass simply will not see it.
        }
    }
    return children;
}
/**
 * Expand a pattern against the filesystem.
 * @param pattern - the parsed pattern.
 * @param limits - caps to apply (defaults to {@link PATTERN_LIMITS}).
 * @returns the matches, or `{ capped: true }` when a cap was hit.
 */
export function expandPattern(pattern, limits = PATTERN_LIMITS) {
    const api = pathApiOf(pattern.platform);
    const matches = new Set();
    let scanned = 0;
    let capped = false;
    let cap;
    let truncated = false;
    const stop = (which) => {
        capped = true;
        cap ??= which;
    };
    const walk = (directory, index, depth) => {
        if (capped)
            return;
        if (scanned >= limits.maxDirs) {
            stop('directories');
            return;
        }
        scanned += 1;
        if (index === pattern.segments.length) {
            if (matches.size >= limits.maxMatches) {
                stop('matches');
                return;
            }
            matches.add(directory);
            return;
        }
        const segment = pattern.segments[index] ?? '';
        if (segment === '**') {
            // Zero segments consumed — always allowed, so `**` matches the anchor's own
            // level even at the depth bound (checking the bound first would lose a
            // level to an off-by-one).
            walk(directory, index + 1, depth);
            if (capped)
                return;
            if (depth >= limits.maxDepth) {
                // A documented bound, not a failure: keep whatever the walk already
                // found and let the caller mention that deeper levels were not searched.
                truncated = true;
                return;
            }
            // …or one more level, keeping `**` active. Hidden directories and the
            // pruned names are skipped here only: this is the branch that would
            // otherwise wander into every source tree below the anchor.
            for (const child of listChildren(directory, api)) {
                if (!child.isDirectory || child.name.startsWith('.') || PRUNED.has(child.name))
                    continue;
                walk(child.path, index, depth + 1);
                if (capped)
                    return;
            }
            return;
        }
        const isLast = index === pattern.segments.length - 1;
        for (const child of listChildren(directory, api)) {
            const matchesSegment = segment === '*' ? child.isDirectory : segment === child.name;
            if (!matchesSegment)
                continue;
            if (isLast) {
                // A final LITERAL segment may be a file (`**/.env`); a final `*` keeps
                // the historical directories-only meaning.
                if (matches.size >= limits.maxMatches) {
                    stop('matches');
                    return;
                }
                matches.add(child.path);
                continue;
            }
            if (!child.isDirectory || PRUNED.has(child.name))
                continue;
            walk(child.path, index + 1, depth);
            if (capped)
                return;
        }
    };
    walk(pattern.anchor, 0, 0);
    if (capped)
        return { matches: [], capped: true, ...(cap === undefined ? {} : { cap }), scanned };
    const up = pattern.up;
    const resolved = [...matches]
        .map(match => {
        let result = match;
        for (let step = 0; step < up; step += 1)
            result = api.dirname(result);
        return canonicalizeRoot(result, pattern.platform);
    })
        // A trailing `..` run can climb to a volume root; that is as unacceptable as
        // configuring one directly (translated WSL drive roots included).
        .filter(candidate => !isHostVolumeRootPath(candidate, pattern.platform));
    return { matches: [...new Set(resolved)].sort(), capped: false, ...(truncated ? { truncated: true } : {}), scanned };
}
//# sourceMappingURL=pattern.js.map