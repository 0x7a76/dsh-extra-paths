/**
 * The subprocess half of the plugin: a transparent Proxy over `ctx.sandbox`
 * that appends one write grant per configured root to the argv the base
 * provider already wrapped. An unrecognised runner dialect fails closed: the
 * argv is returned untouched (the write stays denied) and a warning is logged.
 *
 * THE WRAPPER MIRRORS THE INNER PROVIDER'S SYNC-NESS, because that changed
 * between host generations and both must work:
 *
 * - 0.1.5 returns the confinement record SYNCHRONOUSLY and its callers read
 *   `.argv` off the result without awaiting
 *   (`return sandbox.confine(argv, policy).argv`). An `async` wrapper there
 *   yields `undefined` and every confined process dies with "Cannot read
 *   properties of undefined (reading '0')".
 * - 0.2.x declares `confine(argv, policy, signal): Promise<ConfinedArgv>` and
 *   every caller awaits it.
 *
 * So a synchronous result is widened synchronously, and a thenable result is
 * widened in a continuation instead of being forced through `async` — the same
 * code satisfies a caller that awaits and one that does not.
 *
 * A dialect the wrapper does not recognise (`windows-acl`, a remote
 * `sandbox-ssh` runner) also fails closed, as does an unknown one.
 * @module dsh-extra-paths/wrap-sandbox
 */
import { widenArgv } from './argv.js';
import { grantFor } from './grant.js';
import { resolveRoots } from './resolve.js';
/** Whether a provider answered with a thenable instead of the record itself. */
function isThenable(value) {
    return typeof value.then === 'function';
}
/**
 * Whether a service is a process-sandbox provider.
 *
 * Only `confine` is probed: it is the provider's whole public surface, the
 * abstract base declares it, and every concrete runner implements it. A false
 * positive could only wrap a service that already answers `confine`.
 * @param value - the service read from the context.
 * @returns true when the value looks like a sandbox provider.
 */
export function isConfiningSandbox(value) {
    return typeof value?.confine === 'function';
}
/**
 * Wrap one sandbox provider.
 * @param inner - the provider read from the context.
 * @param deps - configuration source and warning sink.
 * @returns a transparent proxy that widens profiles for configured roots.
 */
export function wrapSandbox(inner, deps) {
    const bound = new Map();
    const widen = (confined, wrappedLength, policy) => {
        const granted = grantFor(policy.mode, resolveRoots(deps.readConfig(), policy.workspaceRoot).roots, 'shell');
        if (granted.length === 0)
            return confined;
        const widened = widenArgv(confined.argv, wrappedLength, granted.map(root => root.root));
        if (widened === undefined) {
            deps.warn(`extra-paths: unrecognised sandbox runner dialect (${JSON.stringify(confined.argv[0])}); `
                + 'extra paths are NOT granted for this command');
            return confined;
        }
        return { ...confined, argv: widened };
    };
    // Deliberately NOT `async` (see the module comment): the caller reads `.argv`
    // synchronously off this call's result.
    const confine = (argv, policy, signal) => {
        const confined = inner.confine(argv, policy, signal);
        if (isThenable(confined))
            return confined.then(record => widen(record, argv.length, policy));
        return widen(confined, argv.length, policy);
    };
    return new Proxy(inner, {
        get(target, prop) {
            if (prop === 'confine')
                return confine;
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
//# sourceMappingURL=wrap-sandbox.js.map