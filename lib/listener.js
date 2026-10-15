/**
 * The `internal/get` interception: wraps `ctx.fs` and `ctx.sandbox` as they are
 * read. The callback must never change the semantics of a service read — it
 * always calls `next()`, rethrows a resolution failure unchanged, and falls
 * back to the unwrapped value if its own wrapping throws.
 * @module dsh-extra-paths/listener
 */
import { isConfiningFs, wrapFs } from './wrap-fs.js';
import { isConfiningSandbox, wrapSandbox } from './wrap-sandbox.js';
/**
 * Resolve `ctx.sandboxPolicy.resolve()` through a reading context without
 * requiring an injection — `reflect.get` is exactly the non-strict read.
 * @param readCtx - the context whose proxy served the service read.
 * @returns the deployment policy, or undefined when the service is unavailable.
 */
export function fallbackPolicyOf(readCtx) {
    const get = readCtx?.get;
    if (typeof get !== 'function')
        return undefined;
    const service = get.call(readCtx, 'sandboxPolicy', false);
    return typeof service?.resolve === 'function' ? service.resolve() : undefined;
}
/**
 * Install the interception listener on the calling fiber.
 * @param ctx - the plugin context (the listener is disposed with its fiber).
 * @param deps - configuration and logging sources.
 * @returns counters the caller uses for the load-time self-test.
 */
export function installListener(ctx, deps) {
    const state = { reads: 0, fsWraps: 0, sandboxWraps: 0 };
    ctx.on('internal/get', (readCtx, name, _error, next) => {
        const value = next();
        state.reads += 1;
        try {
            if (name === 'fs' && isConfiningFs(value)) {
                state.fsWraps += 1;
                return wrapFs(value, {
                    // Both are closures evaluated PER CALL: hoisting either one would
                    // freeze the session's workspace (and therefore which relative
                    // entries are live) at wrap time.
                    readConfig: deps.readConfig,
                    fallbackPolicy: () => deps.fallbackPolicy(readCtx),
                });
            }
            if (name === 'sandbox' && isConfiningSandbox(value)) {
                state.sandboxWraps += 1;
                return wrapSandbox(value, { readConfig: deps.readConfig, warn: deps.warn });
            }
        }
        catch (error) {
            deps.warn(`extra-paths: wrapping ctx.${String(name)} failed; it stays unwrapped: ${String(error)}`);
        }
        return value;
    });
    return state;
}
//# sourceMappingURL=listener.js.map