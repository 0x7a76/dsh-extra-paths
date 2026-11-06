/**
 * Preview transport. The host half resolves the page's DRAFT rows and reports
 * what it can enforce: the resolved entries (with the new access levels and the
 * `foreign` state), the platform facts the page cannot know by itself (the
 * browser may be Windows Chrome attached to a Linux/WSL host, or a remote
 * machine), and the shell capability matrix for the honesty banner.
 *
 * A missing route (older host half, or a composition without the web carrier)
 * degrades to `undefined` so the page renders its configured rows without the
 * host's answer; every field beyond the core entries is optional for the same
 * reason.
 * @module dsh-extra-paths/client/preview
 */

import type { Access, Surface } from '../config'

/** One entry as the host resolved it. */
export interface PreviewEntry {
  readonly raw: string
  readonly resolved: string
  /** The access level after normalisation (an older host may only send `scope`). */
  readonly access?: Access
  readonly surfaces: readonly Surface[]
  readonly status: 'ok' | 'missing' | 'rejected' | 'foreign'
  /**
   * How many concrete paths the host's bounded walk currently matched for a
   * NAME RULE entry (a bare name such as `.git` stands for N matches). Absent
   * for path entries and on host halves that predate name rules; `0` is a valid
   * answer — the rule is still live for paths created later.
   */
  readonly matches?: number
}

/** The host platform facts sent with the preview. */
export interface PreviewPlatform {
  /** `process.platform` of the HOST, not the browser's. */
  readonly platform: string
  readonly wsl: boolean
  /** Where Windows drives are mounted inside WSL. */
  readonly wslMountRoot?: string
  readonly dialect: 'posix' | 'windows'
}

/** What the host's shell sandbox can enforce (see src/shell-dialect.ts). */
export interface PreviewCapabilities {
  readonly shellReadDeny: boolean
  readonly shellWriteDeny: boolean
  readonly shellReadOnly: boolean
  readonly shellDialect: string
}

/** The preview payload. */
export interface PreviewResult {
  readonly workspaceCwd: string
  /** The host's home directory, so the page can expand `~` locally as well. */
  readonly home?: string
  /** Optional: a host half that predates 0.3.0 sends no platform facts. */
  readonly platform?: PreviewPlatform
  /** Optional: absent means "unknown", and the page stays silent about limits. */
  readonly capabilities?: PreviewCapabilities
  readonly entries: readonly PreviewEntry[]
  /** Writable roots; 0.3.0 spells this `writable` (the old name was `effective`). */
  readonly writable?: readonly string[]
  /** Pre-0.3.0 name of {@link writable}, kept for the older host halves. */
  readonly effective?: readonly string[]
  readonly readOnly?: readonly string[]
  readonly denied?: readonly string[]
  readonly warnings: readonly string[]
}

const ROUTE = '/extra-paths/resolved'

/**
 * Fetch the host's answer for one workspace.
 *
 * The unsaved rows travel with the request so the answer describes the DRAFT:
 * previously the preview only ever described the stored document, which is what
 * made configuring a relative path a guess-until-you-save exercise.
 * @param cwd - the (host-native, absolute) workspace path to resolve against.
 * @param paths - the page's current rows as `{path, access, surfaces}`.
 * @param signal - optional abort signal.
 * @returns the preview, or undefined when the route is unavailable.
 */
export async function fetchPreview(
  cwd: string,
  paths?: readonly unknown[],
  signal?: AbortSignal,
): Promise<PreviewResult | undefined> {
  try {
    const query = new URLSearchParams({ cwd })
    if (paths !== undefined) query.set('paths', JSON.stringify(paths))
    const response = await fetch(`${ROUTE}?${query.toString()}`, { signal, credentials: 'same-origin' })
    if (!response.ok) return undefined
    return await response.json() as PreviewResult
  } catch {
    return undefined
  }
}
