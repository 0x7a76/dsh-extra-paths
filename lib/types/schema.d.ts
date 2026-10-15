/**
 * The settings namespace schema. The resolved section is what the enforcement
 * layers read; `base` (the entry config) supplies deployment defaults beneath
 * the user layer.
 * @module dsh-extra-paths/schema
 */
import z from '@deepseek-ai/schemastery';
import type { Scope, Surface } from './config.js';
/** One configured path as stored in the settings document. */
export interface ExtraPathsSectionEntry {
    path: string;
    scope?: Scope;
    surfaces?: Surface[];
}
/** The `extra-paths` settings section as stored (the schema supplies the defaults). */
export interface ExtraPathsSection {
    defaultScope?: Scope;
    defaultSurfaces?: Surface[];
    paths?: (string | ExtraPathsSectionEntry)[];
}
/** The `extra-paths` namespace value. */
export declare const extraPathsSchema: z<ExtraPathsSection>;
/**
 * The same section for 0.2.x, where a plugin's settings ARE its exported
 * `Config` and the framework's settings form only describes `volatile()` fields:
 * a schema without one yields no descriptor at all, so all three fields are
 * volatile here. `volatile()` wraps a field in a value holder (`get()`), and the
 * host half re-reads those per enforcement decision — that is what makes an edit
 * in the settings form apply without a restart.
 *
 * Kept separate from {@link extraPathsSchema} because the 0.1.5 settings service
 * consumes plain values, not volatile wrappers.
 */
export declare const extraPathsConfigSchema: z<Schemastery.ObjectS<NoInfer<{
    defaultScope: z<Scope, Scope, "defined">;
    defaultSurfaces: z<Surface[], Surface[], "defined">;
    paths: z<(string | ExtraPathsSectionEntry)[], (string | ExtraPathsSectionEntry)[], "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    defaultScope: z<Scope, Scope, "defined">;
    defaultSurfaces: z<Surface[], Surface[], "defined">;
    paths: z<(string | ExtraPathsSectionEntry)[], (string | ExtraPathsSectionEntry)[], "defined">;
}>>, "plain">;
