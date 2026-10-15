/**
 * dsh-extra-paths: configured extra writable roots for the sandboxed fs tools
 * and the sandboxed shell, plus the settings surface and its preview route.
 *
 * Host half only. No `@deepseek-ai/*` VALUE import except the schema builder:
 * every failure below degrades to "no grant + warning", never to a failed boot.
 *
 * Two host generations are supported from one body, because the settings seam
 * changed shape in 0.2.0 and the plugin must not throw on either:
 * - 0.1.5: `ctx.settings.register(ns, schema, { base, applies, validate })`
 *   returns a scope whose `get()`/`watch()` drive `current`.
 * - 0.2.x: that API is GONE. A namespace IS the plugin's loader entry, its
 *   schema is this module's exported {@link Config}, and live values are the
 *   `volatile()` fields of the config the loader hands to {@link apply} — which
 *   are re-read on every enforcement decision, so an edit in the framework's
 *   settings form applies without a restart.
 * @module dsh-extra-paths
 */
import { type ExtraPathsConfig, type RawConfig } from './config.js';
import { installListener } from './listener.js';
/** The settings namespace the client page binds to. */
export declare const SETTINGS_NAMESPACE = "extra-paths";
/**
 * The plugin's configuration schema as the 0.2.x loader expects to find it: a
 * module-level `Config` export, read through `entry.fiber.runtime.Config`. Fields
 * are `volatile()` because a settings form only describes volatile fields.
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    defaultScope: import("@deepseek-ai/schemastery").default<import("./config.js").Scope, import("./config.js").Scope, "defined">;
    defaultSurfaces: import("@deepseek-ai/schemastery").default<import("./config.js").Surface[], import("./config.js").Surface[], "defined">;
    paths: import("@deepseek-ai/schemastery").default<(string | import("./schema.js").ExtraPathsSectionEntry)[], (string | import("./schema.js").ExtraPathsSectionEntry)[], "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    defaultScope: import("@deepseek-ai/schemastery").default<import("./config.js").Scope, import("./config.js").Scope, "defined">;
    defaultSurfaces: import("@deepseek-ai/schemastery").default<import("./config.js").Surface[], import("./config.js").Surface[], "defined">;
    paths: import("@deepseek-ai/schemastery").default<(string | import("./schema.js").ExtraPathsSectionEntry)[], (string | import("./schema.js").ExtraPathsSectionEntry)[], "defined">;
}>>, "plain">;
/**
 * Normalise the entry config, degrading to the documented empty configuration
 * on any problem. This is the plugin's only untrusted-input boundary that runs
 * before the settings service can validate anything, so it must not throw.
 * @param raw - the entry config as loaded from the composition.
 * @param warn - warning sink.
 * @returns a normalised configuration safe to read on every enforcement decision.
 */
export declare function safeEntryConfig(raw: RawConfig | undefined, warn: (message: string) => void): ExtraPathsConfig;
/**
 * Read the 0.2.x live config: every `volatile()` field is a wrapper with `get()`,
 * so this returns the CURRENT value rather than the value captured at load. A
 * plain object (0.1.5, or a hand-written patch without volatile fields) is
 * returned as-is so both generations share one reader.
 * @param config - the config the loader passed to {@link apply}.
 * @returns a raw section, or undefined when nothing usable is present.
 */
export declare function readLiveConfig(config: unknown): RawConfig | undefined;
/** Minimal plugin context surface (the loader passes the real cordis context). */
interface PluginContext {
    logger: {
        info(message: string): void;
        warn(message: string): void;
    };
    on: Parameters<typeof installListener>[0]['on'];
    inject(names: readonly string[], callback: (scope: never) => void): unknown;
    effect?(callback: () => unknown, label?: string): unknown;
    sandboxPolicy: unknown;
}
/**
 * Plugin body.
 * @param ctx - the entry context.
 * @param config - the entry config: the settings `base` layer on 0.1.5, and the
 * live (volatile) settings themselves on 0.2.x.
 */
export declare function apply(ctx: PluginContext, config?: RawConfig): void;
/** Property carrier so the loader waits for the policy service. */
declare const plugin: typeof apply & {
    inject: readonly ["sandboxPolicy"];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        defaultScope: import("@deepseek-ai/schemastery").default<import("./config.js").Scope, import("./config.js").Scope, "defined">;
        defaultSurfaces: import("@deepseek-ai/schemastery").default<import("./config.js").Surface[], import("./config.js").Surface[], "defined">;
        paths: import("@deepseek-ai/schemastery").default<(string | import("./schema.js").ExtraPathsSectionEntry)[], (string | import("./schema.js").ExtraPathsSectionEntry)[], "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        defaultScope: import("@deepseek-ai/schemastery").default<import("./config.js").Scope, import("./config.js").Scope, "defined">;
        defaultSurfaces: import("@deepseek-ai/schemastery").default<import("./config.js").Surface[], import("./config.js").Surface[], "defined">;
        paths: import("@deepseek-ai/schemastery").default<(string | import("./schema.js").ExtraPathsSectionEntry)[], (string | import("./schema.js").ExtraPathsSectionEntry)[], "defined">;
    }>>, "plain">;
};
export default plugin;
