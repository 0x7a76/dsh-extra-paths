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
 * Wrap one filesystem service.
 * @param inner - the service instance read from the context.
 * @param deps - configuration and policy sources.
 * @returns a transparent proxy that grants configured roots on mutation.
 */
export function wrapFs(inner, deps) {
    const bound = new Map();
    const translate = async (target, policy, delegate) => {
        if (policy === undefined || policy.mode === 'danger-full-access')
            return delegate(policy);
        const granted = grantFor(policy.mode, resolveRoots(deps.readConfig(), policy.workspaceRoot).roots, 'fs');
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
    // Built ONCE per wrapper: reading a method twice must hand back the same
    // function (and a fresh closure per read is pure allocation). Nothing here
    // captures read-time state — the policy is resolved inside each call.
    const writeText = (t, content, expected, signal, policy) => translate(t, policy ?? deps.fallbackPolicy(), effective => inner.writeText(t, content, expected, signal, effective));
    const editText = (t, edit, expected, signal, policy) => translate(t, policy ?? deps.fallbackPolicy(), effective => inner.editText(t, edit, expected, signal, effective));
    return new Proxy(inner, {
        get(target, prop) {
            if (prop === 'writeText')
                return writeText;
            if (prop === 'editText')
                return editText;
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