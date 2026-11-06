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

import { existsSync } from 'node:fs'
import type { Access, ExtraPathsConfig, Scope, Surface } from './config.js'
import { SURFACES } from './config.js'
import { expandNameMatches, NAME_RULE_LIMITS, scopeRootsOf, type NameExpansion } from './name-rule.js'
import { expandPattern, isPattern, parsePatternOutcome, PATTERN_LIMITS } from './pattern.js'
import { foreignPathMessage, isBareNameSpelling } from './platform.js'
import {
  canonicalizeRoot,
  discoverPlatformFacts,
  expandConfiguredPath,
  isHostVolumeRootPath,
  isUnder,
  type PlatformFacts,
} from './paths.js'

/** One effective writable root after canonicalisation and merging. */
export interface ResolvedRoot {
  /** The configured spelling that first produced this root (for messages). */
  readonly raw: string
  /** The canonical absolute root. */
  readonly root: string
  /** The widest writable level across the surfaces that grant write. */
  readonly scope: Scope
  /** The surfaces this root is writable on. */
  readonly surfaces: readonly Surface[]
}

/** One effective restriction: the surfaces on which a root is read-only or denied. */
export interface ResolvedRule {
  /** The configured spelling that first produced this root (for messages). */
  readonly raw: string
  /** The canonical absolute root. */
  readonly root: string
  /** `read` keeps writes out; `deny` keeps reads AND writes out. */
  readonly access: 'read' | 'deny'
  /** The surfaces the restriction applies to. */
  readonly surfaces: readonly Surface[]
}

/** Per-entry outcome, in configured order (what the settings preview renders). */
export interface EntryResolution {
  readonly raw: string
  readonly resolved: string
  readonly access: Access
  readonly surfaces: readonly Surface[]
  readonly status: 'ok' | 'missing' | 'rejected' | 'foreign'
  /**
   * How many concrete paths a NAME RULE currently matches (the paths actually
   * enforced on the shell surface). Present only when the caller asked for
   * `expandNameRules`; a partially walked rule reports the matches it FOUND and
   * carries a warning about the roots it could not finish. A name rule with no
   * `matches` at all is still live for the fs surface: it needs no walk.
   */
  readonly matches?: number
}

/**
 * One configured BARE NAME (a "name rule"): a single-component spelling such as
 * `.git` or `.env`. It matches that component at any depth under the session
 * workspace plus every configured writable root, and covers the matched path's
 * whole subtree.
 */
export interface ResolvedNameRule {
  /** The configured spelling, kept for messages (no path form exists). */
  readonly raw: string
  /** The component name the matchers compare against (case-folded on Windows). */
  readonly name: string
  readonly access: Access
  readonly surfaces: readonly Surface[]
}

/** One concrete path a name rule currently matches (only produced by an expansion). */
export interface NameMatch {
  readonly rule: ResolvedNameRule
  /** The matched path; `rule` covers this path and its whole subtree. */
  readonly root: string
}

/** Optional knobs of one resolution pass. */
export interface ResolveOptions {
  /**
   * Enumerate concrete paths for name rules (`nameMatches`). Default false: the
   * fs wrapper resolves on EVERY read/write and matches names lexically, so it
   * must not pay for a directory walk; the shell surface (a sandbox profile can
   * only name concrete paths) and the settings preview pass true.
   */
  readonly expandNameRules?: boolean
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
  readonly roots: readonly ResolvedRoot[]
  /** `read`: readable but not writable. */
  readonly readOnly: readonly ResolvedRule[]
  /** `deny`: neither readable nor writable. */
  readonly denied: readonly ResolvedRule[]
  readonly entries: readonly EntryResolution[]
  /** Every configured name rule, in configured order (deduplicated by name). */
  readonly nameRules: readonly ResolvedNameRule[]
  /**
   * Concrete paths the name rules match. EMPTY unless `expandNameRules` was
   * requested. A rule whose walk was only PARTIAL contributes the matches it did
   * find and adds a warning naming the roots it could not finish: dropping them
   * would remove protection from the very tree the user configured.
   */
  readonly nameMatches: readonly NameMatch[]
  readonly warnings: readonly string[]
}

/**
 * How long one pattern's expansion is reused (milliseconds). Long enough that a
 * broad `**` walk costs one hiccup rather than one per five seconds; short enough
 * that a worktree created a moment ago shows up without any manual refresh.
 */
const PATTERN_CACHE_MS = 30000

/** One cached or fresh pattern expansion. */
interface Expansion {
  readonly matches: readonly string[]
  readonly capped: boolean
  readonly cap?: 'anchor' | 'directories' | 'matches'
  readonly truncated?: boolean
}

/** Expansions seen recently, keyed by the configured spelling AND its workspace base. */
const patternCache = new Map<string, { at: number } & Expansion>()

/**
 * The cache key of one expansion. The workspace base is part of it: a relative
 * anchor is refused by the parser today, but keying on the raw spelling alone
 * would let a future grammar change (or a hand-built pattern) reuse one
 * session's expansion in another workspace — and a reused expansion now
 * mis-applies DENY/READ rules, which is security-relevant, not cosmetic.
 */
function expansionKey(raw: string, workspaceRoot: string): string {
  return `${workspaceRoot}\u0000${raw}`
}

/**
 * Drop every cached expansion (a fresh directory should not wait out the TTL).
 * Name-rule walks go too: tests use this as the one "forget the walk caches"
 * hook, and a stale name list is the same class of surprise as a stale pattern
 * list.
 */
export function clearPatternCache(): void {
  patternCache.clear()
  nameRuleCache.clear()
}

/** Drop only the cached name-rule walks (the fs hot path never fills them). */
export function clearNameRuleCache(): void {
  nameRuleCache.clear()
}

/** Turn a cache row into a snapshot, so a caller cannot mutate the cache. */
function snapshot(row: Expansion): Expansion {
  return {
    matches: row.matches,
    capped: row.capped,
    ...(row.cap === undefined ? {} : { cap: row.cap }),
    ...(row.truncated === undefined ? {} : { truncated: row.truncated }),
  }
}

/**
 * Expand one pattern, reusing a recent expansion.
 * @param raw - the configured spelling.
 * @param workspaceRoot - the session workspace a relative anchor resolves against.
 * @param facts - host facts the anchor is translated with.
 * @param now - current time in milliseconds (injected for tests).
 * @returns the expansion, or the reason the anchor is foreign to this host.
 */
function expansionOf(
  raw: string,
  workspaceRoot: string,
  facts: PlatformFacts,
  now: number,
): { readonly expansion: Expansion; readonly foreign?: string } {
  const key = expansionKey(raw, workspaceRoot)
  const cached = patternCache.get(key)
  if (cached !== undefined && now - cached.at < PATTERN_CACHE_MS) {
    return { expansion: snapshot(cached) }
  }
  const outcome = parsePatternOutcome(raw, workspaceRoot, facts)
  // A foreign anchor is NOT cached: it is a platform fact rather than a walk, and
  // the caller answers it with a warning instead of an expansion.
  if (!outcome.ok && outcome.foreign !== undefined) {
    return { foreign: outcome.foreign, expansion: { matches: [], capped: true, cap: 'anchor' } }
  }
  const expansion: Expansion = outcome.ok
    ? expandPattern(outcome.pattern)
    : { matches: [], capped: true, cap: 'anchor' }
  patternCache.set(key, { at: now, ...snapshot(expansion) })
  return { expansion: snapshot(expansion) }
}

/** One cached or fresh name-rule walk. */
interface CachedNameExpansion extends NameExpansion {
  readonly at: number
}

/**
 * Name-rule walks seen recently. The shell surface resolves once per
 * confinement, and walking the session workspace on every command would be a
 * self-inflicted stall; a directory created a moment ago still appears after the
 * TTL (or after a config save clears the caches).
 */
const nameRuleCache = new Map<string, CachedNameExpansion>()

/**
 * The cache key of one name walk. The scope roots ARE the walk, so a rule
 * resolved for one workspace must never be reused for another (the same
 * security reasoning as {@link expansionKey}). The host facts ride along because
 * case folding and the path API are host properties.
 */
function nameRuleKey(name: string, scopeRoots: readonly string[], facts: PlatformFacts): string {
  return JSON.stringify([name, scopeRoots, facts.platform, facts.wsl, facts.wslMountRoot, facts.home])
}

/** Turn a cache row into a snapshot, so a caller cannot mutate the cache. */
function nameExpansionSnapshot(row: NameExpansion): NameExpansion {
  return {
    matches: [...row.matches],
    capped: row.capped,
    ...(row.cap === undefined ? {} : { cap: row.cap }),
    truncated: row.truncated,
    incompleteRoots: [...row.incompleteRoots],
    skippedSymlinks: row.skippedSymlinks,
    scanned: row.scanned,
    complete: row.complete,
  }
}

/**
 * One name rule's bounded walk, reusing a recent one.
 * @param name - the component to match.
 * @param scopeRoots - {@link scopeRootsOf} output for this pass.
 * @param facts - host facts.
 * @param now - current time in milliseconds (injected for tests).
 * @returns the expansion (cached or fresh), including the completeness verdict.
 */
function nameExpansionOf(
  name: string,
  scopeRoots: readonly string[],
  facts: PlatformFacts,
  now: number,
): NameExpansion {
  const key = nameRuleKey(name, scopeRoots, facts)
  const cached = nameRuleCache.get(key)
  if (cached !== undefined && now - cached.at < NAME_RULE_LIMITS.cacheMs) {
    return nameExpansionSnapshot(cached)
  }
  const expansion = expandNameMatches(name, scopeRoots, facts)
  const snapshot = nameExpansionSnapshot(expansion)
  nameRuleCache.set(key, { at: now, ...snapshot })
  return snapshot
}

/**
 * Why one name rule could not be enumerated exhaustively, in user terms. A cap
 * and a truncation are different problems (a cap says "narrow the scope", a
 * truncation says "spell the deep paths explicitly"), so they are named instead
 * of being collapsed into a generic failure.
 * @param expansion - the incomplete walk's verdict.
 * @returns the reasons, joined for one warning line.
 */
function incompleteNameRuleReason(expansion: NameExpansion): string {
  const reasons: string[] = []
  if (expansion.cap === 'matches') {
    reasons.push(`it currently matches more than ${NAME_RULE_LIMITS.maxMatches} paths`)
  } else if (expansion.cap === 'directories') {
    reasons.push(`it examined more than ${NAME_RULE_LIMITS.maxDirs} directories`)
  }
  if (expansion.truncated) {
    reasons.push(`the walk stopped at the ${NAME_RULE_LIMITS.maxDepth}-level depth limit or at an unreadable entry`)
  }
  if (expansion.skippedSymlinks > 0) {
    reasons.push(`${expansion.skippedSymlinks} matching path(s) are symbolic links, which a shell profile cannot mask`)
  }
  return reasons.length > 0 ? reasons.join('; ') : 'the enumeration was incomplete'
}

/**
 * The one warning an incomplete name rule produces.
 *
 * The matches that WERE found stay enforced (denying more concrete paths is
 * always safe); the warning is about the paths the walk could not reach, which
 * the shell surface may therefore miss. The fs surface is unaffected: it matches
 * the rule lexically on every call.
 * @param raw - the configured spelling.
 * @param expansion - the incomplete walk's verdict.
 * @returns one user-facing warning line.
 */
function incompleteNameRuleWarning(raw: string, expansion: NameExpansion): string {
  const roots = expansion.incompleteRoots
  const shown = roots.length > 2 ? `${roots.slice(0, 2).join(', ')} and ${roots.length - 2} more` : roots.join(', ')
  return `extra-paths: name rule ${JSON.stringify(raw)} match count is partial because `
    + `${incompleteNameRuleReason(expansion)}; the ${expansion.matches.length} match(es) found still apply to the fs tools, `
    + `but paths under ${shown || 'an unscannable root'} were not scanned — the preview's match count is partial, `
    + 'while fs enforcement keeps matching the name live on every call'
}

/**
 * Whether a root contains (or is) the home directory. Exact equality alone is
 * not enough: `~/..` canonicalises to the directory holding every user's home,
 * which is strictly broader than `~` yet would otherwise pass unwarned.
 * @param root - canonical root under test.
 * @param homeRoot - canonical home directory, resolved once per pass.
 * @param facts - host facts.
 * @returns true when home lies at or beneath the root.
 */
function containsHome(root: string, homeRoot: string, facts: PlatformFacts): boolean {
  return isUnder(homeRoot, root, facts)
}

/**
 * The per-root accumulator. One canonical root can carry different levels on
 * different surfaces, so writability, read-only and deny are tracked per surface
 * and reconciled at the end.
 */
interface RootAggregate {
  readonly raw: string
  readonly root: string
  /** Widest writable level seen per surface (deny/read are weighed later). */
  readonly writable: Map<Surface, Scope>
  readonly read: Set<Surface>
  readonly deny: Set<Surface>
}

/**
 * Fold one active entry into its canonical root's accumulator.
 * @param aggregates - per-root accumulators (insertion order is report order).
 * @param raw - the configured spelling.
 * @param access - the entry's access level.
 * @param surfaces - the surfaces the entry applies to.
 * @param root - the canonical root the entry resolved to.
 */
function mergeEntry(
  aggregates: Map<string, RootAggregate>,
  raw: string,
  access: Access,
  surfaces: readonly Surface[],
  root: string,
): void {
  let aggregate = aggregates.get(root)
  if (aggregate === undefined) {
    aggregate = { raw, root, writable: new Map(), read: new Set(), deny: new Set() }
    aggregates.set(root, aggregate)
  }
  for (const surface of surfaces) {
    switch (access) {
      case 'deny':
        aggregate.deny.add(surface)
        break
      case 'read':
        aggregate.read.add(surface)
        break
      case 'write':
      case 'always-write': {
        const widest: Scope = aggregate.writable.get(surface) === 'always-write' || access === 'always-write'
          ? 'always-write'
          : 'write'
        aggregate.writable.set(surface, widest)
        break
      }
    }
  }
}

/**
 * Resolve every configured entry against one session workspace.
 * @param config - the normalised configuration.
 * @param workspaceRoot - the session workspace a relative entry resolves against.
 * @param facts - host facts (defaults to the discovered ones).
 * @param options - pass `{ expandNameRules: true }` to fill `nameMatches` with
 *   concrete paths (shell surface and preview); the default leaves the walk out.
 * @returns effective rules, per-entry detail and warnings.
 */
export function resolveRoots(
  config: ExtraPathsConfig,
  workspaceRoot: string,
  facts: PlatformFacts = discoverPlatformFacts(),
  options?: ResolveOptions,
): ResolveReport {
  const entries: EntryResolution[] = []
  const warnings: string[] = []
  const aggregates = new Map<string, RootAggregate>()
  const nameRules: ResolvedNameRule[] = []
  const nameRuleByName = new Map<string, ResolvedNameRule>()
  /** Entry indexes of the bare-name rows, so an expansion can fill `matches`. */
  const bareEntries: { readonly index: number; readonly name: string }[] = []
  // Probed at most once per pass — and not at all when no entry is active,
  // because this runs on every enforcement decision.
  let homeRoot: string | undefined
  const now = Date.now()

  const acceptEntry = (raw: string, access: Access, surfaces: readonly Surface[], root: string): void => {
    // A COPY of the caller's array: handing the config's own instance to a
    // report lets a caller mutate future grants through it.
    const shared = { raw, resolved: root, access, surfaces: [...surfaces] }

    if (isHostVolumeRootPath(root, facts)) {
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
    homeRoot ??= canonicalizeRoot(facts.home, facts)
    if (containsHome(root, homeRoot, facts)) {
      warnings.push(
        `extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which contains your entire home directory; `
        + 'prefer a narrower root',
      )
    }
    if (root !== workspaceRoot && isUnder(workspaceRoot, root, facts)) {
      warnings.push(
        `extra-paths: ${JSON.stringify(raw)} resolves to ${root}, which contains this session's workspace; `
        + 'prefer a sibling-scoped root',
      )
    }
    mergeEntry(aggregates, raw, access, surfaces, root)
  }

  /** Report one entry that is inactive without contributing a rule. */
  const inactive = (raw: string, access: Access, surfaces: readonly Surface[], status: 'missing' | 'rejected' | 'foreign'): void => {
    entries.push({ raw, resolved: '', access, surfaces: [...surfaces], status })
  }

  for (const entry of config.paths) {
    if (isBareNameSpelling(entry.path)) {
      // A name rule is never "missing": the fs surface applies it lexically on
      // every call, so it is live even when the current walk finds nothing (the
      // directory may be created a moment later) and even when the report was
      // resolved without a walk.
      if (!nameRuleByName.has(entry.path)) {
        // One rule per name. The settings gate already refuses duplicate bare
        // names; a config that bypassed it (a synthesized/older document) still
        // gets one walk per name, and the first entry's level wins.
        const rule: ResolvedNameRule = {
          raw: entry.path,
          name: entry.path,
          access: entry.access,
          surfaces: [...entry.surfaces],
        }
        nameRuleByName.set(entry.path, rule)
        nameRules.push(rule)
      }
      entries.push({
        raw: entry.path,
        resolved: '',
        access: entry.access,
        surfaces: [...entry.surfaces],
        status: 'ok',
      })
      bareEntries.push({ index: entries.length - 1, name: entry.path })
      continue
    }

    if (!isPattern(entry.path)) {
      const expanded = expandConfiguredPath(entry.path, workspaceRoot, facts)
      if (!expanded.ok) {
        // A spelling of the other platform: the entry stays inactive with ONE
        // informative warning instead of failing the configuration, so the same
        // document can be used on every host.
        inactive(entry.path, entry.access, entry.surfaces, 'foreign')
        warnings.push(foreignPathMessage(entry.path, expanded.foreign))
        continue
      }
      acceptEntry(entry.path, entry.access, entry.surfaces, canonicalizeRoot(expanded.path, facts))
      continue
    }

    const { expansion, foreign } = expansionOf(entry.path, workspaceRoot, facts, now)
    if (foreign !== undefined) {
      inactive(entry.path, entry.access, entry.surfaces, 'foreign')
      warnings.push(foreignPathMessage(entry.path, foreign))
      continue
    }
    if (expansion.capped) {
      inactive(entry.path, entry.access, entry.surfaces, 'rejected')
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
      inactive(entry.path, entry.access, entry.surfaces, 'missing')
      warnings.push(
        `extra-paths: pattern ${JSON.stringify(entry.path)} matches no existing directory; the entry is inactive until one appears`,
      )
      continue
    }
    for (const match of expansion.matches) acceptEntry(entry.path, entry.access, entry.surfaces, match)
  }

  const roots: ResolvedRoot[] = []
  const readOnly: ResolvedRule[] = []
  const denied: ResolvedRule[] = []
  for (const aggregate of aggregates.values()) {
    // SURFACES order, not insertion order: a config edit that only reorders
    // surfaces must not change a report's identity. Precedence per surface:
    // deny > read > write, and deny/read only ever subtract from the writable set.
    const writableSurfaces = SURFACES.filter(surface => aggregate.writable.has(surface)
      && !aggregate.read.has(surface)
      && !aggregate.deny.has(surface))
    if (writableSurfaces.length > 0) {
      const scope: Scope = writableSurfaces.some(surface => aggregate.writable.get(surface) === 'always-write')
        ? 'always-write'
        : 'write'
      roots.push({ raw: aggregate.raw, root: aggregate.root, scope, surfaces: writableSurfaces })
    }
    const readSurfaces = SURFACES.filter(surface => aggregate.read.has(surface) && !aggregate.deny.has(surface))
    if (readSurfaces.length > 0) {
      readOnly.push({ raw: aggregate.raw, root: aggregate.root, access: 'read', surfaces: readSurfaces })
    }
    const denySurfaces = SURFACES.filter(surface => aggregate.deny.has(surface))
    if (denySurfaces.length > 0) {
      denied.push({ raw: aggregate.raw, root: aggregate.root, access: 'deny', surfaces: denySurfaces })
    }
  }

  // Name rules are enumerated LAST, because their scope is the session
  // workspace plus the writable roots this pass just resolved — a name rule
  // must see the same roots the shell would. The walk is opt-in: the fs hot
  // path resolves without it and matches lexically instead.
  const nameMatches: NameMatch[] = []
  if (options?.expandNameRules === true && nameRules.length > 0) {
    const scopeRoots = scopeRootsOf(workspaceRoot, roots.map(root => root.root), facts)
    const expansions = new Map<string, NameExpansion>()
    for (const rule of nameRules) {
      const expansion = nameExpansionOf(rule.name, scopeRoots, facts, now)
      expansions.set(rule.name, expansion)
      if (!expansion.complete) {
        // PARTIAL coverage: matches that were found stay enforced (denying more
        // concrete paths is always safe) and the warning names the roots the walk
        // could not finish. Dropping every match here was the earlier bug: one
        // deep writable runtime tree (~/.dsh) made a `.git` rule protect the fs
        // tools but not the shell in the actual workspace.
        warnings.push(incompleteNameRuleWarning(rule.raw, expansion))
      }
      for (const root of expansion.matches) nameMatches.push({ rule, root })
    }
    for (const bare of bareEntries) {
      const entry = entries[bare.index]
      const expansion = expansions.get(bare.name)
      if (entry === undefined || expansion === undefined) continue
      // `matches` mirrors the concrete paths the surface ACTUALLY acts on: the
      // found ones are enforced even when the walk was partial (the warning
      // covers the difference), so the count is the enforced count.
      entries[bare.index] = { ...entry, matches: expansion.matches.length }
    }
  }

  return { roots, readOnly, denied, entries, nameRules, nameMatches, warnings: [...new Set(warnings)] }
}

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
export function nameScopeRoots(
  report: ResolveReport,
  workspaceRoot: string,
  facts: PlatformFacts,
): readonly string[] {
  return scopeRootsOf(workspaceRoot, report.roots.map(root => root.root), facts)
}
