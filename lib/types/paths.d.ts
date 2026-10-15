/**
 * Path arithmetic for configured roots. Every root is canonicalised the same
 * way the filesystem service canonicalises a write target — realpath of the
 * deepest EXISTING ancestor plus the remaining suffix — so a not-yet-created
 * directory still compares equal to the path the enforcement layer computes.
 * @module dsh-extra-paths/paths
 */
/**
 * Resolve one configured path spelling to an absolute path.
 * @param raw - the configured spelling: absolute, `~`-anchored, or relative.
 * @param workspaceRoot - the session workspace a relative spelling is resolved against.
 * @param home - home directory seam (tests).
 * @returns the absolute path, not yet canonicalised.
 */
export declare function expandPath(raw: string, workspaceRoot: string, home?: string): string;
/**
 * Canonical spelling of a configured root. Symlinked ancestors are resolved
 * (so `/tmp` and `/private/tmp` cannot silently fail to match), while a suffix
 * that does not exist yet is appended verbatim.
 * @param path - an absolute path.
 * @returns the canonical spelling.
 */
export declare function canonicalizeRoot(path: string): string;
/**
 * Whether a canonical target is a root or lies beneath it. Both sides must
 * already be canonical; containment is then purely lexical, which is why the
 * caller canonicalises before comparing.
 * @param targetKey - canonical write target.
 * @param root - canonical configured root.
 * @returns true for the root itself and every descendant.
 */
export declare function isUnder(targetKey: string, root: string): boolean;
