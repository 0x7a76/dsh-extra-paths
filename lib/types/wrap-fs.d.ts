/**
 * The filesystem half of the plugin: a transparent Proxy over `ctx.fs` that
 * re-stamps ONE call's policy when its target lies under a configured root.
 *
 * Transparency rules (verified against cordis 4.0.2 by
 * spike/cordis-get-wrap-baseline.mjs): forward every property with the inner
 * value as the receiver, bind methods to the inner instance — except
 * `constructor`, whose binding breaks the framework's own `instanceof`
 * (`Service[Symbol.hasInstance]` walks `instance.constructor`).
 * @module dsh-extra-paths/wrap-fs
 */
import type { ExtraPathsConfig } from './config.js';
import { type PolicyLike } from './policy.js';
/** A resolved filesystem target (the fs service's own shape). */
export interface FsTargetLike {
    readonly targetKey: unknown;
    readonly displayPath: string;
}
/** The subset of the filesystem service this wrapper intercepts. */
export interface FsInnerLike {
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTargetLike>;
    writeText(target: FsTargetLike, content: string, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
    editText(target: FsTargetLike, edit: unknown, expected?: unknown, signal?: AbortSignal, policy?: PolicyLike): Promise<unknown>;
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
 * @returns a transparent proxy that grants configured roots on mutation.
 */
export declare function wrapFs(inner: FsInnerLike, deps: FsWrapDeps): FsInnerLike;
