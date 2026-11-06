/**
 * Which shell-sandbox dialect the host actually uses, and what that dialect can
 * express. The plugin cannot know the runner from configuration — `sandbox-local`
 * picks it per platform and per functional probe — so the wrapper records the
 * runner of every `confine()` it observes, and the settings page reports the
 * resulting capability matrix.
 *
 * Enforcement capability differs sharply per dialect, and pretending otherwise
 * would be a security bug:
 * - seatbelt (macOS): trailing SBPL rules win, so deny-read / deny-write /
 *   read-only are all expressible by APPENDING rules;
 * - bwrap (Linux): later mounts override earlier ones, so `--mask` and
 *   `--ro-bind` are expressible by APPENDING mount ops;
 * - landlock (Linux fallback): a pure allow-list (`readOnly: ['/']`); a subpath
 *   cannot be subtracted, so NONE of the restrictions are expressible;
 * - windows-acl: a write-restricted token; reads are not restricted at all and
 *   unknown runner flags abort the command, so NONE are expressible.
 * @module dsh-extra-paths/shell-dialect
 */

/** The shell-sandbox runner dialect. */
export type ShellDialect = 'seatbelt' | 'bwrap' | 'landlock' | 'windows-acl' | 'unknown'

/** What the current host can enforce on the SHELL surface. */
export interface ShellCapability {
  /** Shell reads can be denied for a configured path. */
  readonly shellReadDeny: boolean
  /** Shell writes can be denied for a configured path (deny and read levels). */
  readonly shellWriteDeny: boolean
  /** A read-only (`read` access) rule can keep shell writes out of the path. */
  readonly shellReadOnly: boolean
  /** The dialect the decision is based on (`unknown` before the first confinement). */
  readonly shellDialect: ShellDialect
}

/** Most recently observed dialect; `unknown` until the first confinement. */
let observed: ShellDialect = 'unknown'

/** Reset the observation (tests and a fresh plugin load). */
export function resetObservedShellDialect(): void {
  observed = 'unknown'
}

/** The dialect last observed on a real confinement. */
export function observedShellDialect(): ShellDialect {
  return observed
}

/**
 * Classify a confined argv by the runner that produced it. Detection is
 * structural (the same shape `widenArgv` relies on), never a name grep on the
 * user's command: the head is whatever the host prepended.
 * @param argv - the confined argv the sandbox provider returned.
 * @returns the runner dialect, or `unknown` for an unrecognised shape.
 */
export function classifyRunner(argv: readonly string[]): ShellDialect {
  const head = argv.slice(0, 6).join('\u0000')
  const first = (argv[0] ?? '').replaceAll('\\', '/').split('/').pop() ?? ''
  if (first === 'sandbox-exec' || head.includes('sandbox-exec')) return 'seatbelt'
  if (first === 'bwrap' || head.includes('bwrap')) return 'bwrap'
  if (/landlock/i.test(first) || /landlock/i.test(head)) return 'landlock'
  if (head.includes('--workspace') && head.includes('--mode')) return 'windows-acl'
  return 'unknown'
}

/**
 * Record the dialect of one confinement (last observation wins).
 * @param argv - the confined argv the sandbox provider returned.
 * @returns the classified dialect, for the caller's warning paths.
 */
export function recordShellDialect(argv: readonly string[]): ShellDialect {
  const dialect = classifyRunner(argv)
  if (dialect !== 'unknown') observed = dialect
  return dialect
}

/**
 * The capability matrix for one platform, refined by the observed dialect.
 * Before the first confinement a Linux host cannot be classified yet, so the
 * conservative answer is used and the page says "unknown" rather than promising
 * an enforcement it may not have.
 * @param platform - `process.platform`.
 * @param dialect - the observed dialect, or undefined to use the observation.
 * @returns what the shell surface can enforce.
 */
export function shellCapabilityOf(platform: string, dialect: ShellDialect = observed): ShellCapability {
  const runner: ShellDialect = dialect !== 'unknown'
    ? dialect
    : platform === 'darwin'
      ? 'seatbelt'
      : platform === 'win32'
        ? 'windows-acl'
        : 'unknown'
  switch (runner) {
    case 'seatbelt':
    case 'bwrap':
      return { shellReadDeny: true, shellWriteDeny: true, shellReadOnly: true, shellDialect: runner }
    case 'landlock':
      // Allow-list only: new grants are possible, subtraction is not.
      return { shellReadDeny: false, shellWriteDeny: false, shellReadOnly: false, shellDialect: runner }
    case 'windows-acl':
      return { shellReadDeny: false, shellWriteDeny: false, shellReadOnly: false, shellDialect: runner }
    case 'unknown':
    default:
      return { shellReadDeny: false, shellWriteDeny: false, shellReadOnly: false, shellDialect: 'unknown' }
  }
}
