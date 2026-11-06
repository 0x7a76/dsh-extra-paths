/**
 * The tool-layer deny guard: the second, honest seam beside the fs proxy.
 *
 * Some host tools read files WITHOUT going through `ctx.fs`:
 * `grep`/`glob` spawn the host's bundled ripgrep, MCP/LSP children have their own
 * filesystem access, and a service that cached `ctx.fs` at load time keeps the
 * unwrapped instance. Those paths are documented boundaries (§11 of the 0.3.0
 * plan) — the plugin does not pretend to intercept them. What it CAN do is ask
 * the tool runtime to refuse a call whose own arguments name a denied path:
 * `ctx.tools.guard((exec) => reason | undefined)` runs synchronously before
 * dispatch and a returned string becomes `Error: <reason>` for the model. This
 * reliably catches `grep`/`glob` with an explicit `path`; a default workspace
 * scan can still surface a denied SUBdirectory (documented, not silently denied).
 *
 * The guard is deliberately conservative: it only refuses on a positive
 * containment match, and any failure to resolve a candidate means "no opinion"
 * (never throw from a guard — a bug in the plugin must not brick every tool).
 *
 * NAME RULES (`.git`, `.env`) apply here too: a tool call whose own argument
 * names a path containing a denied name component is refused exactly like a
 * literal denial. The lexical test is shared with the fs wrapper
 * ({@link matchNameRule}) so a tool guard and the fs proxy cannot disagree about
 * what a bare name covers; the walk the shell surface needs is never performed
 * here.
 * @module dsh-extra-paths/tool-guard
 */
import { matchDenied, toolAccessDenied } from './denial.js';
import { canonicalizeRoot, discoverPlatformFacts, expandConfiguredPath } from './paths.js';
import { nameScopeRoots, resolveRoots } from './resolve.js';
import { matchNameRule, nameRuleHitAsResolvedRule } from './wrap-fs.js';
/** Argument property names that carry a filesystem path. */
const PATH_KEYS = new Set([
    'path',
    'file_path',
    'filePath',
    'target',
    'targets',
    'paths',
    'directory',
    'dir',
    'cwd',
    'workdir',
    'files',
]);
/** How deep below the argument object a nested path key is still discovered. */
const MAX_ARGUMENT_DEPTH = 2;
/**
 * Collect the candidate path strings of one tool call.
 *
 * Strings and string arrays under one of {@link PATH_KEYS} are candidates; the
 * walk descends at most {@link MAX_ARGUMENT_DEPTH} levels so batch shapes such as
 * `files: [{ path }]` or `targets: [{ file_path }]` are covered without turning
 * into a full recursive scan of every tool's payload. Duplicates are removed so
 * one path named twice resolves once.
 * @param args - the raw `execution.arguments`.
 * @returns the deduplicated candidate spellings, in argument order.
 */
export function extractPathCandidates(args) {
    const found = [];
    const addStrings = (value) => {
        if (typeof value === 'string') {
            if (value.trim() !== '')
                found.push(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value)
                if (typeof item === 'string' && item.trim() !== '')
                    found.push(item);
        }
    };
    const visit = (value, depth) => {
        if (depth > MAX_ARGUMENT_DEPTH || value === null || typeof value !== 'object')
            return;
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item, depth + 1);
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            if (PATH_KEYS.has(key)) {
                if (typeof child === 'string' || Array.isArray(child)) {
                    addStrings(child);
                    // An array of objects under a path key (`files: [{ path }]`) is still
                    // walked one level down; a string array contributed everything already.
                    if (Array.isArray(child) && child.some(item => item !== null && typeof item === 'object')) {
                        visit(child, depth + 1);
                    }
                    continue;
                }
                visit(child, depth + 1);
                continue;
            }
            if (child !== null && typeof child === 'object')
                visit(child, depth + 1);
        }
    };
    visit(args, 0);
    return [...new Set(found)];
}
/**
 * The potential refusal reason for one tool execution.
 *
 * Pure and synchronous (the host's guard contract): resolve the calling
 * session's cwd, normalise every candidate path the way a configured entry is
 * normalised, and refuse when a `deny` rule covers it — literally or as a NAME
 * rule on one of the path's components (the candidate's fs-surface equivalent of
 * `repo/.git/config` under a `.git | deny` rule). `read` rules do NOT deny a tool
 * call — they only stop writes, which the fs proxy already enforces; a
 * parameter-level guard cannot tell whether a tool will read or write.
 * @param execution - the tool call about to be dispatched.
 * @param deps - live configuration source.
 * @returns the denial reason for the tool layer, or undefined for "no opinion".
 */
export function guardReason(execution, deps) {
    try {
        const candidates = extractPathCandidates(execution.arguments);
        if (candidates.length === 0)
            return undefined;
        const config = deps.readConfig();
        // Cheap gate: without a deny entry on the fs surface no candidate can match,
        // so no resolution (and no filesystem probing) is needed at all. A bare-name
        // deny entry is an entry like any other, so it opens the gate too.
        if (!config.paths.some(entry => entry.access === 'deny' && entry.surfaces.includes('fs')))
            return undefined;
        const facts = discoverPlatformFacts();
        // The tool runs in the calling session's workspace; a relative argument is
        // resolved against it rather than against the plugin process's own cwd. The
        // same workspace is the first name-rule scope root.
        const base = execution.agent?.session?.header?.cwd ?? process.cwd();
        const report = resolveRoots(config, base, facts);
        const denied = report.denied.filter(rule => rule.surfaces.includes('fs'));
        const nameDenied = report.nameRules.filter(rule => rule.access === 'deny' && rule.surfaces.includes('fs'));
        if (denied.length === 0 && nameDenied.length === 0)
            return undefined;
        // Lexical matching only: the guard must stay cheap (it runs before EVERY tool
        // dispatch), and the fs surface matches names without a walk for the same
        // reason. Scope roots are the workspace plus the configured writable roots.
        const scopeRoots = nameScopeRoots(report, base, facts);
        const toolName = execution.name ?? 'unknown';
        for (const candidate of candidates) {
            const expanded = expandConfiguredPath(candidate, base, facts);
            // A spelling this host cannot express names nothing here.
            if (!expanded.ok)
                continue;
            const targetKey = canonicalizeRoot(expanded.path, facts);
            const rule = matchDenied(denied, 'fs', targetKey, facts);
            if (rule !== undefined)
                return toolAccessDenied(toolName, candidate, rule);
            const nameHit = matchNameRule(nameDenied, 'fs', targetKey, scopeRoots, facts);
            if (nameHit !== undefined)
                return toolAccessDenied(toolName, candidate, nameRuleHitAsResolvedRule(nameHit));
        }
        return undefined;
    }
    catch {
        // A guard must never break a tool call: losing the path argument means the
        // guard has no opinion, and the fs proxy still protects the writes/reads it
        // can see.
        return undefined;
    }
}
/**
 * Register the deny guard on the tools service, feature-detected.
 *
 * Registration goes through `ctx.inject(['tools'], …)` because the tool runtime
 * may not be composed yet when the plugin applies — and because an older host
 * generation may not have `guard` at all, in which case the plugin silently
 * keeps the fs-only enforcement instead of failing to load.
 * @param ctx - the plugin/entry context.
 * @param deps - live configuration source.
 * @returns the disposer that unregisters the guard (no-op when nothing was
 *   registered).
 */
export function installToolGuard(ctx, deps) {
    let dispose;
    let disposed = false;
    const register = (scope) => {
        if (disposed || dispose !== undefined)
            return;
        const tools = scope?.tools ?? ctx.tools;
        if (typeof tools?.guard !== 'function')
            return;
        try {
            const registration = tools.guard((execution) => guardReason(execution, deps));
            if (typeof registration === 'function')
                dispose = registration;
        }
        catch (error) {
            deps.warn(`extra-paths: the tool-level deny guard could not be registered (${String(error)}); `
                + 'denied paths are still enforced on the fs tools');
        }
    };
    if (typeof ctx.inject === 'function') {
        try {
            ctx.inject(['tools'], register);
        }
        catch (error) {
            deps.warn(`extra-paths: the tools service could not be injected (${String(error)}); `
                + 'denied paths are still enforced on the fs tools');
        }
    }
    else {
        register(ctx);
    }
    return () => {
        disposed = true;
        const run = dispose;
        dispose = undefined;
        if (typeof run === 'function')
            run();
    };
}
//# sourceMappingURL=tool-guard.js.map