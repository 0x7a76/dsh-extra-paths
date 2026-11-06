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
import type { ExtraPathsConfig, Surface } from './config.js';
import { type PlatformFacts } from './paths.js';
import { type PolicyLike } from './policy.js';
import { type ResolvedNameRule, type ResolvedRule } from './resolve.js';
/** A resolved filesystem target (the fs service's own shape). */
export interface FsTargetLike {
    readonly targetKey: unknown;
    readonly displayPath: string;
}
/** The read methods whose CONTENT/listing the deny rules must intercept. */
export type FsReadMethod = 'readText' | 'streamText' | 'readBytes' | 'readByteRange' | 'listDir' | 'watch';
/**
 * The subset of the filesystem service this wrapper intercepts.
 *
 * The read methods are optional: a stub or an older host that does not declare
 * one keeps that exact surface (the wrapper only overrides what exists).
 */
export interface FsInnerLike {
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTargetLike>;
    /** DSH 0.2.x: whole-text read. */
    readText?(target: FsTargetLike, signal?: AbortSignal): Promise<unknown>;
    /** DSH 0.2.x: chunked text read. */
    streamText?(target: FsTargetLike, signal?: AbortSignal): Promise<unknown>;
    /** DSH 0.2.x: raw byte read. */
    readBytes?(target: FsTargetLike, signal: AbortSignal | undefined, maxBytes: number): Promise<unknown>;
    /** DSH 0.2.x: one byte window. */
    readByteRange?(target: FsTargetLike, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<unknown>;
    /** DSH 0.2.x: directory listing. */
    listDir?(target: FsTargetLike, signal?: AbortSignal): Promise<unknown>;
    /** DSH 0.2.x: change observation. */
    watch?(target: FsTargetLike, changed: (error?: Error) => void, signal: AbortSignal): Promise<unknown>;
    writeText(target: FsTargetLike, content: string, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
    editText(target: FsTargetLike, edit: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
    /** DSH 0.2.2+: apply parsed hunks (the `apply_patch` tool's surface). */
    patchText?(target: FsTargetLike, hunks: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
    /** DSH 0.2.2+: remove one regular file. */
    deleteFile?(target: FsTargetLike, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
    /** DSH 0.2.2+: publish a destination and remove the source. */
    moveFile?(source: FsTargetLike, destination: FsTargetLike, options?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
    readonly sandboxMode?: string;
}
/** What the wrapper needs from the plugin. */
export interface FsWrapDeps {
    /** Live configuration: re-read on EVERY call, never captured at wrap time. */
    readConfig(): ExtraPathsConfig;
    /** Deployment policy for a caller that stamped none; resolved per call. */
    fallbackPolicy(): PolicyLike | undefined;
}
/**
 * One name rule that covers a target, plus the component path it matched (the
 * rule's effective root, which is what a message and a synthetic policy name).
 */
export interface NameRuleMatch {
    /** The configured name rule that matched. */
    readonly rule: ResolvedNameRule;
    /** The canonical matched component path; the rule covers this path and its subtree. */
    readonly root: string;
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
export declare function matchNameRule(rules: readonly ResolvedNameRule[], surface: Surface, targetKey: string, scopeRoots: readonly string[], facts: PlatformFacts): NameRuleMatch | undefined;
/**
 * A rule-shaped view of a name-rule hit, so `denial.ts`'s message helpers apply
 * to name rules unchanged. Callers pass only deny/read rule lists (a grant is
 * never a refusal, and `write` maps to the `read` message level).
 * @param hit - the matched name rule and component path.
 * @returns the `ResolvedRule`-like value the message builders take.
 */
export declare function nameRuleHitAsResolvedRule(hit: NameRuleMatch): ResolvedRule;
/**
 * Whether a service is the sandboxed filesystem: mutating methods plus the
 * capability fact (`sandboxMode`) that only a confining backend exposes.
 * A plain local filesystem is left unwrapped — nothing confines it.
 * @param value - the service read from the context.
 * @returns true when the wrapper applies.
 */
export declare function isConfiningFs(value: unknown): value is FsInnerLike;
/**
 * Wrap one filesystem service.
 * @param inner - the service instance read from the context.
 * @param deps - configuration and policy sources.
 * @returns a transparent proxy that refuses hard-rule violations and grants
 *   configured writable roots on mutation.
 */
export declare function wrapFs(inner: FsInnerLike, deps: FsWrapDeps): FsInnerLike;
