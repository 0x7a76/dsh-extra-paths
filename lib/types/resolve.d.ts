/**
 * The one place a configuration becomes a set of effective writable roots.
 * Enforcement (both wrappers) and the settings preview call this, so what the
 * page shows and what the sandbox grants cannot drift.
 * @module dsh-extra-paths/resolve
 */
import type { ExtraPathsConfig, Scope, Surface } from './config.js';
/** One effective root after canonicalisation and merging. */
export interface ResolvedRoot {
    /** The configured spelling that first produced this root (for messages). */
    readonly raw: string;
    /** The canonical absolute root. */
    readonly root: string;
    /** The widest scope across every entry that produced this root. */
    readonly scope: Scope;
    /** The union of surfaces across every entry that produced this root. */
    readonly surfaces: readonly Surface[];
}
/** Per-entry outcome, in configured order (what the settings preview renders). */
export interface EntryResolution {
    readonly raw: string;
    readonly resolved: string;
    readonly scope: Scope;
    readonly surfaces: readonly Surface[];
    readonly status: 'ok' | 'missing' | 'rejected';
}
/**
 * One resolution pass.
 *
 * Contract for consumers:
 * - **Re-resolve per decision, never cache.** The result depends on the
 *   filesystem's CURRENT state (existence) and on `$HOME`, so a cached report
 *   would freeze an entry inactive — or worse, keep granting a root that moved.
 *   The one deliberate exception is a pattern's directory EXPANSION, which is
 *   cached for {@link PATTERN_CACHE_MS} because walking a tree on every write
 *   would be wasteful; a literal entry is never cached.
 * - **Grants are a union, and the widest ancestor wins.** Nested roots are both
 *   kept: a narrower child cannot narrow a broader parent, so a target under the
 *   child is granted by whichever root matches first (every root is one the user
 *   configured, so this never grants outside the configured set).
 * - A root that exists but is not a directory is still reported `ok`; writes
 *   beneath it fail at the filesystem layer (ENOTDIR), not here.
 */
export interface ResolveReport {
    readonly roots: readonly ResolvedRoot[];
    readonly entries: readonly EntryResolution[];
    readonly warnings: readonly string[];
}
/**
 * How long one pattern's expansion is reused (milliseconds). Long enough that a
 * broad `**` walk costs one hiccup rather than one per five seconds; short enough
 * that a worktree created a moment ago shows up without any manual refresh.
 */
export declare const PATTERN_CACHE_MS = 30000;
/** Drop every cached expansion (a fresh directory should not wait out the TTL). */
export declare function clearPatternCache(): void;
/**
 * Resolve every configured entry against one session workspace.
 * @param config - the normalised configuration.
 * @param workspaceRoot - the session workspace a relative entry resolves against.
 * @returns effective roots plus per-entry detail and warnings.
 */
export declare function resolveRoots(config: ExtraPathsConfig, workspaceRoot: string): ResolveReport;
