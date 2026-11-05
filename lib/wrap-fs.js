/**
 * The filesystem half of the plugin: a transparent Proxy over `ctx.fs` that
 * re-stamps ONE call's policy when its target lies under a configured root.
 *
 * The host generation decides how many mutations this surface has. 0.2.0/0.2.1
 * fence `writeText`/`editText`; 0.2.2 additionally fences `patchText`,
 * `deleteFile` and `moveFile` (the `apply_patch` tool and the delete/move
 * operations). The wrapper therefore overrides every mutation the INNER service
 * actually exposes, and never invents one: on a 0.2.1 service the three newer
 * methods stay absent, exactly as the base class declared them.
 *
 * Transparency rules (verified against cordis 4.0.2 by
 * spike/cordis-get-wrap-baseline.mjs): forward every property with the inner
 * value as the receiver, bind methods to the inner instance — except
 * `constructor`, whose binding breaks the framework's own `instanceof`
 * (`Service[Symbol.hasInstance]` walks `instance.constructor`).
 * @module dsh-extra-paths/wrap-fs
 */
import { realpathSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { grantFor } from './grant.js';
import { isUnder } from './paths.js';
import { syntheticPolicy } from './policy.js';
import { resolveRoots } from './resolve.js';
/**
 * Whether a service is the sandboxed filesystem: mutating methods plus the
 * capability fact (`sandboxMode`) that only a confining backend exposes.
 * A plain local filesystem is left unwrapped — nothing confines it.
 * @param value - the service read from the context.
 * @returns true when the wrapper applies.
 */
export function isConfiningFs(value) {
    const fs = value;
    return typeof fs?.writeText === 'function'
        && typeof fs.editText === 'function'
        && typeof fs.resolve === 'function'
        && typeof fs.sandboxMode === 'string';
}
/**
 * Whether a configured root can be expressed as an `additionalWritableRoots`
 * entry for the 0.2.2 fence: an existing PHYSICAL directory. The base fence
 * rejects missing, non-directory and symlinked entries by throwing, so a grant
 * list is only assembled from roots that pass the same test.
 * @param path - the canonical root to test.
 * @returns true when the base fence would accept it.
 */
function isPhysicalDirectory(path) {
    try {
        return statSync(path).isDirectory() && realpathSync.native(path) === resolvePath(path);
    }
    catch {
        return false;
    }
}
/**
 * Wrap one filesystem service.
 * @param inner - the service instance read from the context.
 * @param deps - configuration and policy sources.
 * @returns a transparent proxy that grants configured roots on mutation.
 */
export function wrapFs(inner, deps) {
    const bound = new Map();
    /** Roots this call grants, or an empty list when the target set is not covered. */
    const grantedFor = (policy) => grantFor(policy.mode, resolveRoots(deps.readConfig(), policy.workspaceRoot).roots, 'fs');
    const translate = async (target, policy, delegate) => {
        if (policy === undefined || policy.mode === 'danger-full-access')
            return delegate(policy);
        const granted = grantedFor(policy);
        if (granted.length === 0)
            return delegate(policy);
        // Re-canonicalise NOW, exactly like the base fence does, so the identity we
        // matched is the identity the base will check.
        const fresh = await inner.resolve(target.displayPath);
        const match = granted.find(root => isUnder(String(fresh.targetKey), root.root));
        if (match === undefined)
            return delegate(policy);
        return delegate(syntheticPolicy(policy, match.root));
    };
    /**
     * A move is one call with TWO fenced targets. Both ends must land in the
     * configured set; one policy then carries the union. When the ends share one
     * configured root the workspace-root re-stamp is enough on every host; two
     * different roots are expressed through `additionalWritableRoots` (0.2.2+,
     * the only host generation that has `moveFile` at all).
     */
    const translateMove = async (source, destination, policy, delegate) => {
        if (policy === undefined || policy.mode === 'danger-full-access')
            return delegate(policy);
        const granted = grantedFor(policy);
        if (granted.length === 0)
            return delegate(policy);
        const [freshSource, freshDestination] = await Promise.all([
            inner.resolve(source.displayPath),
            inner.resolve(destination.displayPath),
        ]);
        const sourceRoot = granted.find(root => isUnder(String(freshSource.targetKey), root.root));
        const destinationRoot = granted.find(root => isUnder(String(freshDestination.targetKey), root.root));
        if (sourceRoot === undefined || destinationRoot === undefined)
            return delegate(policy);
        if (sourceRoot === destinationRoot)
            return delegate(syntheticPolicy(policy, sourceRoot.root));
        const roots = [sourceRoot.root, destinationRoot.root];
        if (!roots.every(isPhysicalDirectory))
            return delegate(policy);
        return delegate(syntheticPolicy(policy, sourceRoot.root, [destinationRoot.root]));
    };
    // Built ONCE per wrapper: reading a method twice must hand back the same
    // function (and a fresh closure per read is pure allocation). Nothing here
    // captures read-time state — the policy is resolved inside each call.
    const writeText = (t, content, expected, signal, policy) => translate(t, policy ?? deps.fallbackPolicy(), effective => inner.writeText(t, content, expected, signal, effective));
    const editText = (t, edit, expected, signal, policy) => translate(t, policy ?? deps.fallbackPolicy(), effective => inner.editText(t, edit, expected, signal, effective));
    const patchText = (t, hunks, expected, signal, policy) => translate(t, policy ?? deps.fallbackPolicy(), effective => inner.patchText(t, hunks, expected, signal, effective));
    const deleteFile = (t, expected, signal, policy) => translate(t, policy ?? deps.fallbackPolicy(), effective => inner.deleteFile(t, expected, signal, effective));
    const moveFile = (source, destination, options, signal, policy) => translateMove(source, destination, policy ?? deps.fallbackPolicy(), effective => inner.moveFile(source, destination, options, signal, effective));
    const overrides = new Map([
        ['writeText', writeText],
        ['editText', editText],
    ]);
    // Only override what the running host declares: a 0.2.1 service must keep
    // answering `undefined` for the 0.2.2-only mutations.
    if (typeof inner.patchText === 'function')
        overrides.set('patchText', patchText);
    if (typeof inner.deleteFile === 'function')
        overrides.set('deleteFile', deleteFile);
    if (typeof inner.moveFile === 'function')
        overrides.set('moveFile', moveFile);
    return new Proxy(inner, {
        get(target, prop) {
            const override = overrides.get(prop);
            if (override !== undefined)
                return override;
            const value = Reflect.get(target, prop, target);
            if (typeof value !== 'function' || prop === 'constructor')
                return value;
            const cached = bound.get(prop);
            if (cached !== undefined)
                return cached;
            const fn = value.bind(target);
            bound.set(prop, fn);
            return fn;
        },
    });
}
//# sourceMappingURL=wrap-fs.js.map