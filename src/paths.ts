/**
 * Path arithmetic for configured roots. Every root is canonicalised the same
 * way the filesystem service canonicalises a write target — realpath of the
 * deepest EXISTING ancestor plus the remaining suffix — so a not-yet-created
 * directory still compares equal to the path the enforcement layer computes.
 * @module dsh-extra-paths/paths
 */

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'

/**
 * Resolve one configured path spelling to an absolute path.
 * @param raw - the configured spelling: absolute, `~`-anchored, or relative.
 * @param workspaceRoot - the session workspace a relative spelling is resolved against.
 * @param home - home directory seam (tests).
 * @returns the absolute path, not yet canonicalised.
 */
export function expandPath(raw: string, workspaceRoot: string, home: string = homedir()): string {
  if (raw === '~') return home
  if (raw.startsWith(`~${sep}`) || raw.startsWith('~/')) return join(home, raw.slice(2))
  if (isAbsolute(raw)) return raw
  return resolvePath(workspaceRoot, raw)
}

/**
 * Canonical spelling of a configured root. Symlinked ancestors are resolved
 * (so `/tmp` and `/private/tmp` cannot silently fail to match), while a suffix
 * that does not exist yet is appended verbatim.
 * @param path - an absolute path.
 * @returns the canonical spelling.
 */
export function canonicalizeRoot(path: string): string {
  const resolved = resolvePath(path)
  const suffix: string[] = []
  let probe = resolved
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return resolved
    suffix.unshift(basename(probe))
    probe = parent
  }
  let real: string
  try {
    real = realpathSync.native(probe)
  } catch {
    real = probe
  }
  return suffix.length === 0 ? real : join(real, ...suffix)
}

/**
 * Whether a canonical target is a root or lies beneath it. Both sides must
 * already be canonical; containment is then purely lexical, which is why the
 * caller canonicalises before comparing.
 * @param targetKey - canonical write target.
 * @param root - canonical configured root.
 * @returns true for the root itself and every descendant.
 */
export function isUnder(targetKey: string, root: string): boolean {
  if (targetKey === root) return true
  const rel = relative(root, targetKey)
  // `..foo` is a legitimate CHILD whose name starts with dots; only the `..`
  // segment itself and a `../` prefix escape the root.
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
