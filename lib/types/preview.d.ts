/**
 * The settings page's effective-roots preview: one authenticated read-only
 * route that resolves the entries the page asks about for a workspace the page
 * supplies. It never probes arbitrary paths — every entry still goes through
 * `normalizeConfig` + `resolveRoots`, the same pair the enforcement layers use —
 * and it computes only path spellings, never file contents.
 * @module dsh-extra-paths/preview
 */
import { type ExtraPathsConfig, type RawConfig } from './config.js';
import { type EntryResolution } from './resolve.js';
/** The single route this plugin owns. */
export declare const PREVIEW_PATH = "/extra-paths/resolved";
/** The most entries one preview request may carry (a settings page sends its rows). */
export declare const MAX_PREVIEW_ENTRIES = 64;
/** The preview payload. */
export interface PreviewResponse {
    readonly workspaceCwd: string;
    /** The host's home directory, so the page can resolve `~` locally too. */
    readonly home: string;
    readonly entries: readonly EntryResolution[];
    readonly effective: readonly string[];
    readonly warnings: readonly string[];
}
/**
 * Parse the optional `paths` query parameter: the page's UNSAVED rows, so the
 * preview can answer for what the user is typing instead of only for what is
 * already stored.
 * @param raw - the raw query value (a JSON array of strings / entry objects).
 * @returns a raw configuration carrying those entries, or undefined when absent.
 * @throws {Error} when the payload is not a usable array (the caller answers 400).
 */
export declare function parseStagedPaths(raw: string | null | undefined): RawConfig | undefined;
/**
 * Resolve a configuration for one workspace.
 * @param config - the stored configuration snapshot.
 * @param workspaceRoot - the workspace the page is asking about.
 * @param staged - the page's unsaved rows, when it sent any: they REPLACE the
 * stored entries so the preview answers for the draft, not for the document.
 * @returns the preview payload.
 * @throws {Error} when no usable workspace was supplied or the staged rows are
 * invalid (the caller answers 400).
 */
export declare function buildPreview(config: ExtraPathsConfig, workspaceRoot: string | undefined, staged?: RawConfig | undefined): PreviewResponse;
/** The route-registration context surface (webServer + connection). */
export interface PreviewRouteContext {
    webServer: {
        register(route: {
            kind: 'exact';
            path: string;
            handler: (req: IncomingMessageLike, res: ServerResponseLike) => void | Promise<void>;
        }): () => void;
    };
    connection: {
        requestRejection(request: unknown): number | undefined;
    };
    effect(callback: () => () => void, label: string): unknown;
}
/** Minimal node:http shapes (the plugin imports no core type for them). */
export interface IncomingMessageLike {
    readonly method?: string;
    readonly url?: string;
}
export interface ServerResponseLike {
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(body?: string): unknown;
}
/**
 * Register the preview route on the calling fiber.
 * Optional capability: if the composition has no web carrier or no Connection
 * service, the caller never invokes this, and enforcement is unaffected.
 * @param ctx - a context that has both `webServer` and `connection`.
 * @param deps - configuration source and warning sink.
 */
export declare function registerPreviewRoute(ctx: PreviewRouteContext, deps: {
    readConfig(): ExtraPathsConfig;
    warn(message: string): void;
}): void;
