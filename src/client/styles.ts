/**
 * Inline style constants. The framework's own client preset compiles CSS
 * modules through workspace-internal tsdown plugins that a third-party package
 * cannot import, so this page carries its styles as plain objects instead.
 * @module dsh-extra-paths/client/styles
 */

import type * as React from 'react'

// The shell sets no global `box-sizing`, so every element here declares it:
// without it a `width: 100%` field is content-box and its padding + border push
// it past the card's right edge (the reported overflow).
const box: React.CSSProperties = { boxSizing: 'border-box' }

const card: React.CSSProperties = {
  ...box,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.25))',
  borderRadius: 8,
}

const button: React.CSSProperties = {
  ...box,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.35))',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
}

/** The page's style map. */
export const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', maxWidth: 760 },
  intro: { fontSize: 12, lineHeight: 1.6, opacity: 0.75 },
  baseRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  baseField: { width: 380 },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  card,
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardHeadRight: { display: 'flex', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 12, fontWeight: 600, opacity: 0.75 },
  pathInput: {
    ...box,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.35))',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'var(--dsh-font-mono, monospace)',
    fontSize: 13,
  },
  resolvedRow: { display: 'flex', gap: 6, alignItems: 'baseline', minHeight: 18, fontSize: 12, flexWrap: 'wrap' },
  code: { fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12, wordBreak: 'break-all' },
  dim: { opacity: 0.6, fontSize: 12, lineHeight: 1.5 },
  controlsRow: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: 0.85 },
  select: { padding: '3px 6px', borderRadius: 6, background: 'transparent', color: 'inherit', fontSize: 12 },
  pills: { display: 'flex', gap: 6, alignItems: 'center' },
  pillOn: { ...button, borderColor: 'var(--dsh-color-accent, #2f6fd0)', background: 'var(--dsh-color-accent-soft, rgba(47,111,208,0.15))' },
  pillOff: { ...button, opacity: 0.55 },
  button,
  primary: { ...button, borderColor: 'var(--dsh-color-accent, #2f6fd0)', fontWeight: 600 },
  linkButton: { ...button, border: 'none', opacity: 0.7, padding: '2px 4px' },
  panel: {
    ...box,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 12px',
    border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.25))',
    borderRadius: 8,
  },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 600, opacity: 0.8 },
  entry: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12 },
  statusOk: { color: 'var(--dsh-color-success, #15803d)' },
  statusMissing: { color: 'var(--dsh-color-warning, #b45309)' },
  statusRejected: { color: 'var(--dsh-color-danger, #b91c1c)' },
  warn: { color: 'var(--dsh-color-warning, #b45309)', fontSize: 12, lineHeight: 1.5 },
} satisfies Record<string, React.CSSProperties>

/**
 * Interactive states cannot live in a style OBJECT (there is no `:focus` key),
 * and the shell's default focus ring is a heavy black outline on these fields.
 * One small stylesheet, scoped by the `xp-` prefix, supplies a friendly accent
 * ring plus hover feedback; the inline styles above stay the source of truth for
 * everything static.
 */
export const css = `
.xp-input, .xp-select {
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsh-color-border, rgba(128,128,128,0.35));
  background: transparent;
  color: inherit;
  font-size: 13px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.xp-input:hover, .xp-select:hover { border-color: var(--dsh-color-border-strong, rgba(128,128,128,0.6)); }
.xp-input:focus, .xp-select:focus { outline: none; }
.xp-input:focus-visible, .xp-select:focus-visible {
  outline: none;
  border-color: var(--dsh-color-accent, #2f6fd0);
  box-shadow: 0 0 0 2px var(--dsh-color-accent-soft, rgba(47,111,208,0.25));
}
.xp-input::placeholder { color: currentColor; opacity: 0.38; }
.xp-button {
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsh-color-border, rgba(128,128,128,0.35));
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.xp-button:hover:not(:disabled) { background: var(--dsh-color-hover, rgba(128,128,128,0.12)); }
.xp-button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsh-color-accent-soft, rgba(47,111,208,0.25)); }
.xp-button:disabled { opacity: 0.45; cursor: default; }
.xp-button-on { border-color: var(--dsh-color-accent, #2f6fd0); background: var(--dsh-color-accent-soft, rgba(47,111,208,0.15)); }
.xp-button-off { opacity: 0.55; }
.xp-link { border: none; background: none; padding: 2px 4px; opacity: 0.7; font-size: 12px; cursor: pointer; color: inherit; }
.xp-link:hover { opacity: 1; text-decoration: underline; }
`
