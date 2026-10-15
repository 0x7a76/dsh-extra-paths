/**
 * Per-call policy shapes and the translation the fs wrapper performs.
 * @module dsh-extra-paths/policy
 */
/**
 * The policy one call is re-stamped with so the base fence accepts a target
 * under a configured root. The mode rises to `workspace-write` because that is
 * this grant's meaning: a single call is allowed to write this root, while the
 * base class keeps owning resolution, atomic publication and the version guard.
 * @param policy - the caller's resolved policy.
 * @param workspaceRoot - the canonical configured root that matched the target.
 * @returns the policy to hand the base implementation.
 */
export function syntheticPolicy(policy, workspaceRoot) {
    return { ...policy, mode: 'workspace-write', workspaceRoot };
}
//# sourceMappingURL=policy.js.map