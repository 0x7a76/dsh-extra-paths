import { defineConfig } from 'tsdown'

/**
 * The client artifact contract: a CJS closure-factory bundle that registers into
 * the page's module table. The banner/footer/intro are copied verbatim from the
 * framework preset (packages/client/tsdown.client.ts) because a third-party
 * package cannot import that workspace-internal module.
 *
 * Externals: react/react-dom/react-jsx-runtime and @deepseek-ai/dsh-client-ui-slots
 * are in the page's baseline module table (packages/client/web/src/platform.ts);
 * @deepseek-ai/dsh-client-ui-settings is NOT, so it is requested through
 * dsh.client.external in package.json.
 *
 * No CSS pipeline: the page carries inline styles (src/client/styles.ts), so
 * this config needs none of the framework preset's CSS virtual modules.
 */
export default defineConfig({
  name: 'dsh-extra-paths/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: false,
  clean: false,
  // `deps.neverBundle` did NOT externalise React here (the bundle inlined a
  // second React copy, which would break hooks and context inside the shell's
  // tree). Rolldown's top-level `external` states the same intent directly and
  // is what the artifact check in the plan verifies.
  external: [
    /^react$/,
    /^react\//,
    /^react-dom$/,
    /^react-dom\//,
    /^@deepseek-ai\//,
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-extra-paths", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
