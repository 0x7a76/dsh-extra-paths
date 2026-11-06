/**
 * NAME RULES: a configured path that is a single component (`.git`, `.env`,
 * `node_modules`) means "that component at any depth", not one literal path.
 *
 * Why: protecting the same handful of names in every repository should not need
 * a full path (or a walk-everything pattern) per checkout. A bare name is the
 * cheapest possible spelling of "this structure anywhere in my projects".
 *
 * Two different jobs, deliberately separate:
 * - {@link findNameComponent} is the LEXICAL, filesystem-free test the fs
 *   wrapper runs per call: it walks the target's components under the scope
 *   roots and returns the matched component path (or undefined). It costs
 *   nothing and applies to files created a moment ago.
 * - {@link expandNameMatches} is the bounded filesystem WALK. It exists ONLY for
 *   the settings preview's "N matches right now" display: the shell surface
 *   deliberately does not enumerate bare names (that was costly, stale and
 *   partial in the real host), so no enforcement path walks. The preview caches
 *   the walk and reports when a cap makes the count partial; fs stays exact
 *   either way.
 *
 * Scope (chosen by the user): the session workspace plus every configured
 * writable root. A name is compared case-insensitively on a Windows host.
 * @module dsh-extra-paths/name-rule
 */
import type { Access, Surface } from './config.js';
import { type PlatformFacts } from './paths.js';
/** A bare name after classification (the configured spelling is kept for messages). */
export interface NameRule {
    /** The configured spelling, e.g. `.git`. */
    readonly raw: string;
    /** The component name to match. */
    readonly name: string;
    readonly access: Access;
    readonly surfaces: readonly Surface[];
}
/** Caps that keep one name-rule walk bounded (same spirit as the pattern limits). */
export declare const NAME_RULE_LIMITS: {
    /** Directory entries examined in one expansion pass. */
    readonly maxDirs: 8192;
    /** Directory levels walked below each scope root. */
    readonly maxDepth: 12;
    /** Paths one name rule may match (each match becomes a sandbox rule). */
    readonly maxMatches: 256;
    /** How long one expansion is reused (milliseconds). */
    readonly cacheMs: 30000;
};
/** One bounded walk's result. `complete: false` means the list is not exhaustive. */
export interface NameExpansion {
    /**
     * Concrete matched paths (canonical, sorted, deduplicated). Matches FOUND in a
     * partially walked scope root stay here: denying more concrete paths is always
     * safe, and dropping them would remove shell protection from the very tree the
     * user configured. The warning is what tells the user coverage is partial.
     */
    readonly matches: readonly string[];
    /** A runaway cap stopped the walk; the list is not exhaustive. */
    readonly capped: boolean;
    /** Which cap stopped it. */
    readonly cap?: 'directories' | 'matches';
    /** The depth bound or an unreadable entry cut the walk short. */
    readonly truncated: boolean;
    /**
     * Scope roots whose walk could not be finished (cap, depth, unreadable entry,
     * skipped symlink match). Completeness is tracked PER ROOT so one unreadable or
     * very deep writable root cannot silently discard the matches found in every
     * other root — precisely the failure that made a `.git` rule protect the fs
     * tools but not the shell because `~/.dsh` contains a deep runtime tree.
     */
    readonly incompleteRoots: readonly string[];
    /** Symlink name matches were skipped (a sandbox cannot reliably mask a link). */
    readonly skippedSymlinks: number;
    /** Directory entries examined. */
    readonly scanned: number;
    /** True when every scope root was fully walked (no cap, no skip). */
    readonly complete: boolean;
}
/**
 * Build the scope roots of every name rule: the session workspace plus every
 * configured writable root, deduplicated and with nested roots dropped (a root
 * inside another cannot add a match the outer walk would miss).
 * @param workspaceRoot - the session workspace (canonical).
 * @param writableRoots - canonical roots of the configured write entries.
 * @returns scope roots in walk order.
 */
export declare function scopeRootsOf(workspaceRoot: string, writableRoots: readonly string[], facts: PlatformFacts): readonly string[];
/**
 * The LEXICAL match: find the first component named `name` on the path from one
 * of the scope roots down to the target. No filesystem access, so a name rule
 * applies to a directory the moment it appears.
 * @param targetKey - a canonical target path.
 * @param name - the component name to match.
 * @param scopeRoots - {@link scopeRootsOf} output.
 * @param facts - host facts.
 * @returns the matched component path (the rule's effective root), or undefined.
 */
export declare function findNameComponent(targetKey: string, name: string, scopeRoots: readonly string[], facts: PlatformFacts): string | undefined;
/**
 * The bounded filesystem walk for one name rule: enumerate concrete matches so
 * the shell sandbox can deny them.
 *
 * Matching stops at a match (the rule covers its whole subtree, so descending is
 * wasted work), and the walk never descends into `node_modules`/`.git` (their
 * own names are still matched at their level). Symlinked matches are SKIPPED and
 * counted: a sandbox cannot reliably mask a link destination, so the caller must
 * report the incompleteness instead of pretending the path is covered.
 * @param name - the component name to match.
 * @param scopeRoots - {@link scopeRootsOf} output.
 * @param facts - host facts.
 * @param limits - caps (tests pass a small budget to pin the degraded path).
 * @returns the concrete matches plus the completeness verdict.
 */
export declare function expandNameMatches(name: string, scopeRoots: readonly string[], facts: PlatformFacts, limits?: typeof NAME_RULE_LIMITS): NameExpansion;
