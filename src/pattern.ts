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
 * Safety envelope, enforced here and validated again at save time:
 * - the literal prefix before the first wildcard is the anchor; it must be
 *   absolute after `~` expansion, must not be a filesystem root, and must not
 *   CONTAIN the home directory — a pattern can never walk `/`, `/Users` or `~`;
 * - the walk never descends into `node_modules` or `.git`;
 * - every cap (depth, directories scanned, matches) makes the WHOLE pattern yield
 *   nothing (fail closed) instead of a partial set: a half-expanded grant would
 *   be an unpredictable permission.
 * @module dsh-extra-paths/pattern
 */

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { isFilesystemRoot } from './config.js'
import { canonicalizeRoot, expandPath, isUnder } from './paths.js'

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
} as const

/** Names the walk never descends into. */
const PRUNED = new Set(['node_modules', '.git'])

/** A parsed pattern. */
export interface RootPattern {
  /** The configured spelling this came from (for messages and the preview). */
  readonly source: string
  /** The literal directory the walk starts from (absolute). */
  readonly anchor: string
  /** Segments after the anchor, each `*`, `**`, or a literal name. */
  readonly segments: readonly string[]
  /** Trailing `..` segments applied to each match. */
  readonly up: number
}

/** One expansion. */
export interface PatternExpansion {
  /** Matching directories, canonicalised and sorted; empty when capped. */
  readonly matches: readonly string[]
  /** True when a cap was hit: `matches` is empty and the caller must warn. */
  readonly capped: boolean
  /** Which runaway cap stopped the walk (nothing is granted when set). */
  readonly cap?: 'directories' | 'matches'
  /**
   * The depth bound cut the walk short. NOT a failure: `**` is defined as "up to
   * {@link PATTERN_LIMITS.maxDepth} levels below the anchor", so the matches
   * found within it stand and the caller only mentions it.
   */
  readonly truncated?: boolean
  /** Directories examined, for diagnostics. */
  readonly scanned: number
}

/** Whether a spelling is a pattern rather than a literal path. */
export function isPattern(raw: string): boolean {
  return raw.includes('*')
}

/**
 * Parse a pattern spelling.
 * @param raw - the configured spelling.
 * @param workspaceRoot - the base a relative anchor resolves against.
 * @param home - the home directory to expand `~` with.
 * @returns the parsed pattern, or undefined when it cannot be walked safely.
 */
export function parsePattern(raw: string, workspaceRoot: string, home: string = homedir()): RootPattern | undefined {
  const segments = raw.split('/').filter(segment => segment !== '')
  const firstWildcard = segments.findIndex(segment => segment.includes('*'))
  if (firstWildcard < 0) return undefined

  // Trailing `..` run: applied AFTER matching, so it must not be part of the walk.
  let end = segments.length
  let up = 0
  while (end > firstWildcard && segments[end - 1] === '..') {
    up += 1
    end -= 1
  }
  const walk = segments.slice(firstWildcard, end)
  if (walk.length === 0) return undefined

  // The anchor spelling keeps its leading `/` or `~`. Rebuilding it from the
  // filtered segments would turn `/a/b/**` into the RELATIVE `a/b` and resolve
  // the walk against the session workspace instead of `/a/b` — the defect this
  // guard was extracted from.
  const anchorSpelling = raw.slice(0, raw.indexOf('*')).replace(/\/+$/, '')
  if (!anchorSpelling.startsWith('/') && !anchorSpelling.startsWith('~')) return undefined
  // `/**`, `~/**` and `/srv/**` would walk the filesystem, a whole home
  // directory, or a top-level directory: a pattern needs two literal segments.
  if (firstWildcard < 2) return undefined

  const anchor = canonicalizeRoot(expandPath(anchorSpelling, workspaceRoot, home))
  if (!isAbsolute(anchor) || isFilesystemRoot(anchor)) return undefined
  const homeRoot = canonicalizeRoot(home)
  // An anchor that IS or CONTAINS the home directory would walk far too much.
  if (anchor === homeRoot || isUnder(homeRoot, anchor)) return undefined

  return { source: raw, anchor, segments: walk, up }
}

/**
 * What one directory contributes: its child directories, or nothing when
 * unreadable.
 * @param directory - the directory to list.
 * @param visibleOnly - skip HIDDEN child directories. `**` uses this: a search
 * for a repository's `.worktrees` has no business inside `.cache`, `.gradle` or
 * a checked-out tool tree, and skipping them is what keeps the walk bounded.
 * The pattern's own literal segments are matched at their level regardless, so
 * `.worktrees` itself is still found.
 */
function childDirectories(directory: string, visibleOnly = false): string[] {
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  const children: string[] = []
  for (const name of names) {
    if (PRUNED.has(name)) continue
    if (visibleOnly && name.startsWith('.')) continue
    const child = join(directory, name)
    try {
      if (statSync(child).isDirectory()) children.push(child)
    } catch {
      // A vanishing entry is not an error: the next pass simply will not see it.
    }
  }
  return children.sort()
}

/**
 * Expand a pattern against the filesystem.
 * @param pattern - the parsed pattern.
 * @param limits - caps to apply (defaults to {@link PATTERN_LIMITS}).
 * @returns the matches, or `{ capped: true }` when a cap was hit.
 */
export function expandPattern(
  pattern: RootPattern,
  limits: { maxDirs: number; maxMatches: number; maxDepth: number } = PATTERN_LIMITS,
): PatternExpansion {
  const matches = new Set<string>()
  let scanned = 0
  let capped = false

  let cap: PatternExpansion['cap']
  let truncated = false
  const stop = (which: NonNullable<PatternExpansion['cap']>): void => {
    capped = true
    cap ??= which
  }

  const walk = (directory: string, index: number, depth: number): void => {
    if (capped) return
    if (scanned >= limits.maxDirs) {
      stop('directories')
      return
    }
    scanned += 1

    if (index === pattern.segments.length) {
      if (matches.size >= limits.maxMatches) {
        stop('matches')
        return
      }
      matches.add(directory)
      return
    }

    const segment = pattern.segments[index] ?? ''
    if (segment === '**') {
      // Zero segments consumed — always allowed, so `**` matches the anchor's own
      // level even at the depth bound (checking the bound first would lose a
      // level to an off-by-one).
      walk(directory, index + 1, depth)
      if (capped) return
      if (depth >= limits.maxDepth) {
        // A documented bound, not a failure: keep whatever the walk already
        // found and let the caller mention that deeper levels were not searched.
        truncated = true
        return
      }
      // …or one more level, keeping `**` active. Hidden directories are skipped
      // here only: this is the branch that would otherwise wander into every
      // source tree below the anchor.
      for (const child of childDirectories(directory, true)) {
        walk(child, index, depth + 1)
        if (capped) return
      }
      return
    }

    for (const child of childDirectories(directory)) {
      const name = child.slice(child.lastIndexOf('/') + 1)
      if (segment === '*' || segment === name) walk(child, index + 1, depth)
      if (capped) return
    }
  }

  walk(pattern.anchor, 0, 0)
  if (capped) return { matches: [], capped: true, ...(cap === undefined ? {} : { cap }), scanned }

  const up = pattern.up
  const resolved = [...matches]
    .map(match => {
      let result = match
      for (let step = 0; step < up; step += 1) result = dirname(result)
      return canonicalizeRoot(result)
    })
    .filter(candidate => !isFilesystemRoot(candidate))
  return { matches: [...new Set(resolved)].sort(), capped: false, ...(truncated ? { truncated: true } : {}), scanned }
}
