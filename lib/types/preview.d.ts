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
import { type ExtraPathsConfig, type RawConfig } from './config.js';
import { type PathDialect, type PlatformFacts } from './platform.js';
import { type EntryResolution } from './resolve.js';
import { type ShellCapability } from './shell-dialect.js';
/** The single route this plugin owns. */
export declare const PREVIEW_PATH = "/extra-paths/resolved";
/** The most entries one preview request may carry (a settings page sends its rows). */
export declare const MAX_PREVIEW_ENTRIES = 64;
/** The host's path dialect as the page needs it (facts it must not infer itself). */
export interface PreviewPlatform {
    /** `process.platform` of the host half. */
    readonly platform: string;
    /** True when the host runs inside WSL. */
    readonly wsl: boolean;
    /** Where Windows drives are mounted inside WSL (`/mnt` unless remapped). */
    readonly wslMountRoot: string;
    /** The host's native path dialect. */
    readonly dialect: PathDialect;
}
/** The preview payload. */
export interface PreviewResponse {
    readonly workspaceCwd: string;
    /** The host's home directory, so the page can resolve `~` locally too. */
    readonly home: string;
    readonly platform: PreviewPlatform;
    /** What the shell surface can enforce on this host. */
    readonly capabilities: ShellCapability;
    readonly entries: readonly EntryResolution[];
    /** Writable roots (the original name of {@link writable}). */
    readonly effective: readonly string[];
    /** The same writable roots under the 0.3.0 name. */
    readonly writable: readonly string[];
    /** Roots that are readable but NOT writable. */
    readonly readOnly: readonly string[];
    /** Roots that are neither readable nor writable. */
    readonly denied: readonly string[];
    readonly warnings: readonly string[];
}
/** Optional host inputs, injected by tests (the route uses the discovered ones). */
export interface PreviewOptions {
    /** Host facts; defaults to {@link discoverPlatformFacts}. */
    readonly facts?: PlatformFacts;
    /** Shell capability override; defaults to {@link shellCapabilityOf}(platform). */
    readonly capability?: ShellCapability;
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
 * @param options - optional host inputs (tests); defaults to the live host.
 * @returns the preview payload.
 * @throws {Error} when no usable workspace was supplied or the staged rows are
 * invalid (the caller answers 400).
 */
export declare function buildPreview(config: ExtraPathsConfig, workspaceRoot: string | undefined, staged?: RawConfig | undefined, options?: PreviewOptions): PreviewResponse;
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
