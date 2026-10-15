/**
 * The plugin's configuration vocabulary: a plugin-level default scope and
 * surface set, plus per-path entries that override them. Everything here is
 * pure so the settings schema, the CLI-facing validator, and the enforcement
 * layers share one normalisation.
 * @module dsh-extra-paths/config
 */
/** How far one configured root's write grant reaches across session modes. */
export type Scope = 'write' | 'always-write';
/** Which enforcement surface a configured root's grant applies to. */
export type Surface = 'fs' | 'shell';
/** All scopes, in escalation order. */
export declare const SCOPES: readonly Scope[];
/** All surfaces. `fs` is the write/edit tool family; `shell` is the subprocess sandbox. */
export declare const SURFACES: readonly Surface[];
/** One configured root after normalisation. */
export interface PathEntry {
    readonly path: string;
    readonly scope: Scope;
    readonly surfaces: readonly Surface[];
}
/** The normalised configuration the enforcement layers read. */
export interface ExtraPathsConfig {
    readonly defaultScope: Scope;
    readonly defaultSurfaces: readonly Surface[];
    readonly paths: readonly PathEntry[];
}
/** Untrusted configuration as it arrives from the settings document or entry config. */
export interface RawConfig {
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
 * Whether a path names a filesystem root, which would disable the sandbox
 * outright. A bare drive (`C:`) is drive-RELATIVE rather than a root, but it is
 * rejected conservatively: on Windows it can still resolve to a whole volume,
 * and the message says so instead of mislabelling it.
 */
export declare function isFilesystemRoot(path: string): boolean;
/**
 * The settings service's `validate` hook: refuse a write the plugin could never
 * act on, so the user learns at save time instead of storing a dead section.
 * @param raw - the resolved section the write would store.
 * @throws {Error} on a duplicate literal entry or a filesystem root.
 */
export declare function validateConfig(raw: RawConfig | undefined): void;
