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
/** The default WSL drive mount root. */
export const DEFAULT_WSL_MOUNT_ROOT = '/mnt';
/** Extended-length prefix `\\?\` (and `\\?\UNC\`). */
const EXTENDED_PREFIX = /^\\\\\?\\/;
const EXTENDED_UNC_PREFIX = /^\\\\\?\\UNC\\/i;
/** `C:\` or `C:/` — a drive-rooted absolute path. */
const WIN_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
/** `C:foo` — drive-RELATIVE (resolved against that drive's current directory). */
const WIN_DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;
/** `\\server\share\x` — a UNC path (two leading backslashes, a server name). */
const WIN_UNC = /^\\\\[^\\]/;
/** `//server/share/x` — UNC spelled with forward separators. */
const WIN_UNC_FORWARD = /^\/\/[^/]+\/[^/]+/;
/** A single leading separator that is neither `\\` nor `/`: `\foo` (current drive). */
const WIN_CURRENT_DRIVE = /^\\(?!\\)/;
/** Strip a Windows extended-length prefix, which only adds noise to comparison. */
export function stripWindowsPrefix(spelling) {
    if (EXTENDED_UNC_PREFIX.test(spelling))
        return `\\\\${spelling.slice('\\\\?\\UNC\\'.length)}`;
    if (EXTENDED_PREFIX.test(spelling))
        return spelling.slice('\\\\?\\'.length);
    return spelling;
}
/** The logical host dialect. */
export function hostDialect(facts) {
    return facts.platform === 'win32' ? 'windows' : 'posix';
}
/**
 * Classify one spelling without consulting the host.
 * @param spelling - the raw configured spelling (trimmed by the caller).
 * @returns what kind of path it is.
 */
export function classifySpelling(spelling) {
    if (spelling === '~')
        return 'home';
    if (spelling.startsWith('~/'))
        return 'home';
    if (spelling.startsWith('~\\'))
        return 'windows-home';
    const stripped = stripWindowsPrefix(spelling);
    if (WIN_DRIVE_ABSOLUTE.test(stripped) || WIN_UNC.test(stripped))
        return 'windows-absolute';
    if (WIN_UNC_FORWARD.test(stripped))
        return 'windows-absolute';
    if (WIN_DRIVE_RELATIVE.test(stripped))
        return 'windows-drive-relative';
    if (spelling.startsWith('/'))
        return 'posix-absolute';
    if (WIN_CURRENT_DRIVE.test(stripped))
        return 'windows-current-drive';
    return 'relative';
}
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
export function isBareNameSpelling(spelling) {
    if (spelling === '' || spelling === '.' || spelling === '..')
        return false;
    if (spelling.startsWith('~'))
        return false;
    if (spelling.includes('*'))
        return false;
    // `C:foo` is a drive-relative PATH, not a component name: the colon spelling
    // must keep flowing into the path validator that rejects it deliberately.
    if (/^[A-Za-z]:/.test(spelling))
        return false;
    return !spelling.includes('/') && !spelling.includes('\\');
}
/**
 * Whether a spelling is absolute in its own dialect (a `~` spelling counts:
 * the caller expands home first).
 * @param spelling - the raw configured spelling.
 * @returns true for home, POSIX-absolute and Windows-absolute spellings.
 */
export function isAbsoluteSpelling(spelling) {
    const kind = classifySpelling(spelling);
    return kind === 'home' || kind === 'windows-home' || kind === 'posix-absolute' || kind === 'windows-absolute';
}
/**
 * Normalize a spelling for the pattern grammar: Windows spellings use `/` as the
 * separator for parsing, and the extended-length prefix is dropped first.
 * POSIX spellings are returned verbatim: on POSIX a backslash is a legal
 * FILENAME character and must never be turned into a separator.
 * @param spelling - the raw configured spelling.
 * @returns a spelling whose separators are `/` when it is a Windows path.
 */
export function normalizePatternSpelling(spelling) {
    const stripped = stripWindowsPrefix(spelling);
    if (WIN_DRIVE_ABSOLUTE.test(stripped.slice(0, 3))
        || WIN_UNC.test(stripped)
        || WIN_UNC_FORWARD.test(stripped)
        || spelling.startsWith('~\\')) {
        return stripped.replaceAll('\\', '/');
    }
    return spelling;
}
/** Collapse `.`, `..` and duplicate separators in an absolute POSIX spelling. */
export function collapsePosix(path) {
    const segments = [];
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..') {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return `/${segments.join('/')}`;
}
/**
 * Collapse an absolute Windows spelling (drive or UNC) into its native form.
 * The result uses `\` separators; case is preserved (Windows comparison folds
 * case later, but the host's `realpath`/ACL layers still want the real spelling).
 * @param path - an absolute Windows spelling using either separator.
 * @returns the collapsed spelling, e.g. `C:\Users\me\x` or `\\server\share\x`.
 */
export function collapseWindows(path) {
    const stripped = stripWindowsPrefix(path).replaceAll('/', '\\');
    if (WIN_UNC.test(stripped)) {
        // Keep the two leading backslashes, then collapse the share part normally.
        const parts = stripped.slice(2).split('\\');
        const server = parts.shift() ?? '';
        const share = parts.shift() ?? '';
        const rest = collapseWindowsSegments(parts);
        return `\\\\${server}\\${share}${rest === '' ? '' : `\\${rest}`}`;
    }
    const drive = stripped.slice(0, 2);
    const rest = collapseWindowsSegments(stripped.slice(2).split('\\'));
    return `${drive}\\${rest}`;
}
/** Collapse one segment list, clamping `..` at the start. */
function collapseWindowsSegments(segments) {
    const out = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..') {
            out.pop();
            continue;
        }
        out.push(segment);
    }
    return out.join('\\');
}
/** Join a home directory and a `~`-relative rest in the host's dialect. */
function homeJoin(home, rest, dialect) {
    const separator = dialect === 'windows' ? '\\' : '/';
    const trimmed = rest.replace(dialect === 'windows' ? /^[\\/]+/ : /^\/+/, '');
    if (trimmed === '')
        return dialect === 'windows' ? collapseWindows(home) : collapsePosix(home);
    return dialect === 'windows' ? collapseWindows(`${home}\\${trimmed}`) : collapsePosix(`${home}/${trimmed}`);
}
/** Resolve a relative spelling against the workspace base in one dialect. */
function resolveRelative(base, spelling, dialect) {
    if (dialect === 'windows')
        return collapseWindows(`${base}\\${spelling}`);
    return collapsePosix(`${base}/${spelling}`);
}
/** Build a `foreign` outcome: the spelling has no meaning on this host. */
function foreign(reason) {
    return { ok: false, foreign: reason };
}
/**
 * Translate a Windows absolute spelling into its WSL spelling.
 * @param spelling - a drive-rooted or UNC spelling (any separator).
 * @param mountRoot - the WSL mount root, normally `/mnt`.
 * @returns the POSIX spelling, or undefined for a share UNC path (no mapping).
 */
export function windowsToWsl(spelling, mountRoot = DEFAULT_WSL_MOUNT_ROOT) {
    const stripped = stripWindowsPrefix(spelling).replaceAll('\\', '/');
    const drive = /^([A-Za-z]):(?:\/|$)/.exec(stripped);
    if (drive === null)
        return undefined;
    const letter = (drive[1] ?? '').toLowerCase();
    const rest = stripped.slice(drive[0].length);
    const root = mountRoot.replace(/\/+$/, '');
    const tail = rest.replace(/^\/+/, '');
    return tail === '' ? `${root}/${letter}` : `${root}/${letter}/${tail}`;
}
/**
 * Translate a POSIX spelling that names a Windows drive into its Windows form.
 * Two conventions are recognized: WSL's `/mnt/<letter>/…` and the MSYS/git-bash
 * `/c/…` form. The caller verifies the result by resolving it (existence is the
 * only proof that the drive really exists on this host).
 * @param spelling - an absolute POSIX spelling.
 * @param mountRoot - the WSL drive mount root, normally `/mnt`.
 * @returns the Windows spelling, or undefined when the spelling is not a drive.
 */
export function posixToWindows(spelling, mountRoot = DEFAULT_WSL_MOUNT_ROOT) {
    const root = mountRoot.replace(/\/+$/, '');
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mounted = new RegExp(`^${escape(root)}/([A-Za-z])(?:/(.*))?$`).exec(spelling);
    if (mounted !== null)
        return windowsFromParts(mounted[1] ?? '', mounted[2]);
    // A bare `/c/...` is ambiguous, but it is the MSYS/git-bash convention and the
    // caller's existence check rejects it on hosts without that drive.
    const msys = /^\/([A-Za-z])(?:\/(.*))?$/.exec(spelling);
    if (msys !== null)
        return windowsFromParts(msys[1] ?? '', msys[2]);
    return undefined;
}
/** Assemble a Windows drive path from a drive letter and a `/`-separated rest. */
function windowsFromParts(letter, rest) {
    const drive = letter.toUpperCase();
    return rest === undefined || rest === '' ? `${drive}:\\` : `${drive}:\\${rest.replaceAll('/', '\\')}`;
}
/**
 * Whether a spelling names a filesystem/volume root, which would disable the
 * sandbox outright. Covers POSIX `/`, a drive root (`C:`, `C:\`, `C:/`) and a
 * UNC SHARE root (`\\server\share`), which is as broad as a drive for a share.
 * @param spelling - a path spelling (either dialect).
 * @returns true when the spelling is a volume root.
 */
export function isVolumeRootSpelling(spelling) {
    const stripped = stripWindowsPrefix(spelling);
    if (spelling === '/' || stripped === '\\')
        return true;
    if (/^[A-Za-z]:[\\/]?$/.test(stripped))
        return true;
    return /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?$/.test(stripped);
}
/**
 * Whether a canonical, host-native path names a volume root, including the WSL
 * spelling of a Windows drive root (`/mnt/c`). The literal-root rejection runs
 * on the CANONICAL path, so translation (`C:\` ⇒ `/mnt/c`) must be caught here.
 * @param path - a host-native absolute path.
 * @param facts - the host facts.
 * @returns true for a volume root.
 */
export function isHostVolumeRoot(path, facts) {
    if (isVolumeRootSpelling(path))
        return true;
    if (!facts.wsl)
        return false;
    const root = facts.wslMountRoot.replace(/\/+$/, '');
    return new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z]/?$`).test(path);
}
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
export function expandPath(spelling, workspaceRoot, facts) {
    const dialect = hostDialect(facts);
    const kind = classifySpelling(spelling);
    switch (kind) {
        case 'home':
            return { ok: true, path: homeJoin(facts.home, spelling.slice(1), dialect), dialect, translated: false };
        case 'windows-home':
            if (dialect === 'windows')
                return { ok: true, path: homeJoin(facts.home, spelling.slice(1), dialect), dialect, translated: false };
            return foreign(`the Windows home spelling ${JSON.stringify(spelling)} is only understood on a Windows host`);
        case 'posix-absolute':
            if (dialect === 'posix')
                return { ok: true, path: collapsePosix(spelling), dialect, translated: false };
            {
                const mapped = posixToWindows(spelling, facts.wslMountRoot);
                if (mapped !== undefined)
                    return { ok: true, path: collapseWindows(mapped), dialect, translated: true };
                return foreign(`the POSIX path ${JSON.stringify(spelling)} cannot be expressed on a Windows host`);
            }
        case 'windows-absolute':
            if (dialect === 'windows')
                return { ok: true, path: collapseWindows(spelling), dialect, translated: false };
            if (facts.wsl) {
                const mapped = windowsToWsl(spelling, facts.wslMountRoot);
                if (mapped !== undefined)
                    return { ok: true, path: collapsePosix(mapped), dialect, translated: true };
                return foreign(`the UNC path ${JSON.stringify(spelling)} has no reliable WSL mapping`);
            }
            return foreign(`the Windows path ${JSON.stringify(spelling)} is only understood on a Windows host or inside WSL`);
        case 'windows-drive-relative':
            return foreign(`the drive-relative spelling ${JSON.stringify(spelling)} is ambiguous and refused`);
        case 'windows-current-drive':
            if (dialect === 'windows')
                return foreign(`the current-drive spelling ${JSON.stringify(spelling)} is ambiguous and refused`);
            // On POSIX a leading backslash is an ordinary filename character.
            return { ok: true, path: resolveRelative(workspaceRoot, spelling, dialect), dialect, translated: false };
        case 'relative':
        default:
            return { ok: true, path: resolveRelative(workspaceRoot, spelling, dialect), dialect, translated: false };
    }
}
/** Marker used in warnings for entries that only apply on another platform. */
export function foreignPathMessage(spelling, reason) {
    return `extra-paths: ${JSON.stringify(spelling)} is not applicable on this host (${reason}); the entry stays inactive until the configuration is used on a matching host`;
}
//# sourceMappingURL=platform.js.map