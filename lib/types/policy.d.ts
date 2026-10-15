/**
 * Per-call policy shapes and the translation the fs wrapper performs.
 * @module dsh-extra-paths/policy
 */
import type { SandboxModeLike } from './grant.js';
/** The subset of the fs/sandbox per-call policy this plugin reads and rewrites. */
export interface PolicyLike {
    readonly mode: SandboxModeLike;
    readonly workspaceRoot: string;
    readonly sessionId?: unknown;
}
/**
 * The policy one call is re-stamped with so the base fence accepts a target
 * under a configured root. The mode rises to `workspace-write` because that is
 * this grant's meaning: a single call is allowed to write this root, while the
 * base class keeps owning resolution, atomic publication and the version guard.
 * @param policy - the caller's resolved policy.
 * @param workspaceRoot - the canonical configured root that matched the target.
 * @returns the policy to hand the base implementation.
 */
export declare function syntheticPolicy(policy: PolicyLike, workspaceRoot: string): PolicyLike;
