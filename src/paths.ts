/**
 * Path arithmetic for configured roots. Every root is canonicalised the same
 * way the filesystem service canonicalises a write target — realpath of the
 * deepest EXISTING ancestor plus the remaining suffix — so a not-yet-created
 * directory still compares equal to the path the enforcement layer computes.
 *
 * The FILE-SYSTEM side lives here; the pure spelling/dialect vocabulary lives
 * in `platform.ts` and is re-used by both halves. Host facts (platform, WSL,
 * home) are always injected, so the Windows and WSL rules are unit-testable on
 * a POSIX machine and the client can share the pure part.
 * @module dsh-extra-paths/paths
 */

import { existsSync, readFileSync, realpathSync, statSync, type BigIntStats } from 'node:fs'
import { homedir, release } from 'node:os'
import { dirname as posixDirname, posix, win32 } from 'node:path'
import {
  DEFAULT_WSL_MOUNT_ROOT,
  expandPath,
  hostDialect,
  isHostVolumeRoot,
  type ExpandOutcome,
  type PathDialect,
  type PlatformFacts,
} from './platform.js'

export type { ExpandOutcome, PlatformFacts } from './platform.js'
export { expandPath } from './platform.js'

/** `process.platform` cannot change at runtime; the WSL probe is cached too. */
let cachedFacts: PlatformFacts | undefined

/**
 * Whether this Linux host is a WSL guest: WSL exports `WSL_DISTRO_NAME` /
 * `WSL_INTEROP` into the environment, and older releases only expose the
 * Microsoft kernel string.
 * @returns true inside WSL.
 */
export function isWslHost(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined) return true
  return release().toLowerCase().includes('microsoft')
}

/**
 * Discover where Windows drives are mounted inside WSL. `/mnt` is the default,
 * but `/etc/wsl.conf` can remap the automount root, so the REAL mount table is
 * consulted when it is readable; failure falls back to the documented default.
 * @returns the mount root without a trailing slash.
 */
export function detectWslMountRoot(): string {
  try {
    const mounts = readFileSync('/proc/mounts', 'utf8')
    for (const line of mounts.split('\n')) {
      const [source, mountPoint, fsType] = line.split(' ')
      if (mountPoint === undefined || source === undefined) continue
      // drvfs/9p rows look like `C: /mnt/c drvfs rw,relatime 0 0`.
      if (!/^[A-Za-z]:$/.test(source) || !/drvfs|9p/i.test(fsType ?? '')) continue
      const root = posixDirname(mountPoint)
      if (root !== '/' && root !== '.') return root.replace(/\/+$/, '')
    }
  } catch {
    // No /proc/mounts (non-Linux or restricted): fall back to the default.
  }
  return DEFAULT_WSL_MOUNT_ROOT
}

/**
 * The host facts the path layer needs, discovered from the running process.
 * @returns a frozen snapshot (cached: platform, WSL flag and home cannot move).
 */
export function discoverPlatformFacts(): PlatformFacts {
  if (cachedFacts !== undefined) return cachedFacts
  const wsl = isWslHost()
  cachedFacts = Object.freeze({
    platform: process.platform,
    wsl,
    wslMountRoot: wsl ? detectWslMountRoot() : DEFAULT_WSL_MOUNT_ROOT,
    home: homedir(),
  })
  return cachedFacts
}

/** Test-only: forget the discovered facts so a different host can be simulated. */
export function resetPlatformFactsCache(): void {
  cachedFacts = undefined
}

/** The `node:path` implementation matching one host. */
export function pathApiOf(facts: PlatformFacts): typeof posix {
  return hostDialect(facts) === 'windows' ? win32 : posix
}

/** The dialect of host-native paths. */
export function hostPathDialect(facts: PlatformFacts = discoverPlatformFacts()): PathDialect {
  return hostDialect(facts)
}

/**
 * Resolve one configured spelling to a canonical host-native path.
 * @param raw - the configured spelling: absolute, `~`-anchored, relative, or a
 *   path from the other platform (translated when the host can map it).
 * @param workspaceRoot - the session workspace a relative spelling is resolved against.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the expansion outcome, including the `foreign` reason.
 */
export function expandConfiguredPath(
  raw: string,
  workspaceRoot: string,
  facts: PlatformFacts = discoverPlatformFacts(),
): ExpandOutcome {
  return expandPath(raw, workspaceRoot, facts)
}

/**
 * Canonical spelling of a configured root. Symlinked ancestors are resolved
 * (so `/tmp` and `/private/tmp` cannot silently fail to match), while a suffix
 * that does not exist yet is appended verbatim.
 * @param path - an absolute path in the host's dialect.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the canonical spelling.
 */
export function canonicalizeRoot(path: string, facts: PlatformFacts = discoverPlatformFacts()): string {
  const api = pathApiOf(facts)
  const resolved = api.resolve(path)
  const suffix: string[] = []
  let probe = resolved
  while (!existsSync(probe)) {
    const parent = api.dirname(probe)
    if (parent === probe) return resolved
    suffix.unshift(api.basename(probe))
    probe = parent
  }
  let real: string
  try {
    real = realpathSync.native(probe)
  } catch {
    real = probe
  }
  return suffix.length === 0 ? real : api.join(real, ...suffix)
}

/**
 * Whether a canonical path names a volume root on THIS host (translated Windows
 * drive roots included: `/mnt/c` inside WSL).
 * @param path - a canonical host-native path.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns true for a filesystem/volume root.
 */
export function isHostVolumeRootPath(path: string, facts: PlatformFacts = discoverPlatformFacts()): boolean {
  return isHostVolumeRoot(path, facts)
}

/** Whether identity fallback is worth its `stat` cost on this host. */
function mightAliasSpellings(facts: PlatformFacts): boolean {
  // Plain Linux (ext4 etc.) compares case-sensitively and has no 8.3 aliases;
  // macOS is case-insensitive by default and WSL's drvfs/windows shares are
  // alias-prone, so both keep the follower-based fallback.
  return facts.platform === 'win32' || facts.platform === 'darwin' || facts.wsl
}

/**
 * Whether two spellings name the same node (dev + inode), walking the target's
 * existing ancestors. Mirrors the base fence's alias fallback so a denied or
 * granted root cannot be dodged with a casing/8.3 alias.
 */
function sharesIdentity(targetKey: string, root: string, api: typeof posix): boolean {
  let rootInfo: BigIntStats
  try {
    rootInfo = statSync(root, { bigint: true })
  } catch {
    return false
  }
  let current = targetKey
  for (;;) {
    try {
      const info = statSync(current, { bigint: true })
      if (info.dev === rootInfo.dev && info.ino === rootInfo.ino) return true
    } catch {
      // A missing ancestor is not an error: the next pass simply will not see it.
    }
    const parent = api.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

/**
 * Whether a canonical target is a root or lies beneath it. Both sides must
 * already be canonical; containment is then purely lexical, with a filesystem
 * identity fallback for alias-prone hosts (see {@link sharesIdentity}).
 * @param targetKey - canonical write target.
 * @param root - canonical configured root.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns true for the root itself and every descendant.
 */
export function isUnder(targetKey: string, root: string, facts: PlatformFacts = discoverPlatformFacts()): boolean {
  const api = pathApiOf(facts)
  if (api === win32 && targetKey.toLowerCase() === root.toLowerCase()) return true
  if (targetKey === root) return true
  const rel = api.relative(root, targetKey)
  // `..foo` is a legitimate CHILD whose name starts with dots; only the `..`
  // segment itself and a `../` prefix escape the root. `win32.relative` already
  // compares case-insensitively, which matches how Windows resolves paths.
  if (rel !== '' && rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel)) return true
  if (!mightAliasSpellings(facts)) return false
  return sharesIdentity(targetKey, root, api)
}
