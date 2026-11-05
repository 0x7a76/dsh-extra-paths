/**
 * Per-call policy shapes and the translation the fs wrapper performs.
 * @module dsh-extra-paths/policy
 */

import type { SandboxModeLike } from './grant.js'

/** The subset of the fs/sandbox per-call policy this plugin reads and rewrites. */
export interface PolicyLike {
  readonly mode: SandboxModeLike
  readonly workspaceRoot: string
  /**
   * Explicit extra writable directories a policy may carry (DSH 0.2.2+).
   *
   * The 0.2.2 enforcement layers derive their allow-list from the workspace
   * root PLUS this list, so a single synthetic policy can grant more than one
   * configured root — which is what a move between two configured roots needs.
   * Older hosts have no such field and ignore it; the wrapper only sets it for
   * the 0.2.2-only `moveFile` surface.
   */
  readonly additionalWritableRoots?: readonly string[]
  readonly sessionId?: unknown
}

/**
 * The policy one call is re-stamped with so the base fence accepts a target
 * under a configured root. The mode rises to `workspace-write` because that is
 * this grant's meaning: a single call is allowed to write this root, while the
 * base class keeps owning resolution, atomic publication and the version guard.
 *
 * The caller's own `additionalWritableRoots` are dropped on purpose: under a
 * `read-only` session an `always-write` grant must not smuggle the deployment's
 * extra roots into the elevated call.
 * @param policy - the caller's resolved policy.
 * @param workspaceRoot - the canonical configured root that matched the target.
 * @param additionalWritableRoots - further configured roots to grant in the
 *   same call (DSH 0.2.2+ only; used by `moveFile` when both ends lie under
 *   different configured roots).
 * @returns the policy to hand the base implementation.
 */
export function syntheticPolicy(
  policy: PolicyLike,
  workspaceRoot: string,
  additionalWritableRoots?: readonly string[],
): PolicyLike {
  const { additionalWritableRoots: _callerRoots, ...rest } = policy
  return {
    ...rest,
    mode: 'workspace-write',
    workspaceRoot,
    ...(additionalWritableRoots === undefined ? {} : { additionalWritableRoots }),
  }
}
