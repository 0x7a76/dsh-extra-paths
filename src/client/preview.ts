/**
 * Preview transport. A missing route (older host half, or a composition
 * without the web carrier) degrades to `undefined` so the page renders its
 * configured rows without the resolved column.
 * @module dsh-extra-paths/client/preview
 */

/** One entry as the host resolved it. */
export interface PreviewEntry {
  readonly raw: string
  readonly resolved: string
  readonly scope: 'write' | 'always-write'
  readonly surfaces: readonly ('fs' | 'shell')[]
  readonly status: 'ok' | 'missing' | 'rejected'
}

/** The preview payload. */
export interface PreviewResult {
  readonly workspaceCwd: string
  /** The host's home directory, so the page can resolve `~` locally as well. */
  readonly home?: string
  readonly entries: readonly PreviewEntry[]
  readonly effective: readonly string[]
  readonly warnings: readonly string[]
}

const ROUTE = '/extra-paths/resolved'

/**
 * Fetch the effective roots for one workspace.
 *
 * The unsaved rows travel with the request so the answer describes the DRAFT:
 * previously the preview only ever described the stored document, which is what
 * made configuring a relative path a guess-until-you-save exercise.
 * @param cwd - the workspace path to resolve against.
 * @param paths - the page's current rows (strings or `{path, scope, surfaces}`).
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
