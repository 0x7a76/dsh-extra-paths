/**
 * The filesystem half of the plugin: a transparent Proxy over `ctx.fs` that
 *
 * 1. RE-FENCES every mutation whose target lies under a configured writable root
 *    (re-stamps ONE call's policy), and
 * 2. ENFORCES the hard rules — a `deny` rule refuses content reads, listings,
 *    watching AND writes; a `read` rule refuses writes (a downgrade) even when the
 *    target is inside the writable workspace. Hard rules are user-written, so
 *    they hold under `danger-full-access` too.
 *
 * BARE NAMES (`.git`, `.env`, `node_modules`) are NAME RULES: they apply to that
 * component at any depth under the session workspace plus every configured
 * writable root. The fs surface matches them LEXICALLY on every call
 * ({@link matchNameRule} over the target's components), never by walking the
 * filesystem: a write may run once per tool call, so the enforcement layer must
 * not pay for a directory tree and must also catch a directory created a moment
 * ago. The shell surface is the only caller of the expensive bounded walk
 * (`resolve.ts` with `expandNameRules`), because a sandbox profile can only name
 * concrete paths.
 *
 * The host generation decides how many mutations this surface has. 0.2.0/0.2.1
 * fence `writeText`/`editText`; 0.2.2 additionally fences `patchText`,
 * `deleteFile` and `moveFile` (the `apply_patch` tool and the delete/move
 * operations). The wrapper therefore overrides every mutation the INNER service
 * actually exposes, and never invents one: on a 0.2.1 service the three newer
 * methods stay absent, exactly as the base class declared them.
 *
 * Reads are guarded on the six content/listing/watch entry points
 * (`readText`, `streamText`, `readBytes`, `readByteRange`, `listDir`, `watch`).
 * The documented metadata boundary is deliberate: `stat`, `lstat`, `resolve`,
 * `contains`, `processPath` and `fileUrl` expose existence/size/identity without
 * reading content, and the host itself relies on them to probe paths — denying
 * them would break the tool layer without protecting any content.
 *
 * Transparency rules (verified against cordis 4.0.2 by
 * spike/cordis-get-wrap-baseline.mjs): forward every property with the inner
 * value as the receiver, bind methods to the inner instance — except
 * `constructor`, whose binding breaks the framework's own `instanceof`
 * (`Service[Symbol.hasInstance]` walks `instance.constructor`).
 * @module dsh-extra-paths/wrap-fs
 */

import { realpathSync, statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { ExtraPathsConfig, Surface } from './config.js'
import { matchDenied, matchReadOnly, readDenied, writeDenied, writeReadOnly } from './denial.js'
import { grantFor } from './grant.js'
import { findNameComponent } from './name-rule.js'
import { discoverPlatformFacts, isUnder, type PlatformFacts } from './paths.js'
import { syntheticPolicy, type PolicyLike } from './policy.js'
import {
  nameScopeRoots,
  resolveRoots,
  type ResolvedNameRule,
  type ResolvedRule,
  type ResolveReport,
} from './resolve.js'

/** A resolved filesystem target (the fs service's own shape). */
export interface FsTargetLike {
  readonly targetKey: unknown
  readonly displayPath: string
}

/** The read methods whose CONTENT/listing the deny rules must intercept. */
export type FsReadMethod = 'readText' | 'streamText' | 'readBytes' | 'readByteRange' | 'listDir' | 'watch'

/** The list of read methods, so one loop covers all six identically. */
const READ_METHODS: readonly FsReadMethod[] = ['readText', 'streamText', 'readBytes', 'readByteRange', 'listDir', 'watch']

/**
 * The subset of the filesystem service this wrapper intercepts.
 *
 * The read methods are optional: a stub or an older host that does not declare
 * one keeps that exact surface (the wrapper only overrides what exists).
 */
export interface FsInnerLike {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetLike>
  /** DSH 0.2.x: whole-text read. */
  readText?(target: FsTargetLike, signal?: AbortSignal): Promise<unknown>
  /** DSH 0.2.x: chunked text read. */
  streamText?(target: FsTargetLike, signal?: AbortSignal): Promise<unknown>
  /** DSH 0.2.x: raw byte read. */
  readBytes?(target: FsTargetLike, signal: AbortSignal | undefined, maxBytes: number): Promise<unknown>
  /** DSH 0.2.x: one byte window. */
  readByteRange?(target: FsTargetLike, range: { offset: number; length: number }, signal?: AbortSignal): Promise<unknown>
  /** DSH 0.2.x: directory listing. */
  listDir?(target: FsTargetLike, signal?: AbortSignal): Promise<unknown>
  /** DSH 0.2.x: change observation. */
  watch?(target: FsTargetLike, changed: (error?: Error) => void, signal: AbortSignal): Promise<unknown>
  writeText(target: FsTargetLike, content: string, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  editText(target: FsTargetLike, edit: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  /** DSH 0.2.2+: apply parsed hunks (the `apply_patch` tool's surface). */
  patchText?(target: FsTargetLike, hunks: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  /** DSH 0.2.2+: remove one regular file. */
  deleteFile?(target: FsTargetLike, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  /** DSH 0.2.2+: publish a destination and remove the source. */
  moveFile?(source: FsTargetLike, destination: FsTargetLike, options?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>
  readonly sandboxMode?: string
}

/** What the wrapper needs from the plugin. */
export interface FsWrapDeps {
  /** Live configuration: re-read on EVERY call, never captured at wrap time. */
  readConfig(): ExtraPathsConfig
  /** Deployment policy for a caller that stamped none; resolved per call. */
  fallbackPolicy(): PolicyLike | undefined
}

/**
 * One name rule that covers a target, plus the component path it matched (the
 * rule's effective root, which is what a message and a synthetic policy name).
 */
export interface NameRuleMatch {
  /** The configured name rule that matched. */
  readonly rule: ResolvedNameRule
  /** The canonical matched component path; the rule covers this path and its subtree. */
  readonly root: string
}

/**
 * The first name rule in `rules` that covers `targetKey` on `surface`.
 *
 * This is the ONE lexical name-rule test both enforcement surfaces share (the
 * fs wrapper per call and the tool-layer guard per tool execution): a second
 * implementation could let one surface's scope drift from the other. Callers pass
 * the rule list prefiltered by access level (deny, read, or the grant set), so
 * one rule list maps to one decision.
 * @param rules - name rules to test, already filtered by access and intent.
 * @param surface - the enforcement surface asking.
 * @param targetKey - the fresh canonical target path (may name a missing suffix).
 * @param scopeRoots - {@link nameScopeRoots} output for the same report.
 * @param facts - host facts.
 * @returns the matched rule and component path, or undefined (no opinion).
 */
export function matchNameRule(
  rules: readonly ResolvedNameRule[],
  surface: Surface,
  targetKey: string,
  scopeRoots: readonly string[],
  facts: PlatformFacts,
): NameRuleMatch | undefined {
  for (const rule of rules) {
    if (!rule.surfaces.includes(surface)) continue
    const root = findNameComponent(targetKey, rule.name, scopeRoots, facts)
    if (root !== undefined) return { rule, root }
  }
  return undefined
}

/**
 * A rule-shaped view of a name-rule hit, so `denial.ts`'s message helpers apply
 * to name rules unchanged. Callers pass only deny/read rule lists (a grant is
 * never a refusal, and `write` maps to the `read` message level).
 * @param hit - the matched name rule and component path.
 * @returns the `ResolvedRule`-like value the message builders take.
 */
export function nameRuleHitAsResolvedRule(hit: NameRuleMatch): ResolvedRule {
  return {
    raw: hit.rule.raw,
    root: hit.root,
    access: hit.rule.access === 'deny' ? 'deny' : 'read',
    surfaces: [...hit.rule.surfaces],
  }
}

/** The fs-surface hard rules (literal plus name rules) one resolved report contributes. */
interface FsHardRules {
  readonly denied: readonly ResolvedRule[]
  readonly readOnly: readonly ResolvedRule[]
  readonly nameDenied: readonly ResolvedNameRule[]
  readonly nameReadOnly: readonly ResolvedNameRule[]
}

/** Keep only the fs-surface rules of one resolved report, splitting literal from name rules. */
function fsHardRulesOf(report: ResolveReport): FsHardRules {
  return {
    denied: report.denied.filter(rule => rule.surfaces.includes('fs')),
    readOnly: report.readOnly.filter(rule => rule.surfaces.includes('fs')),
    nameDenied: report.nameRules.filter(rule => rule.access === 'deny' && rule.surfaces.includes('fs')),
    nameReadOnly: report.nameRules.filter(rule => rule.access === 'read' && rule.surfaces.includes('fs')),
  }
}

/** Whether any hard rule — literal or name — could refuse a write. */
function hasHardRules(hard: FsHardRules): boolean {
  return hard.denied.length > 0
    || hard.readOnly.length > 0
    || hard.nameDenied.length > 0
    || hard.nameReadOnly.length > 0
}

/**
 * The name rules that GRANT a write on one surface under `mode`, mirroring
 * `grantFor`'s mode gate exactly: `write` rides `workspace-write`, `always-write`
 * survives `read-only` (the caller never reaches this under
 * `danger-full-access`: there is no fence to widen).
 * @param report - the resolved report.
 * @param surface - the enforcement surface asking.
 * @param mode - the resolved per-call mode.
 * @returns the granting name rules, in configured order.
 */
function grantingNameRules(report: ResolveReport, surface: Surface, mode: PolicyLike['mode']): readonly ResolvedNameRule[] {
  return report.nameRules.filter(rule => rule.surfaces.includes(surface)
    && (rule.access === 'always-write' || (rule.access === 'write' && mode === 'workspace-write')))
}

/**
 * Whether a service is the sandboxed filesystem: mutating methods plus the
 * capability fact (`sandboxMode`) that only a confining backend exposes.
 * A plain local filesystem is left unwrapped — nothing confines it.
 * @param value - the service read from the context.
 * @returns true when the wrapper applies.
 */
export function isConfiningFs(value: unknown): value is FsInnerLike {
  const fs = value as FsInnerLike | undefined
  return typeof fs?.writeText === 'function'
    && typeof fs.editText === 'function'
    && typeof fs.resolve === 'function'
    && typeof fs.sandboxMode === 'string'
}

/**
 * Whether a configured root can be expressed as an `additionalWritableRoots`
 * entry for the 0.2.2 fence: an existing PHYSICAL directory. The base fence
 * rejects missing, non-directory and symlinked entries by throwing, so a grant
 * list is only assembled from roots that pass the same test.
 * @param path - the canonical root to test.
 * @returns true when the base fence would accept it.
 */
function isPhysicalDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && realpathSync.native(path) === resolvePath(path)
  } catch {
    return false
  }
}

/**
 * Whether the configuration COULD produce a document-wide hard rule (a
 * `deny`/`read` entry on the fs surface — a BARE NAME rule included: it is an
 * entry like any other, it just matches at many depths). This is the cheap
 * pre-check that keeps a legacy write-only document from paying a resolution on
 * every read.
 * @param config - the live configuration.
 * @returns true when at least one restriction entry exists for `fs`.
 */
function hasFsRestrictionEntries(config: ExtraPathsConfig): boolean {
  return config.paths.some(entry => (entry.access === 'deny' || entry.access === 'read') && entry.surfaces.includes('fs'))
}

/** The same pre-check for deny rules alone (what a READ can be refused by). */
function hasFsDenyEntries(config: ExtraPathsConfig): boolean {
  return config.paths.some(entry => entry.access === 'deny' && entry.surfaces.includes('fs'))
}

/**
 * The lazily resolved view of ONE call: the report and the name-rule scope roots
 * derived from it.
 *
 * Why lazy: a write under `danger-full-access` (or a caller-less call) must not
 * pay for a report nothing will consult — that is the "no resolve, no re-stamp"
 * pin. Why shared per call: the hard-rule check and the grant translation used
 * to resolve TWICE, so a concurrent change could make one see a rule the other
 * did not. One report, one scope, one decision.
 * @param config - the live configuration snapshot of this call.
 * @param baseRoot - the workspace the report and the name scope resolve against.
 * @param facts - host facts.
 * @returns accessors that build each value at most once.
 */
function callResolution(
  config: ExtraPathsConfig,
  baseRoot: string,
  facts: PlatformFacts,
): { readonly report: () => ResolveReport; readonly scopeRoots: () => readonly string[] } {
  let report: ResolveReport | undefined
  let scopeRoots: readonly string[] | undefined
  return {
    report: () => (report ??= resolveRoots(config, baseRoot, facts)),
    scopeRoots: () => {
      const resolved = (report ??= resolveRoots(config, baseRoot, facts))
      return (scopeRoots ??= nameScopeRoots(resolved, baseRoot, facts))
    },
  }
}

/**
 * Wrap one filesystem service.
 * @param inner - the service instance read from the context.
 * @param deps - configuration and policy sources.
 * @returns a transparent proxy that refuses hard-rule violations and grants
 *   configured writable roots on mutation.
 */
export function wrapFs(inner: FsInnerLike, deps: FsWrapDeps): FsInnerLike {
  const bound = new Map<PropertyKey, unknown>()

  /**
   * Refuse a content read when a `deny` rule (literal or name) covers the
   * caller-resolved target.
   *
   * Reads carry no per-call policy, so the resolution base is the deployment
   * fallback's workspace (relative deny rules are best effort here; the tool
   * layer's guard resolves them against the SESSION cwd instead). The same base
   * is the workspace scope root of a name rule, which is exactly what the shell
   * expansion and the preview used — one scope definition, no surface drift.
   * @param target - the resolved target the read is about.
   * @throws {AccessDeniedError} when a deny rule covers the target.
   */
  const assertReadAllowed = (target: FsTargetLike): void => {
    const config = deps.readConfig()
    if (!hasFsDenyEntries(config)) return
    const baseRoot = deps.fallbackPolicy()?.workspaceRoot ?? process.cwd()
    const facts = discoverPlatformFacts()
    const report = resolveRoots(config, baseRoot, facts)
    const hard = fsHardRulesOf(report)
    if (hard.denied.length === 0 && hard.nameDenied.length === 0) return
    const targetKey = String(target.targetKey)
    const rule = matchDenied(hard.denied, 'fs', targetKey, facts)
    if (rule !== undefined) throw readDenied(target.displayPath, rule)
    const nameHit = matchNameRule(hard.nameDenied, 'fs', targetKey, nameScopeRoots(report, baseRoot, facts), facts)
    if (nameHit !== undefined) throw readDenied(target.displayPath, nameRuleHitAsResolvedRule(nameHit))
  }

  /**
   * Refuse a write when a `deny` (first) or `read` rule covers the target, on
   * either the literal or the name-rule side.
   *
   * Deny wins over read-only across BOTH kinds (`deny` on a name rule must not
   * lose to a literal read rule), and every check runs BEFORE any grant elevation
   * or backend delegation: a hard rule is never overridden by a broader writable
   * ancestor. They are also checked under `danger-full-access` — the host does not
   * confine then, so this is the only layer left.
   * @param hard - the fs-surface hard rules of the resolved report.
   * @param displayPath - the target as the caller spelled it (for the message).
   * @param targetKey - the freshly re-canonicalised target identity.
   * @param scopeRoots - name-rule scope roots for this report.
   * @param facts - host facts.
   * @throws {AccessDeniedError} when a hard rule covers the target.
   */
  const assertWritable = (
    hard: FsHardRules,
    displayPath: string,
    targetKey: string,
    scopeRoots: readonly string[],
    facts: PlatformFacts,
  ): void => {
    const denied = matchDenied(hard.denied, 'fs', targetKey, facts)
    if (denied !== undefined) throw writeDenied(displayPath, denied)
    const nameDenied = matchNameRule(hard.nameDenied, 'fs', targetKey, scopeRoots, facts)
    if (nameDenied !== undefined) throw writeDenied(displayPath, nameRuleHitAsResolvedRule(nameDenied))
    const readOnly = matchReadOnly(hard.readOnly, 'fs', targetKey, facts)
    if (readOnly !== undefined) throw writeReadOnly(displayPath, readOnly)
    const nameReadOnly = matchNameRule(hard.nameReadOnly, 'fs', targetKey, scopeRoots, facts)
    if (nameReadOnly !== undefined) throw writeReadOnly(displayPath, nameRuleHitAsResolvedRule(nameReadOnly))
  }

  const translate = async (
    target: FsTargetLike,
    callerPolicy: PolicyLike | undefined,
    delegate: (policy: PolicyLike | undefined) => Promise<unknown>,
  ): Promise<unknown> => {
    const config = deps.readConfig()
    const effective = callerPolicy ?? deps.fallbackPolicy()
    const facts = discoverPlatformFacts()
    // Every relative restriction (and the name-rule workspace scope) resolves
    // against the policy workspace when one exists, exactly like the base fence.
    const baseRoot = effective?.workspaceRoot ?? process.cwd()
    const resolution = callResolution(config, baseRoot, facts)
    // Re-canonicalise ONCE, exactly like the base fence does: the identity a hard
    // rule judges and the identity a grant matches must be the same fresh one.
    let fresh: FsTargetLike | undefined
    const freshOf = async (): Promise<FsTargetLike> => {
      if (fresh === undefined) fresh = await inner.resolve(target.displayPath)
      return fresh
    }
    const targetKeyOf = async (): Promise<string> => String((await freshOf()).targetKey)

    // Hard rules first, in EVERY mode: a deny/read rule is an explicit user rule,
    // not a consequence of the session mode. Name rules match the same fresh
    // canonical identity, lexically, at any depth under the scope roots.
    if (hasFsRestrictionEntries(config)) {
      const hard = fsHardRulesOf(resolution.report())
      if (hasHardRules(hard)) assertWritable(hard, target.displayPath, await targetKeyOf(), resolution.scopeRoots(), facts)
    }
    if (effective === undefined || effective.mode === 'danger-full-access') return delegate(effective)
    const granted = grantFor(effective.mode, resolution.report().roots, 'fs')
    const nameGrants = grantingNameRules(resolution.report(), 'fs', effective.mode)
    if (granted.length === 0 && nameGrants.length === 0) return delegate(effective)
    const targetKey = await targetKeyOf()
    // Literal grants win over name rules: the name rule is the fallback spelling
    // for "this structure anywhere", and the literal entry is the more specific
    // statement of the same intent (the same reason a nested literal root is not
    // narrowed by its child in the report).
    const match = granted.find(root => isUnder(targetKey, root.root, facts))
    if (match !== undefined) return delegate(syntheticPolicy(effective, match.root))
    const nameGrant = matchNameRule(nameGrants, 'fs', targetKey, resolution.scopeRoots(), facts)
    if (nameGrant !== undefined) return delegate(syntheticPolicy(effective, nameGrant.root))
    return delegate(effective)
  }

  /**
   * A move is one call with TWO fenced targets. Both ends must pass the hard
   * rules (literal and name), and both must land in the configured set: one
   * policy then carries the union. When the ends share one configured root (or
   * one matched name component) the workspace-root re-stamp is enough on every
   * host; two different roots are expressed through `additionalWritableRoots`
   * (0.2.2+, the only host generation that has `moveFile` at all).
   */
  const translateMove = async (
    source: FsTargetLike,
    destination: FsTargetLike,
    callerPolicy: PolicyLike | undefined,
    delegate: (policy: PolicyLike | undefined) => Promise<unknown>,
  ): Promise<unknown> => {
    const config = deps.readConfig()
    const effective = callerPolicy ?? deps.fallbackPolicy()
    const facts = discoverPlatformFacts()
    const baseRoot = effective?.workspaceRoot ?? process.cwd()
    const resolution = callResolution(config, baseRoot, facts)
    // Both ends are re-canonicalised ONCE and shared by the hard rules and the
    // grant translation, so a single call cannot judge two different identities.
    let freshSource: FsTargetLike | undefined
    let freshDestination: FsTargetLike | undefined
    const resolveBoth = async (): Promise<[FsTargetLike, FsTargetLike]> => {
      if (freshSource === undefined || freshDestination === undefined) {
        const [resolvedSource, resolvedDestination] = await Promise.all([
          inner.resolve(source.displayPath),
          inner.resolve(destination.displayPath),
        ])
        freshSource = resolvedSource
        freshDestination = resolvedDestination
      }
      return [freshSource, freshDestination]
    }
    if (hasFsRestrictionEntries(config)) {
      const hard = fsHardRulesOf(resolution.report())
      if (hasHardRules(hard)) {
        const [resolvedSource, resolvedDestination] = await resolveBoth()
        const scopeRoots = resolution.scopeRoots()
        assertWritable(hard, source.displayPath, String(resolvedSource.targetKey), scopeRoots, facts)
        assertWritable(hard, destination.displayPath, String(resolvedDestination.targetKey), scopeRoots, facts)
      }
    }
    if (effective === undefined || effective.mode === 'danger-full-access') return delegate(effective)
    const granted = grantFor(effective.mode, resolution.report().roots, 'fs')
    const nameGrants = grantingNameRules(resolution.report(), 'fs', effective.mode)
    if (granted.length === 0 && nameGrants.length === 0) return delegate(effective)
    const [resolvedSource, resolvedDestination] = await resolveBoth()
    // The effective root of one end: the literal grant first, then the matched
    // name component (the same precedence `translate` uses).
    const grantRootOf = (targetKey: string): string | undefined => {
      const literal = granted.find(root => isUnder(targetKey, root.root, facts))
      if (literal !== undefined) return literal.root
      return matchNameRule(nameGrants, 'fs', targetKey, resolution.scopeRoots(), facts)?.root
    }
    const sourceRoot = grantRootOf(String(resolvedSource.targetKey))
    const destinationRoot = grantRootOf(String(resolvedDestination.targetKey))
    if (sourceRoot === undefined || destinationRoot === undefined) return delegate(effective)
    if (sourceRoot === destinationRoot) return delegate(syntheticPolicy(effective, sourceRoot))
    const roots = [sourceRoot, destinationRoot]
    if (!roots.every(isPhysicalDirectory)) return delegate(effective)
    return delegate(syntheticPolicy(effective, sourceRoot, [destinationRoot]))
  }

  // Built ONCE per wrapper: reading a method twice must hand back the same
  // function (and a fresh closure per read is pure allocation). Nothing here
  // captures read-time state — the policy is resolved inside each call.
  const writeText = (t: FsTargetLike, content: string, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translate(t, policy, effective => inner.writeText(t, content, expected, signal, effective))
  const editText = (t: FsTargetLike, edit: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translate(t, policy, effective => inner.editText(t, edit, expected, signal, effective))
  const patchText = (t: FsTargetLike, hunks: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translate(t, policy, effective => inner.patchText!(t, hunks, expected, signal, effective))
  const deleteFile = (t: FsTargetLike, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translate(t, policy, effective => inner.deleteFile!(t, expected, signal, effective))
  const moveFile = (source: FsTargetLike, destination: FsTargetLike, options?: unknown, signal?: AbortSignal, policy?: PolicyLike) =>
    translateMove(source, destination, policy, effective => inner.moveFile!(source, destination, options, signal, effective))

  const overrides = new Map<PropertyKey, unknown>([
    ['writeText', writeText],
    ['editText', editText],
  ])
  // Only override what the running host declares: a 0.2.1 service must keep
  // answering `undefined` for the 0.2.2-only mutations, and a stub without reads
  // must keep answering `undefined` for them too.
  if (typeof inner.patchText === 'function') overrides.set('patchText', patchText)
  if (typeof inner.deleteFile === 'function') overrides.set('deleteFile', deleteFile)
  if (typeof inner.moveFile === 'function') overrides.set('moveFile', moveFile)
  // Reads are guarded only when the inner declares them: the deny check is the
  // FIRST thing that runs, before the backend can touch the file. The delegate
  // result is returned as-is (no `async` wrapper), keeping sync backends sync.
  for (const method of READ_METHODS) {
    const impl = (inner as unknown as Record<string, unknown>)[method]
    if (typeof impl !== 'function') continue
    overrides.set(method, (target: FsTargetLike, ...rest: unknown[]): unknown => {
      assertReadAllowed(target)
      return (impl as (...args: unknown[]) => unknown).call(inner, target, ...rest)
    })
  }

  return new Proxy(inner, {
    get(target, prop) {
      const override = overrides.get(prop)
      if (override !== undefined) return override
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function' || prop === 'constructor') return value
      const cached = bound.get(prop)
      if (cached !== undefined) return cached
      const fn = value.bind(target)
      bound.set(prop, fn)
      return fn
    },
  })
}
