/**
 * The subprocess half of the plugin: a transparent Proxy over `ctx.sandbox`
 * that appends the configured shell-surface rules to the argv the base provider
 * already wrapped — write grants AND the deny/read-only restrictions the runner
 * dialect can express (see {@link widenArgv}).
 *
 * A sandbox profile can only name CONCRETE paths, so a BARE NAME rule
 * (`.git`, `.env`, `node_modules`) is deliberately NOT enforced here: expanding
 * a name into "the paths it currently matches" means walking the workspace plus
 * every writable root before commands — costly, stale by up to the cache TTL,
 * and silently partial when one root is deep or unreadable (the real host hit
 * exactly that). Name rules therefore protect the fs tools only, where the
 * match is lexical, exact and live on every call. A configured `shell` surface
 * on a name rule gets an explicit one-time notice (see
 * {@link warnNameRulesAreFsOnly}) instead of a stale or partial mask set.
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
 * Every confinement also records the OBSERVED runner dialect (shell-dialect.ts),
 * which drives the settings page's capability badges. A dialect that cannot
 * express the rules must never be silently mis-claimed:
 * - `danger-full-access` has no runner to inject into, so the record is returned
 *   untouched (the fs half still enforces the hard rules);
 * - `landlock` can grant but cannot subtract, and `windows-acl` can do neither:
 *   both warn ONCE per dialect + rule signature and the command still runs.
 *   Warning only once is the fix for a real log-flood: a denied rule sits in the
 *   configuration and every single command would otherwise re-report it.
 * @module dsh-extra-paths/wrap-sandbox
 */
import { widenArgv } from './argv.js';
import { grantFor } from './grant.js';
import { resolveRoots } from './resolve.js';
import { recordShellDialect } from './shell-dialect.js';
/**
 * Capability warnings already logged, keyed by dialect + rule signature. Module
 * scope on purpose: the host may re-read `ctx.sandbox` per call, so a per-wrapper
 * set would warn again on every command — the exact log flood this prevents.
 */
const warnedCapabilities = new Set();
/** Test-only: forget the capability warnings that have been logged. */
export function resetShellWarnings() {
    warnedCapabilities.clear();
}
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
 * The shell-surface rules one resolved report contributes: the literal roots
 * plus every concrete path a name rule currently matches.
 *
 * The name matches follow the SAME access rules as literal entries — `deny`
 * restricts both directions, `read` only writes, and the grant gate mirrors
 * `grantFor` (`write` needs `workspace-write`, `always-write` survives
 * `read-only`). Paths are deduplicated because a literal entry and a name rule
 * can name the same root, and a duplicate `--mask`/`--bind` is pointless argv
 * noise (bwrap keeps the LAST mount, so a duplicate grant after a denial could
 * even re-widen it).
 * @param report - the report resolved WITH `expandNameRules`.
 * @param mode - the resolved per-call mode (never `danger-full-access` here).
 * @returns the deduplicated rule set to append, in report order.
 */
function shellRulesOf(report, mode) {
    return {
        grants: grantFor(mode, report.roots, 'shell').map(root => root.root),
        readOnly: report.readOnly.filter(rule => rule.surfaces.includes('shell')).map(rule => rule.root),
        denied: report.denied.filter(rule => rule.surfaces.includes('shell')).map(rule => rule.root),
    };
}
/** A stable identity for one rule set, so identical rules warn only once. */
function signatureOf(rules) {
    return JSON.stringify([rules.grants, rules.readOnly, rules.denied]);
}
/** The list of shell effects a dialect refused to express, in user terms. */
function lossesOf(dialect, rules) {
    if (dialect === 'windows-acl')
        return 'grant or deny extra paths';
    const losses = [];
    if (rules.denied.length > 0)
        losses.push('deny shell reads or writes');
    if (rules.readOnly.length > 0)
        losses.push('keep shell writes out of read-only paths');
    return losses.length > 0 ? losses.join(' or ') : 'express the configured restrictions';
}
/**
 * The honest warning for a dialect that could not express part of the rules.
 * @param dialect - the runner dialect that fell short.
 * @param rules - the rules it was asked to append.
 * @returns one user-facing line.
 */
function unsupportedWarning(dialect, rules) {
    if (dialect === 'windows-acl') {
        return 'extra-paths: the windows-acl shell runner cannot grant or deny extra paths '
            + '(it rejects arguments it does not know), so extra paths are NOT granted and the configured '
            + 'restrictions are NOT enforced for shell commands; they still protect the fs tools';
    }
    return `extra-paths: the ${dialect} shell runner is an allow-list and cannot ${lossesOf(dialect, rules)}; `
        + 'the configured restrictions only protect the fs tools for this host, not shell commands';
}
/**
 * The fail-closed warning for an unrecognised runner shape.
 * @param runner - the argv[0] the provider returned.
 * @returns one user-facing line.
 */
function unrecognisedWarning(runner) {
    return `extra-paths: unrecognised sandbox runner dialect (${JSON.stringify(runner)}); `
        + 'extra paths are NOT granted and configured restrictions are NOT enforced for this command';
}
/** Log one capability warning unless the same dialect+signature already logged it. */
function warnOnce(key, message, warn) {
    if (warnedCapabilities.has(key))
        return;
    warnedCapabilities.add(key);
    warn(message);
}
/**
 * Tell the user ONCE that bare-name rules do not reach the shell.
 *
 * A user who writes `.git | deny | fs+shell` reasonably expects bash to be
 * restricted too. It is not: the shell surface would need a concrete path list,
 * and enumerating one per command was abandoned (cost + partial coverage). The
 * notice is the honest replacement — silently ignoring the `shell` surface
 * would leave a security expectation unmet with no trace.
 * @param report - the un-expanded report (name rules only, no walk).
 * @param warn - the plugin's warning sink.
 */
function warnNameRulesAreFsOnly(report, warn) {
    const shellNames = report.nameRules
        .filter(rule => rule.surfaces.includes('shell'))
        .map(rule => JSON.stringify(rule.raw));
    if (shellNames.length === 0)
        return;
    warnOnce(`name-rule-fs-only\u0000${shellNames.join(',')}`, `extra-paths: name rule(s) ${shellNames.join(', ')} restrict the fs tools only; `
        + 'the shell surface does not enumerate bare names, so bash is NOT restricted by them — '
        + 'use a concrete path or a * pattern if the shell must be covered too', warn);
}
/**
 * Wrap one sandbox provider.
 * @param inner - the provider read from the context.
 * @param deps - configuration source and warning sink.
 * @returns a transparent proxy that widens profiles for configured roots and
 *   appends the shell-surface restrictions the runner can express.
 */
export function wrapSandbox(inner, deps) {
    const bound = new Map();
    const widen = (confined, wrappedLength, policy) => {
        // Observation happens for EVERY confinement, before any early return, so the
        // settings page's capability matrix reflects the real runner even when this
        // call grants nothing.
        recordShellDialect(confined.argv);
        // No runner layer exists under danger-full-access: the hard rules are the fs
        // half's job (deny/read-only still apply there), and there is no argv to edit.
        if (policy.mode === 'danger-full-access')
            return confined;
        // ONE resolution per confinement and NO directory walk: bare-name rules are
        // not expanded for the shell at all (see the module comment).
        const report = resolveRoots(deps.readConfig(), policy.workspaceRoot);
        warnNameRulesAreFsOnly(report, deps.warn);
        const rules = shellRulesOf(report, policy.mode);
        if (rules.grants.length === 0 && rules.readOnly.length === 0 && rules.denied.length === 0)
            return confined;
        const signature = signatureOf(rules);
        const widened = widenArgv(confined.argv, wrappedLength, rules);
        if (widened === undefined) {
            warnOnce(`unrecognised\u0000${confined.argv[0] ?? ''}\u0000${signature}`, unrecognisedWarning(confined.argv[0] ?? ''), deps.warn);
            return confined;
        }
        if (widened.unsupported !== undefined) {
            warnOnce(`${widened.unsupported}\u0000${signature}`, unsupportedWarning(widened.unsupported, rules), deps.warn);
        }
        // Identity is significant to the pinned sync-mirroring tests: an untouched
        // record must come back as the SAME object.
        if (widened.argv === confined.argv)
            return confined;
        return { ...confined, argv: widened.argv };
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