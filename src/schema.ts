/**
 * The settings namespace schema. The resolved section is what the enforcement
 * layers read; `base` (the entry config) supplies deployment defaults beneath
 * the user layer.
 * @module dsh-extra-paths/schema
 */

import z from '@deepseek-ai/schemastery'
import type { Scope, Surface } from './config.js'

/** One configured path as stored in the settings document. */
export interface ExtraPathsSectionEntry {
  path: string
  scope?: Scope
  surfaces?: Surface[]
}

/** The `extra-paths` settings section as stored (the schema supplies the defaults). */
export interface ExtraPathsSection {
  defaultScope?: Scope
  defaultSurfaces?: Surface[]
  paths?: (string | ExtraPathsSectionEntry)[]
}

// Every schema is annotated: a bare `z.object({...})` inside a heterogeneous
// union both fails to infer and (per TS2742) leaks a non-portable type name.
const scopeSchema: z<Scope> = z.union(['write', 'always-write'] as const)
const surfaceSchema: z<Surface> = z.union(['fs', 'shell'] as const)
const entrySchema: z<ExtraPathsSectionEntry> = z.object({
  path: z.string().required(),
  scope: scopeSchema,
  surfaces: z.array(surfaceSchema),
})

/**
 * Mark a field volatile when the RUNNING schemastery supports it.
 *
 * `volatile()` arrived in schemastery 3.18.4 (0.2.x ships ~3.18.4, 0.1.5 ships
 * 3.18.2), and calling it on an older instance would throw while this module is
 * being evaluated — a hard boot failure. Feature-detecting keeps the export safe
 * everywhere; on a host without it the field is simply not volatile, which costs
 * the generated settings form and nothing else.
 * @param schema - the field schema.
 * @returns the same schema, volatile when the runtime offers it.
 */
function asVolatile<S>(schema: S): S {
  const candidate = schema as { volatile?: () => unknown }
  return typeof candidate.volatile === 'function' ? (candidate.volatile.call(schema) as S) : schema
}

/** The `extra-paths` namespace value. */
export const extraPathsSchema: z<ExtraPathsSection> = z.object({
  defaultScope: scopeSchema.default('write'),
  defaultSurfaces: z.array(surfaceSchema).default(['fs', 'shell']),
  paths: z.array(z.union([z.string(), entrySchema])).default([]),
})

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
export const extraPathsConfigSchema = z.object({
  defaultScope: asVolatile(scopeSchema.default('write')),
  defaultSurfaces: asVolatile(z.array(surfaceSchema).default(['fs', 'shell'])),
  paths: asVolatile(z.array(z.union([z.string(), entrySchema])).default([])),
})
