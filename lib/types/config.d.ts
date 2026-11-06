/**
 * The plugin's configuration vocabulary: a plugin-level default access level and
 * surface set, plus per-path entries that override them. Everything here is
 * pure so the settings schema, the CLI-facing validator, and the enforcement
 * layers share one normalisation.
 *
 * 0.3.0 widened the old `scope` (`write` | `always-write`) into a full access
 * level: `deny` (no read, no write), `read` (read-only, even inside the
 * workspace), `write` (writable while the session policy is workspace-write)
 * and `always-write` (writable under read-only too). The legacy `scope` field
 * and `defaultScope` are still accepted and map onto the new vocabulary, so an
 * existing settings document keeps working unchanged.
 * @module dsh-extra-paths/config
 */
/** How far one configured path's grant/restriction reaches. */
export type Access = 'deny' | 'read' | 'write' | 'always-write';
/** The legacy write-only vocabulary, still accepted from older documents. */
export type Scope = 'write' | 'always-write';
/** Which enforcement surface a configured path applies to. */
export type Surface = 'fs' | 'shell';
/** All access levels, from most restrictive to most permissive. */
export declare const ACCESSES: readonly Access[];
/** All surfaces. `fs` is the write/edit tool family; `shell` is the subprocess sandbox. */
export declare const SURFACES: readonly Surface[];
/** One configured path after normalisation. */
export interface PathEntry {
    readonly path: string;
    readonly access: Access;
    readonly surfaces: readonly Surface[];
}
/** The normalised configuration the enforcement layers read. */
export interface ExtraPathsConfig {
    readonly defaultAccess: Access;
    readonly defaultSurfaces: readonly Surface[];
    readonly paths: readonly PathEntry[];
}
/** Untrusted configuration as it arrives from the settings document or entry config. */
export interface RawConfig {
    readonly defaultAccess?: unknown;
    /** Legacy alias for `defaultAccess`; `always-write` / `write`. */
    readonly defaultScope?: unknown;
    readonly defaultSurfaces?: unknown;
    readonly paths?: unknown;
}
/**
 * Normalise untrusted configuration, applying defaults and rejecting anything
 * the enforcement layers could not act on.
 * @param raw - the settings section or entry config.
 * @returns the normalised configuration.
 * @throws {Error} on a malformed entry, unknown vocabulary, or empty surfaces.
 */
export declare function normalizeConfig(raw: RawConfig | undefined): ExtraPathsConfig;
/**
 * Whether a spelling names a filesystem root (or a bare drive), which would
 * disable the sandbox outright. A bare drive (`C:`) is drive-RELATIVE rather
 * than a root, but it is rejected conservatively: on Windows it can still
 * resolve to a whole volume, and the message says so instead of mislabelling it.
 * @param path - a path spelling.
 * @returns true for `/`, `C:`, `C:\`, `C:/` and a UNC share root.
 */
export declare function isFilesystemRoot(path: string): boolean;
/**
 * The settings service's `validate` hook: refuse a write the plugin could never
 * act on, so the user learns at save time instead of storing a dead section.
 * A `foreign` entry (a Windows path on a POSIX host) is NOT an error: one shared
 * configuration must remain savable on every platform and simply stays inactive.
 * @param raw - the resolved section the write would store.
 * @throws {Error} on a duplicate literal entry, an ambiguous drive-relative
 *   spelling, a volume root, or an unsafe pattern.
 */
export declare function validateConfig(raw: RawConfig | undefined): void;
