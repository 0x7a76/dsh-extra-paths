/**
 * Inline style constants. The framework's own client preset compiles CSS
 * modules through workspace-internal tsdown plugins that a third-party package
 * cannot import, so this page carries its styles as plain objects instead.
 *
 * Layout goal: a settings page that stays SHORT with many rules. One rule is one
 * ~32px row in a scrollable list (`max-height: 46vh`), not a card per path; the
 * bulk text editor replaces the list instead of growing below it.
 * @module dsh-extra-paths/client/styles
 */

import type * as React from 'react'

// The shell sets no global `box-sizing`, so every element here declares it:
// without it a `width: 100%` field is content-box and its padding + border push
// it past the container's right edge (a defect this page shipped with once).
const box: React.CSSProperties = { boxSizing: 'border-box' }

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

const input: React.CSSProperties = {
  ...box,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.35))',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
}

/** The page's style map. */
export const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0', maxWidth: 860 },
  introLine: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' },
  intro: { fontSize: 12, lineHeight: 1.6, opacity: 0.75 },
  label: { fontSize: 12, fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' },
  baseRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  baseField: { ...box, width: 380, maxWidth: '100%', height: 30 },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },


  // Danger/warning dot in front of a deny/read row (write rows keep the slot empty).

  // Bulk text mode: the list is swapped out, never stacked.
  textEditor: { display: 'flex', flexDirection: 'column', gap: 8 },
  // The collapsible examples block above the textarea: documentation next to the
  // input, without permanently eating vertical space.
  examples: { ...box, fontSize: 12 },
  examplesSummary: { cursor: 'pointer', opacity: 0.75, userSelect: 'none' },
  examplesBody: {
    ...box,
    margin: '6px 0 0',
    padding: '8px 10px',
    maxHeight: 260,
    overflow: 'auto',
    border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.25))',
    borderRadius: 8,
    background: 'var(--dsh-color-surface-secondary, rgba(128,128,128,0.06))',
    fontFamily: 'var(--dsh-font-mono, monospace)',
    fontSize: 11.5,
    lineHeight: 1.55,
    whiteSpace: 'pre',
    opacity: 0.9,
  },
  textarea: {
    ...box,
    width: '100%',
    minHeight: 220,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.35))',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'var(--dsh-font-mono, monospace)',
    fontSize: 12,
    lineHeight: 1.6,
    resize: 'vertical',
    // Long paths stay on ONE line: wrapping makes a rule impossible to read.
    // Horizontal scrolling (trackpad/mouse) is deliberate, not a missing limit.
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    wordBreak: 'normal',
    overflowX: 'auto',
  },
  textErrors: { display: 'flex', flexDirection: 'column', gap: 2 },

  // Capability banner: the shell limitation must be visible, not hidden in a log.
  capability: {
    ...box,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsh-color-warning, #b45309)',
    background: 'var(--dsh-color-warning-soft, rgba(180,83,9,0.08))',
    fontSize: 12,
    lineHeight: 1.5,
  },

  panel: {
    ...box,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 10px',
    border: '1px solid var(--dsh-color-border, rgba(128,128,128,0.25))',
    borderRadius: 8,
  },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 600, opacity: 0.8 },
  panelHeadRight: { display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', fontWeight: 400 },
  entry: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12 },
  code: { fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12, whiteSpace: 'nowrap' },
  dim: { opacity: 0.6, fontSize: 12, lineHeight: 1.5 },
  warn: { color: 'var(--dsh-color-warning, #b45309)', fontSize: 12, lineHeight: 1.5 },
  danger: { color: 'var(--dsh-color-danger, #b91c1c)', fontSize: 12, lineHeight: 1.5 },
  statusOk: { color: 'var(--dsh-color-success, #15803d)' },
  statusMissing: { color: 'var(--dsh-color-warning, #b45309)' },
  statusRejected: { color: 'var(--dsh-color-danger, #b91c1c)' },
  statusForeign: { color: 'var(--dsh-color-text-secondary, inherit)', opacity: 0.7 },
  button,
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
.xp-input:hover, .xp-select:hover, .xp-textarea:hover { border-color: var(--dsh-color-border-strong, rgba(128,128,128,0.6)); }
.xp-input:focus, .xp-select:focus, .xp-textarea:focus { outline: none; }
.xp-input:focus-visible, .xp-select:focus-visible, .xp-textarea:focus-visible {
  outline: none;
  border-color: var(--dsh-color-accent, #2f6fd0);
  box-shadow: 0 0 0 2px var(--dsh-color-accent-soft, rgba(47,111,208,0.25));
}
.xp-input::placeholder, .xp-textarea::placeholder { color: currentColor; opacity: 0.38; }
.xp-textarea {
  box-sizing: border-box;
  border: 1px solid var(--dsh-color-border, rgba(128,128,128,0.35));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
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
.xp-link { border: none; background: none; padding: 2px 4px; opacity: 0.7; font-size: 12px; cursor: pointer; color: inherit; }
.xp-link:hover { opacity: 1; text-decoration: underline; }

/* One column template for a rule row (the row component is kept for tests and
   compositions; the page itself edits plain text). */
  display: grid;
  grid-template-columns: 10px 150px minmax(0, 1fr) 66px 96px 22px;
  column-gap: 8px;
  align-items: center;
}
/* One control height for every cell; the previous flex row mixed 26px buttons
   with 31px inputs, so nothing sat on one baseline. */
.xp-toolbar .xp-button { height: 28px; display: inline-flex; align-items: center; }

/* Preview entries share their own template: status / access / spelling → resolution. */
.xp-entry {
  display: grid;
  grid-template-columns: 62px 116px minmax(0, 1fr);
  column-gap: 8px;
  align-items: baseline;
  font-size: 12px;
}
/* A resolved path is one token: never wrap it, scroll horizontally instead. */
.xp-entry-paths { display: flex; gap: 6px; flex-wrap: nowrap; min-width: 0; overflow-x: auto; }
`
