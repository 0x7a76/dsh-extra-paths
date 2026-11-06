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
import { type PlatformFacts } from './platform.js';
/** Caps that keep one pattern's expansion bounded. */
export declare const PATTERN_LIMITS: {
    /** Directory entries examined in one expansion. */
    readonly maxDirs: 4096;
    /** Matches one pattern may yield. */
    readonly maxMatches: 256;
    /**
     * `**` levels walked below the anchor. Deliberately small: a repository that
     * keeps its worktrees in `.worktrees` sits one or two levels down, and every
     * extra level multiplies the walk into unrelated source trees. A deeper
     * structure is spelled explicitly, level by level, instead of with `**`.
     */
    readonly maxDepth: 3;
};
/** A parsed pattern. */
export interface RootPattern {
    /** The configured spelling this came from (for messages and the preview). */
    readonly source: string;
    /** The literal directory the walk starts from (absolute, host-native). */
    readonly anchor: string;
    /** Segments after the anchor, each `*`, `**`, or a literal name. */
    readonly segments: readonly string[];
    /** Trailing `..` segments applied to each match. */
    readonly up: number;
    /**
     * The host facts the anchor was translated with. The walk must use the SAME
     * dialect as the parser: re-deriving it from `process.platform` would make a
     * pattern parsed for one host walk with another host's `node:path`.
     */
    readonly platform: PlatformFacts;
}
/** One expansion. */
export interface PatternExpansion {
    /** Matching directories, canonicalised and sorted; empty when capped. */
    readonly matches: readonly string[];
    /** True when a cap was hit: `matches` is empty and the caller must warn. */
    readonly capped: boolean;
    /** Which runaway cap stopped the walk (nothing is granted when set). */
    readonly cap?: 'directories' | 'matches';
    /**
     * The depth bound cut the walk short. NOT a failure: `**` is defined as "up to
     * {@link PATTERN_LIMITS.maxDepth} levels below the anchor", so the matches
     * found within it stand and the caller only mentions it.
     */
    readonly truncated?: boolean;
    /** Directories examined, for diagnostics. */
    readonly scanned: number;
}
/** Why a pattern spelling could not be turned into a walkable pattern. */
export type PatternParseOutcome = {
    readonly ok: true;
    readonly pattern: RootPattern;
}
/**
 * Not walkable here. `foreign` is set when the ANCHOR is a spelling of the
 * other platform: the entry must stay inactive with one informative warning
 * (a shared configuration has to remain usable on every host), while every
 * other rejection is a configuration mistake.
 */
 | {
    readonly ok: false;
    readonly foreign?: string;
};
/** Whether a spelling is a pattern rather than a literal path. */
export declare function isPattern(raw: string): boolean;
/**
 * Parse a pattern spelling and keep the reason when it cannot be walked.
 * @param raw - the configured spelling (POSIX or Windows).
 * @param workspaceRoot - the base a relative anchor resolves against.
 * @param facts - host facts (defaults to the discovered ones); the anchor is
 *   translated into the host's dialect with these.
 * @returns the pattern, or a rejection that says whether it is merely foreign.
 */
export declare function parsePatternOutcome(raw: string, workspaceRoot: string, facts?: PlatformFacts): PatternParseOutcome;
/**
 * Parse a pattern spelling.
 * @param raw - the configured spelling.
 * @param workspaceRoot - the base a relative anchor resolves against.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the parsed pattern, or undefined when it cannot be walked safely.
 */
export declare function parsePattern(raw: string, workspaceRoot: string, facts?: PlatformFacts): RootPattern | undefined;
/**
 * Expand a pattern against the filesystem.
 * @param pattern - the parsed pattern.
 * @param limits - caps to apply (defaults to {@link PATTERN_LIMITS}).
 * @returns the matches, or `{ capped: true }` when a cap was hit.
 */
export declare function expandPattern(pattern: RootPattern, limits?: {
    maxDirs: number;
    maxMatches: number;
    maxDepth: number;
}): PatternExpansion;
