/**
 * The settings page's effective-rules preview: one authenticated read-only route
 * that resolves the entries the page asks about for a workspace the page
 * supplies. It never probes arbitrary paths — every entry still goes through
 * `normalizeConfig` + `resolveRoots`, the same pair the enforcement layers use —
 * and it computes only path spellings, never file contents.
 *
 * The payload also carries the HOST's platform facts and shell capability: the
 * browser cannot know either (under WSL it runs as Windows Chrome while the host
 * is Linux, and a remote client is a different machine entirely), so the page
 * only ever displays the host's answers.
 * @module dsh-extra-paths/preview
 */
import { normalizeConfig } from './config.js';
import { isAbsoluteSpelling } from './platform.js';
import { canonicalizeRoot, discoverPlatformFacts, expandConfiguredPath, hostPathDialect } from './paths.js';
import { resolveRoots } from './resolve.js';
import { shellCapabilityOf } from './shell-dialect.js';
/** The single route this plugin owns. */
export const PREVIEW_PATH = '/extra-paths/resolved';
/** The most entries one preview request may carry (a settings page sends its rows). */
export const MAX_PREVIEW_ENTRIES = 64;
/**
 * Parse the optional `paths` query parameter: the page's UNSAVED rows, so the
 * preview can answer for what the user is typing instead of only for what is
 * already stored.
 * @param raw - the raw query value (a JSON array of strings / entry objects).
 * @returns a raw configuration carrying those entries, or undefined when absent.
 * @throws {Error} when the payload is not a usable array (the caller answers 400).
 */
export function parseStagedPaths(raw) {
    if (raw === null || raw === undefined || raw === '')
        return undefined;
    if (raw.length > 8192)
        throw new Error('paths is too long');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error('paths must be JSON');
    }
    if (!Array.isArray(parsed))
        throw new Error('paths must be a JSON array');
    if (parsed.length > MAX_PREVIEW_ENTRIES)
        throw new Error(`paths must hold at most ${MAX_PREVIEW_ENTRIES} entries`);
    return { paths: parsed };
}
/**
 * Normalise the workspace base the page sent.
 *
 * `~` is expanded here — the page cannot know the home directory before its
 * first answer — and a spelling that is not absolute in the HOST's dialect is
 * refused outright. That refusal is the fix for a real defect:
 * `resolvePath('~/projects', '..')` used to be evaluated server-side, so a `~`
 * base produced `…/<server cwd>/~/` in the preview while looking like an
 * ordinary path. The host's dialect (not the browser's) decides what "absolute"
 * means, so a `C:\…` workspace is accepted on Windows and a POSIX one inside WSL.
 * @param workspaceRoot - the raw query value.
 * @param facts - the host facts, which also supply the home directory.
 * @returns the canonical absolute base.
 * @throws {Error} when the base is missing, relative, foreign, or a `~user` spelling.
 */
function workspaceBaseOf(workspaceRoot, facts) {
    if (workspaceRoot === undefined || workspaceRoot.trim() === '')
        throw new Error('cwd is required');
    const trimmed = workspaceRoot.trim();
    const expanded = isAbsoluteSpelling(trimmed) ? expandConfiguredPath(trimmed, facts.home, facts) : undefined;
    if (expanded === undefined || !expanded.ok) {
        throw new Error(`cwd must be an absolute path or start with ~, received ${JSON.stringify(workspaceRoot)}`);
    }
    return canonicalizeRoot(expanded.path, facts);
}
/**
 * Resolve a configuration for one workspace.
 * @param config - the stored configuration snapshot.
 * @param workspaceRoot - the workspace the page is asking about.
 * @param staged - the page's unsaved rows, when it sent any: they REPLACE the
 * stored entries so the preview answers for the draft, not for the document.
 * @param options - optional host inputs (tests); defaults to the live host.
 * @returns the preview payload.
 * @throws {Error} when no usable workspace was supplied or the staged rows are
 * invalid (the caller answers 400).
 */
export function buildPreview(config, workspaceRoot, staged, options) {
    const facts = options?.facts ?? discoverPlatformFacts();
    const base = workspaceBaseOf(workspaceRoot, facts);
    // `normalizeConfig` is the same gate the settings service and the enforcement
    // layers use, so an invalid draft fails here with the user's own message.
    const effectiveConfig = staged === undefined ? config : normalizeConfig(staged);
    // Name rules are FS-ONLY, so they are deliberately absent from the
    // effective-roots arrays (those describe the shell-expressible roots, which is
    // what they always meant). They are still enumerated here — one bounded walk
    // per rule, cached for NAME_RULE_LIMITS.cacheMs — only so a row can show "N
    // matches right now"; the walk never runs on the enforcement path.
    const report = resolveRoots(effectiveConfig, base, facts, { expandNameRules: true });
    const writable = report.roots.map(root => root.root);
    const readOnly = report.readOnly.map(rule => rule.root);
    const denied = report.denied.map(rule => rule.root);
    return {
        workspaceCwd: base,
        home: facts.home,
        platform: {
            platform: facts.platform,
            wsl: facts.wsl,
            wslMountRoot: facts.wslMountRoot,
            dialect: hostPathDialect(facts),
        },
        capabilities: options?.capability ?? shellCapabilityOf(facts.platform),
        entries: report.entries,
        effective: writable,
        writable,
        readOnly,
        denied,
        warnings: report.warnings,
    };
}
/**
 * Register the preview route on the calling fiber.
 * Optional capability: if the composition has no web carrier or no Connection
 * service, the caller never invokes this, and enforcement is unaffected.
 * @param ctx - a context that has both `webServer` and `connection`.
 * @param deps - configuration source and warning sink.
 */
export function registerPreviewRoute(ctx, deps) {
    const handler = async (req, res) => {
        const rejection = ctx.connection.requestRejection(req);
        if (rejection !== undefined) {
            res.writeHead(rejection);
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
            return;
        }
        if ((req.method ?? 'GET') !== 'GET') {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('method not allowed');
            return;
        }
        try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const staged = parseStagedPaths(url.searchParams.get('paths'));
            const body = JSON.stringify(buildPreview(deps.readConfig(), url.searchParams.get('cwd') ?? undefined, staged));
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(body);
        }
        catch (error) {
            deps.warn(`extra-paths: preview route failed: ${String(error)}`);
            res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
            res.end(String(error.message ?? error));
        }
    };
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PREVIEW_PATH, handler }), 'extra-paths: preview route');
}
//# sourceMappingURL=preview.js.map