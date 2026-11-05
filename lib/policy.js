/**
 * Per-call policy shapes and the translation the fs wrapper performs.
 * @module dsh-extra-paths/policy
 */
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
export function syntheticPolicy(policy, workspaceRoot, additionalWritableRoots) {
    const { additionalWritableRoots: _callerRoots, ...rest } = policy;
    return {
        ...rest,
        mode: 'workspace-write',
        workspaceRoot,
        ...(additionalWritableRoots === undefined ? {} : { additionalWritableRoots }),
    };
}
//# sourceMappingURL=policy.js.map