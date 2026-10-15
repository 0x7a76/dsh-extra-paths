/**
 * Lexical path resolution for the settings page's live column. It mirrors the
 * host's `expandPath` (a relative entry resolves against the session workspace,
 * `~` against the home directory) WITHOUT touching the filesystem, so a
 * half-typed row can show where it would land before it is saved.
 *
 * Symbolic links are deliberately not resolved here — the browser cannot
 * realpath. The host's own preview is the authoritative answer, and the page
 * keeps showing both: this one instantly, the host's on every settled edit.
 * @module dsh-extra-paths/client/paths
 */

/**
 * Collapse `.`, `..` and duplicate separators in an absolute POSIX spelling.
 * @param path - an absolute spelling (the caller guarantees the leading `/`).
 * @returns the collapsed absolute path; `..` above the root is clamped there.
 */
export function collapse(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join('/')}`
}

/**
 * Resolve one configured entry the way the host will, lexically.
 * @param entry - the row's raw spelling.
 * @param workspaceRoot - the workspace a relative entry resolves against.
 * @param home - the host's home directory, once the preview has reported it.
 * @returns the absolute path, or undefined when it cannot be resolved yet
 * (`~` before the home directory is known, or a relative entry with no usable
 * workspace base).
 */
export function resolveLexically(entry: string, workspaceRoot: string, home: string | undefined): string | undefined {
  const trimmed = entry.trim()
  if (trimmed === '') return undefined
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    if (home === undefined || home === '') return undefined
    return collapse(trimmed === '~' ? home : `${home}/${trimmed.slice(2)}`)
  }
  // `~user` is NOT expanded by the host either: it stays a literal relative name.
  if (trimmed.startsWith('/')) return collapse(trimmed)
  if (!workspaceRoot.startsWith('/')) return undefined
  return collapse(`${workspaceRoot}/${trimmed}`)
}
