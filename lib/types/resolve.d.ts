/**
 * The one place a configuration becomes the effective access rules. Enforcement
 * (both wrappers) and the settings preview call this, so what the page shows and
 * what the sandbox grants cannot drift.
 *
 * 0.3.0 widened the report from "writable roots" to four levels: `deny`, `read`,
 * `write`, `always-write`. The aggregation is deliberately NOT "the most
 * specific path wins": a narrower rule must never widen a broader grant by
 * accident, so every rule that covers one canonical root is merged with the
 * STRICTER level winning (`deny > read > write`), and `write`/`always-write`
 * merge to the wider `always-write`. Surfaces are aggregated separately, which
 * is what lets one root be writable for `fs` while the shell may only read it.
 *
 * A BARE NAME (`.git`, `.env`, `node_modules`) is a name rule: it matches that
 * component at any depth under the session workspace plus every configured
 * writable root (see {@link module:dsh-extra-paths/name-rule}). It is resolved
 * in two deliberately different ways:
 * - The report ALWAYS carries `nameRules` (lexical, no filesystem access), which
 *   is all the fs surface needs: it matches the target's components on every
 *   call, so it even covers a directory created a moment ago.
 * - `nameMatches` — the concrete paths a shell profile must deny/grant — needs
 *   a bounded directory walk, so it is filled ONLY when the caller asks for it
 *   (`expandNameRules`). The fs hot path runs once per write and must not walk.
 *
 * @module dsh-extra-paths/resolve
 */
import type { Access, ExtraPathsConfig, Scope, Surface } from './config.js';
import { type PlatformFacts } from './paths.js';
/** One effective writable root after canonicalisation and merging. */
export interface ResolvedRoot {
    /** The configured spelling that first produced this root (for messages). */
    readonly raw: string;
    /** The canonical absolute root. */
    readonly root: string;
    /** The widest writable level across the surfaces that grant write. */
    readonly scope: Scope;
    /** The surfaces this root is writable on. */
    readonly surfaces: readonly Surface[];
}
/** One effective restriction: the surfaces on which a root is read-only or denied. */
export interface ResolvedRule {
    /** The configured spelling that first produced this root (for messages). */
    readonly raw: string;
    /** The canonical absolute root. */
    readonly root: string;
    /** `read` keeps writes out; `deny` keeps reads AND writes out. */
    readonly access: 'read' | 'deny';
    /** The surfaces the restriction applies to. */
    readonly surfaces: readonly Surface[];
}
/** Per-entry outcome, in configured order (what the settings preview renders). */
export interface EntryResolution {
    readonly raw: string;
    readonly resolved: string;
    readonly access: Access;
    readonly surfaces: readonly Surface[];
    readonly status: 'ok' | 'missing' | 'rejected' | 'foreign';
    /**
     * How many concrete paths a NAME RULE currently matches (the paths actually
     * enforced on the shell surface). Present only when the caller asked for
     * `expandNameRules`; a partially walked rule reports the matches it FOUND and
     * carries a warning about the roots it could not finish. A name rule with no
     * `matches` at all is still live for the fs surface: it needs no walk.
     */
    readonly matches?: number;
}
/**
 * One configured BARE NAME (a "name rule"): a single-component spelling such as
 * `.git` or `.env`. It matches that component at any depth under the session
 * workspace plus every configured writable root, and covers the matched path's
 * whole subtree.
 */
export interface ResolvedNameRule {
    /** The configured spelling, kept for messages (no path form exists). */
    readonly raw: string;
    /** The component name the matchers compare against (case-folded on Windows). */
    readonly name: string;
    readonly access: Access;
    readonly surfaces: readonly Surface[];
}
/** One concrete path a name rule currently matches (only produced by an expansion). */
export interface NameMatch {
    readonly rule: ResolvedNameRule;
    /** The matched path; `rule` covers this path and its whole subtree. */
    readonly root: string;
}
/** Optional knobs of one resolution pass. */
export interface ResolveOptions {
    /**
     * Enumerate concrete paths for name rules (`nameMatches`). Default false: the
     * fs wrapper resolves on EVERY read/write and matches names lexically, so it
     * must not pay for a directory walk; the shell surface (a sandbox profile can
     * only name concrete paths) and the settings preview pass true.
     */
    readonly expandNameRules?: boolean;
}
/**
 * One resolution pass.
 *
 * Contract for consumers:
 * - **Re-resolve per decision, never cache.** The result depends on the
 *   filesystem's CURRENT state (existence) and on `$HOME`, so a cached report
 *   would freeze an entry inactive — or worse, keep granting a root that moved.
 *   The one deliberate exception is a directory EXPANSION (a pattern's, or a
 *   name rule's concrete matches), which is cached for its TTL because walking
 *   a tree on every write would be wasteful; a literal entry is never cached.
 * - **Grants are a union, and every rule is a hard rule.** Nested roots are both
 *   kept: a narrower child cannot narrow a broader parent, and a `read`/`deny`
 *   rule is never overridden by a broader writable one — the strictest level
 *   covering the same canonical root wins per surface.
 * - A root that exists but is not a directory is still reported `ok`; writes
 *   beneath it fail at the filesystem layer (ENOTDIR), not here.
 * - A name rule is always a hard fs rule (matched lexically per call). Its shell
 *   form is the bounded enumeration in `nameMatches`; a partial enumeration
 *   keeps the found paths (denying more is safe) and warns about the roots it
 *   could not finish, instead of discarding protection for the whole rule.
 */
export interface ResolveReport {
    /** Writable grants only; `grantFor` and the prompt section consume these. */
    readonly roots: readonly ResolvedRoot[];
    /** `read`: readable but not writable. */
    readonly readOnly: readonly ResolvedRule[];
    /** `deny`: neither readable nor writable. */
    readonly denied: readonly ResolvedRule[];
    readonly entries: readonly EntryResolution[];
    /** Every configured name rule, in configured order (deduplicated by name). */
    readonly nameRules: readonly ResolvedNameRule[];
    /**
     * Concrete paths the name rules match. EMPTY unless `expandNameRules` was
     * requested. A rule whose walk was only PARTIAL contributes the matches it did
     * find and adds a warning naming the roots it could not finish: dropping them
     * would remove protection from the very tree the user configured.
     */
    readonly nameMatches: readonly NameMatch[];
    readonly warnings: readonly string[];
}
/**
 * Drop every cached expansion (a fresh directory should not wait out the TTL).
 * Name-rule walks go too: tests use this as the one "forget the walk caches"
 * hook, and a stale name list is the same class of surprise as a stale pattern
 * list.
 */
export declare function clearPatternCache(): void;
/** Drop only the cached name-rule walks (the fs hot path never fills them). */
export declare function clearNameRuleCache(): void;
/**
 * Resolve every configured entry against one session workspace.
 * @param config - the normalised configuration.
 * @param workspaceRoot - the session workspace a relative entry resolves against.
 * @param facts - host facts (defaults to the discovered ones).
 * @param options - pass `{ expandNameRules: true }` to fill `nameMatches` with
 *   concrete paths (shell surface and preview); the default leaves the walk out.
 * @returns effective rules, per-entry detail and warnings.
 */
export declare function resolveRoots(config: ExtraPathsConfig, workspaceRoot: string, facts?: PlatformFacts, options?: ResolveOptions): ResolveReport;
/**
 * The walk scope of the name rules in one report: the session workspace plus
 * every configured writable root, nested roots collapsed.
 *
 * Exported because the fs wrapper resolves a report WITHOUT an expansion (its
 * per-call test is lexical) but must still use the SAME scope the shell
 * expansion and the preview used — two scope definitions would be a way for one
 * rule to apply on one surface but not the other.
 * @param report - a report from {@link resolveRoots}, expanded or not.
 * @param workspaceRoot - the session workspace the report was resolved against.
 * @param facts - host facts.
 * @returns scope roots in walk order (workspace first).
 */
export declare function nameScopeRoots(report: ResolveReport, workspaceRoot: string, facts: PlatformFacts): readonly string[];
