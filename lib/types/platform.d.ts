/**
 * Path-dialect vocabulary, spelling classification and the Windows ⇄ WSL
 * translation. Everything here is a PURE string function: no `node:fs`, no
 * `node:path`, no `process` — the caller injects the host facts, which keeps the
 * module importable from the browser client (it is bundled by tsdown) and makes
 * the Windows logic unit-testable on a POSIX CI machine.
 *
 * Why this module exists:
 * - A configuration file is meant to be the SAME on every machine (dotfiles /
 *   a repository). A path spelled `C:\Users\me\work` must be understood inside
 *   WSL as `/mnt/c/Users/me/work`, and `/mnt/c/Users/me/work` must be understood
 *   on a native Windows host. The host half does the translation — the browser
 *   client must never infer a platform (under WSL the browser is Windows Chrome
 *   while the host is Linux, and a remote web client is a different machine).
 * - A spelling that cannot be expressed on the current host becomes `foreign`
 *   and the entry is inactive with a warning; it must NOT fail the save, or one
 *   shared configuration could not be used on two platforms.
 *
 * @module dsh-extra-paths/platform
 */
/** A path spelling family. */
export type PathDialect = 'posix' | 'windows';
/** Facts about the host the plugin process runs on. */
export interface PlatformFacts {
    /** `process.platform` at call time: `darwin` / `linux` / `win32` / … */
    readonly platform: string;
    /** True when the host is a Linux process inside WSL. */
    readonly wsl: boolean;
    /** Where Windows drives are mounted inside WSL (`/mnt` unless remapped). */
    readonly wslMountRoot: string;
    /** The host's home directory, already in the host's native spelling. */
    readonly home: string;
}
/** The default WSL drive mount root. */
export declare const DEFAULT_WSL_MOUNT_ROOT = "/mnt";
/** How one configured spelling is classified (platform-independent). */
export type SpellingKind = 'home' | 'posix-absolute' | 'windows-absolute' | 'windows-home' | 'windows-drive-relative' | 'windows-current-drive' | 'relative';
/** Strip a Windows extended-length prefix, which only adds noise to comparison. */
export declare function stripWindowsPrefix(spelling: string): string;
/** The logical host dialect. */
export declare function hostDialect(facts: PlatformFacts): PathDialect;
/**
 * Classify one spelling without consulting the host.
 * @param spelling - the raw configured spelling (trimmed by the caller).
 * @returns what kind of path it is.
 */
export declare function classifySpelling(spelling: string): SpellingKind;
/**
 * Whether a spelling is a BARE NAME (`.git`, `.env`, `node_modules`): one path
 * component, no separator, no wildcard, not the `.`/`..` relative specials and
 * not a `~` spelling. A bare name is a NAME RULE — it matches that component at
 * any depth under the rule's scope roots rather than naming one literal path.
 *
 * The `./name` spelling is the escape hatch for a literal single-component
 * relative path (it contains a separator, so it stays a normal relative path).
 * @param spelling - the raw configured spelling.
 * @returns true when the spelling is a name rule.
 */
export declare function isBareNameSpelling(spelling: string): boolean;
/**
 * Whether a spelling is absolute in its own dialect (a `~` spelling counts:
 * the caller expands home first).
 * @param spelling - the raw configured spelling.
 * @returns true for home, POSIX-absolute and Windows-absolute spellings.
 */
export declare function isAbsoluteSpelling(spelling: string): boolean;
/**
 * Normalize a spelling for the pattern grammar: Windows spellings use `/` as the
 * separator for parsing, and the extended-length prefix is dropped first.
 * POSIX spellings are returned verbatim: on POSIX a backslash is a legal
 * FILENAME character and must never be turned into a separator.
 * @param spelling - the raw configured spelling.
 * @returns a spelling whose separators are `/` when it is a Windows path.
 */
export declare function normalizePatternSpelling(spelling: string): string;
/** Collapse `.`, `..` and duplicate separators in an absolute POSIX spelling. */
export declare function collapsePosix(path: string): string;
/**
 * Collapse an absolute Windows spelling (drive or UNC) into its native form.
 * The result uses `\` separators; case is preserved (Windows comparison folds
 * case later, but the host's `realpath`/ACL layers still want the real spelling).
 * @param path - an absolute Windows spelling using either separator.
 * @returns the collapsed spelling, e.g. `C:\Users\me\x` or `\\server\share\x`.
 */
export declare function collapseWindows(path: string): string;
/**
 * A translation outcome: the host-native spelling, or the reason this platform
 * cannot express the configured spelling.
 */
export type ExpandOutcome = {
    readonly ok: true;
    readonly path: string;
    readonly dialect: PathDialect;
    readonly translated: boolean;
} | {
    readonly ok: false;
    readonly foreign: string;
};
/**
 * Translate a Windows absolute spelling into its WSL spelling.
 * @param spelling - a drive-rooted or UNC spelling (any separator).
 * @param mountRoot - the WSL mount root, normally `/mnt`.
 * @returns the POSIX spelling, or undefined for a share UNC path (no mapping).
 */
export declare function windowsToWsl(spelling: string, mountRoot?: string): string | undefined;
/**
 * Translate a POSIX spelling that names a Windows drive into its Windows form.
 * Two conventions are recognized: WSL's `/mnt/<letter>/…` and the MSYS/git-bash
 * `/c/…` form. The caller verifies the result by resolving it (existence is the
 * only proof that the drive really exists on this host).
 * @param spelling - an absolute POSIX spelling.
 * @param mountRoot - the WSL drive mount root, normally `/mnt`.
 * @returns the Windows spelling, or undefined when the spelling is not a drive.
 */
export declare function posixToWindows(spelling: string, mountRoot?: string): string | undefined;
/**
 * Whether a spelling names a filesystem/volume root, which would disable the
 * sandbox outright. Covers POSIX `/`, a drive root (`C:`, `C:\`, `C:/`) and a
 * UNC SHARE root (`\\server\share`), which is as broad as a drive for a share.
 * @param spelling - a path spelling (either dialect).
 * @returns true when the spelling is a volume root.
 */
export declare function isVolumeRootSpelling(spelling: string): boolean;
/**
 * Whether a canonical, host-native path names a volume root, including the WSL
 * spelling of a Windows drive root (`/mnt/c`). The literal-root rejection runs
 * on the CANONICAL path, so translation (`C:\` ⇒ `/mnt/c`) must be caught here.
 * @param path - a host-native absolute path.
 * @param facts - the host facts.
 * @returns true for a volume root.
 */
export declare function isHostVolumeRoot(path: string, facts: PlatformFacts): boolean;
/**
 * Resolve one configured spelling to a HOST-NATIVE absolute path.
 *
 * Translation happens only when the spelling's dialect differs from the host's:
 * a Windows spelling inside WSL becomes `/mnt/<drive>/…`, a `/mnt/<drive>/…`
 * spelling on a native Windows host becomes `<Drive>:\…`. A spelling with no
 * mapping on this host is `foreign`: the caller marks the entry inactive with a
 * warning instead of failing the whole configuration.
 * @param spelling - the configured spelling (already trimmed).
 * @param workspaceRoot - the session workspace a relative spelling resolves against.
 * @param facts - host platform facts.
 * @returns the host-native absolute path, or the reason it is foreign.
 */
export declare function expandPath(spelling: string, workspaceRoot: string, facts: PlatformFacts): ExpandOutcome;
/** Marker used in warnings for entries that only apply on another platform. */
export declare function foreignPathMessage(spelling: string, reason: string): string;
