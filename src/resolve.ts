/**
 * The one place a configuration becomes a set of effective writable roots.
 * Enforcement (both wrappers) and the settings preview call this, so what the
 * page shows and what the sandbox grants cannot drift.
 * @module dsh-extra-paths/resolve
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ExtraPathsConfig, Scope, Surface } from './config.js'
import { SURFACES, isFilesystemRoot } from './config.js'
import { expandPattern, isPattern, parsePattern, PATTERN_LIMITS } from './pattern.js'
import { canonicalizeRoot, expandPath, isUnder } from './paths.js'

/** One effective root after canonicalisation and merging. */
export interface ResolvedRoot {
  /** The configured spelling that first produced this root (for messages). */
  readonly raw: string
  /** The canonical absolute root. */
  readonly root: string
  /** The widest scope across every entry that produced this root. */
  readonly scope: Scope
  /** The union of surfaces across every entry that produced this root. */
  readonly surfaces: readonly Surface[]
}

/** Per-entry outcome, in configured order (what the settings preview renders). */
export interface EntryResolution {
  readonly raw: string
  readonly resolved: string
  readonly scope: Scope
  readonly surfaces: readonly Surface[]
  readonly status: 'ok' | 'missing' | 'rejected'
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
  readonly roots: readonly ResolvedRoot[]
  readonly entries: readonly EntryResolution[]
  readonly warnings: readonly string[]
}

/**
 * How long one pattern's expansion is reused (milliseconds). Long enough that a
 * broad `**` walk costs one hiccup rather than one per five seconds; short enough
 * that a worktree created a moment ago shows up without any manual refresh.
 */
export const PATTERN_CACHE_MS = 30000

/** Expansions seen recently, keyed by the configured spelling. */
const patternCache = new Map<string, { at: number; matches: readonly string[]; capped: boolean; cap?: string; truncated?: boolean }>()

/** Drop every cached expansion (a fresh directory should not wait out the TTL). */
export function clearPatternCache(): void {
  patternCache.clear()
}

/**
 * Expand one pattern, reusing a recent expansion.
 * @param raw - the configured spelling.
 * @param workspaceRoot - the session workspace a relative anchor resolves against.
 * @param now - current time in milliseconds (injected for tests).
 * @returns the matches and whether a cap was hit.
 */
function expansionOf(raw: string, workspaceRoot: string, now: number): { matches: readonly string[]; capped: boolean; cap?: string; truncated?: boolean } {
  const cached = patternCache.get(raw)
  if (cached !== undefined && now - cached.at < PATTERN_CACHE_MS) {
    return {
      matches: cached.matches,
      capped: cached.capped,
      ...(cached.cap === undefined ? {} : { cap: cached.cap }),
      ...(cached.truncated === undefined ? {} : { truncated: cached.truncated }),
    }
  }
  const parsed = parsePattern(raw, workspaceRoot)
  const expansion = parsed === undefined
    ? { matches: [] as readonly string[], capped: true, cap: 'anchor' }
    : expandPattern(parsed)
  patternCache.set(raw, {
    at: now,
    matches: expansion.matches,
    capped: expansion.capped,
    ...(expansion.cap === undefined ? {} : { cap: expansion.cap }),
    ...('truncated' in expansion && expansion.truncated === true ? { truncated: true } : {}),
  })
  return {
    matches: expansion.matches,
    capped: expansion.capped,
    ...(expansion.cap === undefined ? {} : { cap: expansion.cap }),
    ...('truncated' in expansion && expansion.truncated === true ? { truncated: true } : {}),
  }
}

/**
 * Whether a root contains (or is) the home directory. Exact equality alone is
 * not enough: `~/..` canonicalises to the directory holding every user's home,
 * which is strictly broader than `~` yet would otherwise pass unwarned.
 * @param root - canonical root under test.
 * @param homeRoot - canonical home directory, resolved once per pass.
 * @returns true when home lies at or beneath the root.
 */
function containsHome(root: string, homeRoot: string): boolean {
  return isUnder(homeRoot, root)
}

/**
 * Resolve every configured entry against one session workspace.
 * @param config - the normalised configuration.
 * @param workspaceRoot - the session workspace a relative entry resolves against.
 * @returns effective roots plus per-entry detail and warnings.
 */
export function resolveRoots(config: ExtraPathsConfig, workspaceRoot: string): ResolveReport {
  const entries: EntryResolution[] = []
  const warnings: string[] = []
  const byRoot = new Map<string, ResolvedRoot>()
  // Probed at most once per pass — and not at all when no entry is active,
  // because this runs on every enforcement decision.
  let homeRoot: string | undefined
  const now = Date.now()

  const acceptEntry = (raw: string, scope: Scope, surfaces: readonly Surface[], root: string): void => {
    // A COPY of the caller's array: handing the config's own instance to a
    // report lets a caller mutate future grants through it.
    const shared = { raw, resolved: root, scope, surfaces: [...surfaces] }

    if (isFilesystemRoot(root)) {
      entries.push({ ...shared, status: 'rejected' })
      warnings.push(`extra-paths: ${JSON.stringify(raw)} resolves to the filesystem root; the entry is ignored`)
      return
    }
    if (!existsSync(root)) {
      entries.push({ ...shared, status: 'missing' })
      warnings.push(`extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which does not exist; the entry is inactive until it does`)
      return
    }

    entries.push({ ...shared, status: 'ok' })
    homeRoot ??= canonicalizeRoot(homedir())
    if (containsHome(root, homeRoot)) {
      warnings.push(
        `extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which contains your entire home directory; `
        + 'prefer a narrower root',
      )
    }
    if (root !== workspaceRoot && isUnder(workspaceRoot, root)) {
      warnings.push(
        `extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which contains this session's workspace; `
        + 'prefer a sibling-scoped root',
      )
    }
    const existing = byRoot.get(root)
    if (existing === undefined) {
      // SURFACES order here too, not only on merge: a lone entry spelled
      // ['shell', 'fs'] must yield the same root identity as ['fs', 'shell'].
      const ordered = SURFACES.filter(surface => surfaces.includes(surface))
      byRoot.set(root, { raw, root, scope, surfaces: ordered })
      return
    }
    const merged: Scope = existing.scope === 'always-write' || scope === 'always-write' ? 'always-write' : 'write'
    // SURFACES order, not insertion order: a config edit that only reorders
    // surfaces must not change a report's identity.
    const present = new Set([...existing.surfaces, ...surfaces])
    byRoot.set(root, { raw: existing.raw, root, scope: merged, surfaces: SURFACES.filter(surface => present.has(surface)) })
  }

  for (const entry of config.paths) {
    if (!isPattern(entry.path)) {
      acceptEntry(entry.path, entry.scope, entry.surfaces, canonicalizeRoot(expandPath(entry.path, workspaceRoot)))
      continue
    }

    const expansion = expansionOf(entry.path, workspaceRoot, now)
    if (expansion.capped) {
      entries.push({ raw: entry.path, resolved: '', scope: entry.scope, surfaces: [...entry.surfaces], status: 'rejected' })
      const reason = expansion.cap === 'anchor'
        ? 'its anchor is not walkable (needs a literal absolute or ~/ path at least two segments deep)'
        : expansion.cap === 'matches'
          ? `it matches more than ${PATTERN_LIMITS.maxMatches} directories`
          : `it examined more than ${PATTERN_LIMITS.maxDirs} directories`
      warnings.push(
        `extra-paths: pattern ${JSON.stringify(entry.path)} was not expanded because ${reason}; `
        + 'nothing is granted for it — narrow the pattern, name a deeper anchor, or spell the levels explicitly',
      )
      continue
    }
    if (expansion.truncated === true) {
      warnings.push(
        `extra-paths: pattern ${JSON.stringify(entry.path)} searched only ${PATTERN_LIMITS.maxDepth} levels below its anchor; `
        + 'spell the deeper levels explicitly if a matching directory lives further down',
      )
    }
    if (expansion.matches.length === 0) {
      entries.push({ raw: entry.path, resolved: '', scope: entry.scope, surfaces: [...entry.surfaces], status: 'missing' })
      warnings.push(
        `extra-paths: pattern ${JSON.stringify(entry.path)} matches no existing directory; the entry is inactive until one appears`,
      )
      continue
    }
    for (const match of expansion.matches) acceptEntry(entry.path, entry.scope, entry.surfaces, match)
  }

  return { roots: [...byRoot.values()], entries, warnings: [...new Set(warnings)] }
}
