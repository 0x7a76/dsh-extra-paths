/**
 * The settings page's rule model and its LEXICAL path resolution.
 *
 * Everything here is browser-safe: the path vocabulary and the Windows ⇄ WSL
 * translation come from `../platform` (pure string functions, no `node:fs`), and
 * the host facts are injected. The page cannot know the platform — under WSL the
 * browser is Windows Chrome while the host is Linux, and a remote web client is a
 * different machine — so the FIRST preview response supplies them; before that the
 * page uses a POSIX-ish heuristic and explicitly says it is waiting for the host.
 *
 * Resolution here only decides the string sent to the host: the base workspace is
 * resolved lexically so the preview can be requested. The host's preview
 * (realpath + existence + volume roots) stays authoritative.
 *
 * The file also owns the rule TEXT grammar used by the page's single editor: one
 * rule per line, `path`, `path | access`, `path | access | surfaces` (`fs`,
 * `shell`, `fs+shell`), with `#` comments and blank lines ignored. Saving always
 * writes the structured `{path, access, surfaces}` array; the text is the only
 * editor for it.
 * @module dsh-extra-paths/client/paths
 */

import type { Access, Surface } from '../config'
// The pure spelling/dialect vocabulary is shared with the host half. Only the
// TYPE comes from `../config` (duplicating a two-element union there would drift);
// the constants below are local so the host configuration module stays out of the
// browser bundle.
import {
  classifySpelling,
  collapsePosix,
  expandPath,
  isAbsoluteSpelling,
  isBareNameSpelling,
  type PathDialect,
  type PlatformFacts,
} from '../platform'

/** All access levels, in the order the dropdown offers them (strict → permissive). */
export const ACCESSES: readonly Access[] = ['deny', 'read', 'write', 'always-write']

/** All enforcement surfaces. */
export const SURFACES: readonly Surface[] = ['fs', 'shell']

/** The plugin's default access level when a stored entry does not say. */
export const DEFAULT_ACCESS: Access = 'write'

/** The plugin's default surfaces when a stored entry does not say. */
export const DEFAULT_SURFACES: readonly Surface[] = ['fs', 'shell']

/** One editable rule: the structured shape the page edits and saves. */
export interface Rule {
  path: string
  access: Access
  surfaces: Surface[]
}

/** The defaults a bare string or a partial entry inherits. */
export interface RuleDefaults {
  readonly access: Access
  readonly surfaces: readonly Surface[]
}

/** One stored entry: the 0.3.0 shape plus the legacy `scope` spelling. */
interface StoredEntry {
  readonly path?: unknown
  readonly access?: unknown
  /** Legacy alias for `access` (`write` | `always-write`), still accepted. */
  readonly scope?: unknown
  readonly surfaces?: unknown
}

/** The settings section this page edits (host values are untrusted). */
export interface Section {
  readonly paths?: readonly (string | StoredEntry)[]
  readonly defaultAccess?: unknown
  /** Legacy alias for `defaultAccess`. */
  readonly defaultScope?: unknown
  readonly defaultSurfaces?: unknown
}

function accessOf(value: unknown): Access | undefined {
  return typeof value === 'string' && (ACCESSES as readonly string[]).includes(value) ? value as Access : undefined
}

function surfacesOf(value: unknown): Surface[] | undefined {
  if (!Array.isArray(value)) return undefined
  const surfaces: Surface[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(SURFACES as readonly string[]).includes(item)) continue
    if (!surfaces.includes(item as Surface)) surfaces.push(item as Surface)
  }
  return surfaces.length > 0 ? surfaces : undefined
}

/**
 * The defaults a stored section declares, with the legacy `defaultScope` alias
 * and the plugin defaults as fallbacks.
 * @param section - the stored section, when the host has one.
 * @returns access + surfaces to use for entries that omit them.
 */
export function defaultsOf(section: Section | undefined): RuleDefaults {
  return {
    access: accessOf(section?.defaultAccess) ?? accessOf(section?.defaultScope) ?? DEFAULT_ACCESS,
    surfaces: surfacesOf(section?.defaultSurfaces) ?? [...DEFAULT_SURFACES],
  }
}

/**
 * Turn a stored section into editable rows. Accepts every shape the host half
 * still accepts: a bare string (the defaults apply), an entry with `access`, and
 * the legacy `scope` (mapped onto the same vocabulary). Unknown vocabulary falls
 * back to the defaults instead of crashing the page — the save-time validator is
 * where an invalid document is reported.
 * @param section - the stored section.
 * @returns the editable rows in stored order.
 */
export function rowsOf(section: Section | undefined): Rule[] {
  const defaults = defaultsOf(section)
  const rows: Rule[] = []
  for (const item of section?.paths ?? []) {
    if (typeof item === 'string') {
      rows.push({ path: item, access: defaults.access, surfaces: [...defaults.surfaces] })
      continue
    }
    if (item === null || typeof item !== 'object') continue
    rows.push({
      path: typeof item.path === 'string' ? item.path : '',
      access: accessOf(item.access) ?? accessOf(item.scope) ?? defaults.access,
      surfaces: surfacesOf(item.surfaces) ?? [...defaults.surfaces],
    })
  }
  return rows
}

/**
 * Serialise the rows into the structured payload the page saves and previews.
 * Empty paths (a row just added and not typed into yet) are dropped, matching
 * the host's own "path must be a non-empty string" rule.
 * @param rows - the editable rows.
 * @returns `{path, access, surfaces}` objects with trimmed paths.
 */
export function payloadOf(rows: readonly Rule[]): { path: string; access: Access; surfaces: Surface[] }[] {
  const payload: { path: string; access: Access; surfaces: Surface[] }[] = []
  for (const row of rows) {
    const path = row.path.trim()
    if (path === '') continue
    payload.push({ path, access: row.access, surfaces: [...row.surfaces] })
  }
  return payload
}

// ── Bulk text mode ──────────────────────────────────────────────────────────

/** Why one text-mode line was rejected. Localized by the page. */
export type TextErrorCode = 'empty-path' | 'unknown-access' | 'unknown-surfaces' | 'too-many-fields'

/** One rejected line, carrying its 1-based line number for the error list. */
export interface TextError {
  readonly line: number
  readonly code: TextErrorCode
  /** The offending field value (access / surfaces), when the error has one. */
  readonly value?: string
}

/** Parsing the whole text is all-or-nothing: one bad line rejects the apply. */
export type TextParseResult =
  | { readonly ok: true; readonly rules: Rule[] }
  | { readonly ok: false; readonly errors: TextError[] }

/** The canonical `+`-joined surface spelling (`fs+shell`). */
export function surfacesText(surfaces: readonly Surface[]): string {
  return SURFACES.filter(surface => surfaces.includes(surface)).join('+')
}

/**
 * Render one rule in the EXPLICIT text form: `path | access | surfaces`.
 *
 * The editor deliberately does not omit values that happen to equal the plugin
 * defaults: the user configured those fields in the list view and expects to
 * see them when switching to text mode (a bare `path` looked like the access
 * and surface settings had been lost). Explicit output also round-trips
 * independent of any future default change. The parser still accepts the short
 * forms (`path`, `path | access`) when hand-typing.
 * @param row - one rule.
 * @returns one text-mode line.
 */
function formatRule(row: Rule): string {
  return `${row.path.trim()} | ${row.access} | ${surfacesText(row.surfaces)}`
}

/**
 * Render the current rows for the text-mode editor.
 * @param rows - the current rows.
 * @returns one explicit line per non-empty rule.
 */
export function serializeRules(rows: readonly Rule[]): string {
  return rows
    .filter(row => row.path.trim() !== '')
    .map(formatRule)
    .join('\n')
}

/** Parse the optional `| surfaces` field (`fs`, `shell`, `fs+shell`, also `shell+fs`). */
function parseSurfacesField(value: string): Surface[] | undefined {
  const parts = value.split(/[+,\s]+/).filter(part => part !== '')
  const surfaces: Surface[] = []
  for (const part of parts) {
    if (!(SURFACES as readonly string[]).includes(part)) return undefined
    if (!surfaces.includes(part as Surface)) surfaces.push(part as Surface)
  }
  const ordered = SURFACES.filter(surface => surfaces.includes(surface))
  return ordered.length > 0 ? ordered : undefined
}

/**
 * Parse the bulk text editor. Blank lines and lines whose first non-space
 * character is `#` are comments/separators and are skipped. A line is
 * `path`, `path | access`, or `path | access | surfaces`.
 * @param text - the editor content.
 * @param defaults - the defaults a missing access/surfaces field inherits.
 * @returns the parsed rules, or every per-line error (nothing is applied then).
 */
export function parseRules(text: string, defaults: RuleDefaults = defaultsOf(undefined)): TextParseResult {
  const rules: Rule[] = []
  const errors: TextError[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const lineNo = index + 1
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const fields = trimmed.split('|').map(field => field.trim())
    if (fields.length > 3) {
      errors.push({ line: lineNo, code: 'too-many-fields' })
      return
    }
    const path = fields[0] ?? ''
    if (path === '') {
      errors.push({ line: lineNo, code: 'empty-path' })
      return
    }
    let access = defaults.access
    if (fields.length >= 2) {
      const parsed = accessOf(fields[1])
      if (parsed === undefined) {
        errors.push({ line: lineNo, code: 'unknown-access', value: fields[1] ?? '' })
        return
      }
      access = parsed
    }
    let surfaces = [...defaults.surfaces]
    if (fields.length === 3) {
      const parsed = parseSurfacesField(fields[2] ?? '')
      if (parsed === undefined) {
        errors.push({ line: lineNo, code: 'unknown-surfaces', value: fields[2] ?? '' })
        return
      }
      surfaces = parsed
    }
    rules.push({ path, access, surfaces })
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules }
}

// ── Name rules (bare names) ─────────────────────────────────────────────────

/**
 * Whether a configured spelling is a NAME RULE (`.git`, `.env`, `node_modules`):
 * one component, no separator, matched at ANY depth under the session workspace
 * and every configured writable root. It is not a path, so it has no lexical
 * resolution — the host matches it live per call and reports a match count for
 * the preview.
 *
 * The spelling vocabulary is shared with the host half through `../platform`
 * (pure string functions). The node-only rule engine (`../name-rule`) must never
 * be imported here: this module is bundled into the browser client.
 * @param path - the raw configured spelling.
 * @returns true when the host treats the entry as a name rule.
 */
export function isNameRulePath(path: string): boolean {
  return isBareNameSpelling(path.trim())
}

// ── Host facts + lexical resolution ─────────────────────────────────────────

/**
 * The platform facts a preview response carries (structurally, so this module
 * does not depend on the transport module).
 */
export interface PlatformReport {
  readonly platform: string
  readonly wsl: boolean
  readonly wslMountRoot?: string
}

/** What the page knows about the host, and whether it has actually told us. */
export interface HostView {
  readonly facts: PlatformFacts
  /** False until the first preview response carries `platform` (older host). */
  readonly known: boolean
}

/** The POSIX-ish fallback used before the host reports its real platform. */
export const FALLBACK_FACTS: PlatformFacts = Object.freeze({
  platform: 'unknown',
  wsl: false,
  wslMountRoot: '/mnt',
  home: '',
})

/**
 * Build the path facts from a preview payload. Before the first preview there
 * are no facts: the page then assumes a POSIX host for its instant hint and
 * refuses to claim ANY Windows spelling resolves (it waits for the host's platform facts).
 * @param preview - the preview payload, when one has arrived.
 * @returns the facts plus a flag saying whether they came from the host.
 */
export function hostViewOf(preview: { readonly platform?: PlatformReport; readonly home?: string } | undefined): HostView {
  const report = preview?.platform
  if (report === undefined) return { facts: FALLBACK_FACTS, known: false }
  return {
    known: true,
    facts: {
      platform: report.platform,
      wsl: report.wsl,
      wslMountRoot: report.wslMountRoot ?? '/mnt',
      home: preview?.home ?? '',
    },
  }
}

/** Why a base workspace cannot be used for the lexical preview. */
export type BaseProblem = 'empty' | 'relative' | 'waiting' | 'foreign'

/** A usable absolute base, or the reason it is not usable yet. */
export type BaseResult =
  | { readonly ok: true; readonly base: string }
  | { readonly ok: false; readonly problem: BaseProblem; readonly reason?: string }

/**
 * Resolve the base-workspace field the way the host will. The field accepts an
 * absolute spelling in the HOST's dialect (`C:\…`, `\\server\share\…`), a `~`
 * spelling, and nothing relative.
 * @param spelling - the raw field value.
 * @param host - the host facts view.
 * @returns the host-native absolute base, or why it cannot be used.
 */
export function resolveBase(spelling: string, host: HostView): BaseResult {
  const trimmed = spelling.trim()
  if (trimmed === '') return { ok: false, problem: 'empty' }
  const kind = classifySpelling(trimmed)
  if (kind === 'home' || kind === 'windows-home') {
    // `~` needs the host's home directory: the page cannot even guess it.
    if (host.facts.home === '') return { ok: false, problem: 'waiting' }
  } else if (kind === 'windows-absolute') {
    // Never claim a Windows base resolves before the host has said which platform
    // it is: the same browser can be attached to a POSIX host.
    if (!host.known) return { ok: false, problem: 'waiting' }
  } else if (!isAbsoluteSpelling(trimmed)) {
    return { ok: false, problem: 'relative' }
  }
  const outcome = expandPath(trimmed, '', host.facts)
  if (outcome.ok) return { ok: true, base: outcome.path }
  if (!host.known) return { ok: false, problem: 'waiting' }
  return { ok: false, problem: 'foreign', reason: outcome.foreign }
}

/**
 * Which base spelling to send with the preview request.
 *
 * Normally it is the resolved host-native base. While the page still waits for
 * the platform facts it sends the RAW absolute spelling instead: the HOST is the
 * one that knows its dialect, so it accepts `C:\…` on Windows, `/mnt/c/…` in
 * WSL and `~` anywhere (expanding it with the real home directory). Without this
 * a Windows workspace candidate would leave the page waiting for facts forever —
 * it refuses to claim the Windows base resolves, but the host can prove it.
 * Relative/empty spellings are never sent (the host rejects them anyway).
 * @param spelling - the raw base field value.
 * @param base - the lexical base outcome.
 * @returns the query value, or '' when there is nothing usable to ask about.
 */
export function previewBaseOf(spelling: string, base: BaseResult): string {
  if (base.ok) return base.base
  const trimmed = spelling.trim()
  if (base.problem === 'waiting' && isAbsoluteSpelling(trimmed)) return trimmed
  return ''
}

/** What the lexical hint says about one row. The host preview stays authoritative. */
export { collapsePosix }

/** Re-exported so callers do not need a second import for the heuristic. */
export { isAbsoluteSpelling }
