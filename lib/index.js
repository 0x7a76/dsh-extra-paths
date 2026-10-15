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
import { normalizeConfig, validateConfig } from './config.js';
import { renderExtraPathsContext } from './context.js';
import { installListener, fallbackPolicyOf } from './listener.js';
import { registerPreviewRoute } from './preview.js';
import { extraPathsSchema, extraPathsConfigSchema } from './schema.js';
/** The settings namespace the client page binds to. */
export const SETTINGS_NAMESPACE = 'extra-paths';
/**
 * The plugin's configuration schema as the 0.2.x loader expects to find it: a
 * module-level `Config` export, read through `entry.fiber.runtime.Config`. Fields
 * are `volatile()` because a settings form only describes volatile fields.
 */
export const Config = extraPathsConfigSchema;
/** Config keys this plugin owns, in schema order. */
const CONFIG_KEYS = ['defaultScope', 'defaultSurfaces', 'paths'];
/**
 * Normalise the entry config, degrading to the documented empty configuration
 * on any problem. This is the plugin's only untrusted-input boundary that runs
 * before the settings service can validate anything, so it must not throw.
 * @param raw - the entry config as loaded from the composition.
 * @param warn - warning sink.
 * @returns a normalised configuration safe to read on every enforcement decision.
 */
export function safeEntryConfig(raw, warn) {
    try {
        return normalizeConfig(raw);
    }
    catch (error) {
        warn(`extra-paths: entry config rejected (${String(error)}); continuing with the empty configuration`);
        return normalizeConfig(undefined);
    }
}
/**
 * Read the 0.2.x live config: every `volatile()` field is a wrapper with `get()`,
 * so this returns the CURRENT value rather than the value captured at load. A
 * plain object (0.1.5, or a hand-written patch without volatile fields) is
 * returned as-is so both generations share one reader.
 * @param config - the config the loader passed to {@link apply}.
 * @returns a raw section, or undefined when nothing usable is present.
 */
export function readLiveConfig(config) {
    if (config === null || typeof config !== 'object')
        return undefined;
    const source = config;
    const out = {};
    let found = false;
    for (const key of CONFIG_KEYS) {
        const field = source[key];
        if (field === undefined)
            continue;
        const getter = field.get;
        // `volatile()` (and `defined()`) fields expose get(); plain values do not.
        out[key] = typeof getter === 'function' ? getter.call(field) : field;
        found = true;
    }
    return found ? out : undefined;
}
/**
 * Plugin body.
 * @param ctx - the entry context.
 * @param config - the entry config: the settings `base` layer on 0.1.5, and the
 * live (volatile) settings themselves on 0.2.x.
 */
export function apply(ctx, config) {
    const warn = (message) => { ctx.logger.warn(message); };
    // The entry config is UNTRUSTED (a typo in cordis.patch.yml must never stop
    // the boot): sanitise once and use the sanitised value for both the live
    // snapshot and the settings `base` layer.
    const entryConfig = safeEntryConfig(config, warn);
    let current = entryConfig;
    // A rejected volatile config would otherwise warn on every single call.
    let lastRejection = '';
    // Which source owns the configuration is decided ONCE, from the shape of the
    // config the loader handed us: `volatile()` holders only exist on 0.2.x, where
    // they ARE the settings. On 0.1.5 the config is a plain object that is merely
    // the settings' `base` layer, so letting it win would silently override every
    // edit made in the settings form.
    const volatile = (() => {
        const source = config;
        return CONFIG_KEYS.some((key) => {
            const field = source?.[key];
            return field !== null && typeof field === 'object' && typeof field.get === 'function';
        });
    })();
    /**
     * The configuration in force right now.
     *
     * On 0.2.x the volatile fields are the live settings, so they are read per
     * decision — that is what makes an edit in the framework's settings form take
     * effect without a restart. On 0.1.5 the settings scope (below) keeps `current`
     * up to date instead.
     */
    const readConfig = () => {
        if (!volatile)
            return current;
        const live = readLiveConfig(config);
        if (live === undefined)
            return current;
        try {
            return normalizeConfig(live);
        }
        catch (error) {
            const message = String(error);
            if (message !== lastRejection) {
                lastRejection = message;
                warn(`extra-paths: settings value rejected (${message}); continuing with the empty configuration`);
            }
            return normalizeConfig(undefined);
        }
    };
    const listener = installListener(ctx, { readConfig, fallbackPolicy: fallbackPolicyOf, warn });
    ctx.inject(['settings'], (scope) => {
        const settings = scope.settings;
        // 0.2.x: no registration API at all. The namespace is this entry, its schema
        // is the exported `Config`, and `readConfig` above already reads the live
        // volatile fields, so there is nothing to wire here.
        if (typeof settings.register !== 'function')
            return;
        const registered = settings.register(SETTINGS_NAMESPACE, extraPathsSchema, {
            base: entryConfig,
            applies: 'live',
            validate: (value) => { validateConfig(value); },
        });
        current = normalizeConfig(registered.get());
        registered.watch((value) => { current = normalizeConfig(value); });
    });
    ctx.inject(['systemPrompt'], (scope) => {
        const systemPrompt = scope.systemPrompt;
        systemPrompt.context({
            name: 'extra-paths:writable',
            order: systemPrompt.getContextOrder('SANDBOX_POLICY') + 2,
            text: context => renderExtraPathsContext(readConfig, context.agent?.session?.header?.cwd),
        });
    });
    ctx.inject(['webServer', 'connection'], (scope) => {
        registerPreviewRoute(scope, { readConfig, warn });
    });
    // Load-time self-test: this read MUST travel through internal/get. Zero
    // observed reads means the interception seam is gone in this DSH version —
    // and a service that is never wrapped looks exactly like "writes are denied",
    // so both counters are asserted, not just the read counter.
    void ctx.sandboxPolicy;
    if (listener.reads === 0) {
        warn('extra-paths: internal/get interception is unavailable on this DSH version — '
            + 'configured extra paths will NOT be granted. The plugin stays inert and boot is unaffected.');
    }
    // NOTE: `fsWraps`/`sandboxWraps` are deliberately NOT asserted here. At apply
    // time no consumer has read `ctx.fs`/`ctx.sandbox` yet, so both are always 0 —
    // a check on them here fires on every boot while the feature works fine. They
    // stay on ListenerState as after-the-fact observability only.
}
/** Property carrier so the loader waits for the policy service. */
const plugin = Object.assign(apply, { inject: ['sandboxPolicy'], Config });
export default plugin;
//# sourceMappingURL=index.js.map