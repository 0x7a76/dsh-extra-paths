/**
 * The settings namespace schema. The resolved section is what the enforcement
 * layers read; `base` (the entry config) supplies deployment defaults beneath
 * the user layer.
 *
 * 0.3.0 adds `defaultAccess` and a per-entry `access` while KEEPING the legacy
 * `defaultScope` / `scope` spellings, so an older settings document keeps
 * working. Neither access alias carries a schema default: the 0.2.x framework
 * MATERIALISES schema defaults before the plugin sees the section, so a
 * `defaultAccess` default of `write` would appear alongside a legacy
 * `defaultScope: always-write` and `normalizeConfig`'s ambiguity guard would
 * reject the whole configuration. `normalizeConfig` supplies the documented
 * `write` default itself, which is unambiguous.
 * @module dsh-extra-paths/schema
 */
import z from '@deepseek-ai/schemastery';
import type { Access, Scope, Surface } from './config.js';
/** One configured path as stored in the settings document. */
export interface ExtraPathsSectionEntry {
    path: string;
    /** New spelling; conflicts with `scope` when both are present and differ. */
    access?: Access;
    /** Legacy alias for `access`; still accepted from 0.2.x documents. */
    scope?: Scope;
    surfaces?: Surface[];
}
/** The `extra-paths` settings section as stored (the schema supplies defaults). */
export interface ExtraPathsSection {
    defaultAccess?: Access;
    /** Legacy alias for `defaultAccess`; still accepted from 0.2.x documents. */
    defaultScope?: Scope;
    defaultSurfaces?: Surface[];
    paths?: (string | ExtraPathsSectionEntry)[];
}
/** The `extra-paths` namespace value. */
export declare const extraPathsSchema: z<ExtraPathsSection>;
/**
 * The same section for 0.2.x, where a plugin's settings ARE its exported
 * `Config` and the framework's settings form only describes `volatile()` fields:
 * a schema without one yields no descriptor at all, so every field is volatile
 * here. `volatile()` wraps a field in a value holder (`get()`), and the host half
 * re-reads those per enforcement decision — that is what makes an edit in the
 * settings form apply without a restart.
 *
 * Kept separate from {@link extraPathsSchema} because the 0.1.5 settings service
 * consumes plain values, not volatile wrappers.
 */
export declare const extraPathsConfigSchema: z<Schemastery.ObjectS<NoInfer<{
    defaultAccess: z<Access>;
    defaultScope: z<Scope>;
    defaultSurfaces: z<Surface[], Surface[], "defined">;
    paths: z<(string | ExtraPathsSectionEntry)[], (string | ExtraPathsSectionEntry)[], "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    defaultAccess: z<Access>;
    defaultScope: z<Scope>;
    defaultSurfaces: z<Surface[], Surface[], "defined">;
    paths: z<(string | ExtraPathsSectionEntry)[], (string | ExtraPathsSectionEntry)[], "defined">;
}>>, "plain">;
