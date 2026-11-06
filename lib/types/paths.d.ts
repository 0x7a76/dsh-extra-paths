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
import { posix } from 'node:path';
import { type ExpandOutcome, type PathDialect, type PlatformFacts } from './platform.js';
export type { ExpandOutcome, PlatformFacts } from './platform.js';
export { expandPath } from './platform.js';
/**
 * Whether this Linux host is a WSL guest: WSL exports `WSL_DISTRO_NAME` /
 * `WSL_INTEROP` into the environment, and older releases only expose the
 * Microsoft kernel string.
 * @returns true inside WSL.
 */
export declare function isWslHost(): boolean;
/**
 * Discover where Windows drives are mounted inside WSL. `/mnt` is the default,
 * but `/etc/wsl.conf` can remap the automount root, so the REAL mount table is
 * consulted when it is readable; failure falls back to the documented default.
 * @returns the mount root without a trailing slash.
 */
export declare function detectWslMountRoot(): string;
/**
 * The host facts the path layer needs, discovered from the running process.
 * @returns a frozen snapshot (cached: platform, WSL flag and home cannot move).
 */
export declare function discoverPlatformFacts(): PlatformFacts;
/** Test-only: forget the discovered facts so a different host can be simulated. */
export declare function resetPlatformFactsCache(): void;
/** The `node:path` implementation matching one host. */
export declare function pathApiOf(facts: PlatformFacts): typeof posix;
/** The dialect of host-native paths. */
export declare function hostPathDialect(facts?: PlatformFacts): PathDialect;
/**
 * Resolve one configured spelling to a canonical host-native path.
 * @param raw - the configured spelling: absolute, `~`-anchored, relative, or a
 *   path from the other platform (translated when the host can map it).
 * @param workspaceRoot - the session workspace a relative spelling is resolved against.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the expansion outcome, including the `foreign` reason.
 */
export declare function expandConfiguredPath(raw: string, workspaceRoot: string, facts?: PlatformFacts): ExpandOutcome;
/**
 * Canonical spelling of a configured root. Symlinked ancestors are resolved
 * (so `/tmp` and `/private/tmp` cannot silently fail to match), while a suffix
 * that does not exist yet is appended verbatim.
 * @param path - an absolute path in the host's dialect.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns the canonical spelling.
 */
export declare function canonicalizeRoot(path: string, facts?: PlatformFacts): string;
/**
 * Whether a canonical path names a volume root on THIS host (translated Windows
 * drive roots included: `/mnt/c` inside WSL).
 * @param path - a canonical host-native path.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns true for a filesystem/volume root.
 */
export declare function isHostVolumeRootPath(path: string, facts?: PlatformFacts): boolean;
/**
 * Whether a canonical target is a root or lies beneath it. Both sides must
 * already be canonical; containment is then purely lexical, with a filesystem
 * identity fallback for alias-prone hosts (see {@link sharesIdentity}).
 * @param targetKey - canonical write target.
 * @param root - canonical configured root.
 * @param facts - host facts (defaults to the discovered ones).
 * @returns true for the root itself and every descendant.
 */
export declare function isUnder(targetKey: string, root: string, facts?: PlatformFacts): boolean;
