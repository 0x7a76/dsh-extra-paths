/**
 * Feature-detected access to the host's session working directory.
 *
 * DSH 0.2.3 made the sandbox policy resolve a Session's workspace through the
 * `workingDirectory` service (a Session can be moved by the Host, e.g. into a
 * worktree) instead of its immutable header cwd. The plugin's prompt context
 * and tool-argument guard must use the SAME directory as enforcement, or the
 * model is told one set of absolute roots while the fence checks another.
 *
 * The service is absent on 0.1.5 and may be absent from a custom composition,
 * so every read is structural and fails soft to the caller's header fallback.
 * @module dsh-extra-paths/session-dir
 */

/** The session surface both call sites already carry (header cwd is the fallback). */
export interface SessionLike {
  readonly header?: { readonly cwd?: string }
}

/** Structural view of the `workingDirectory` service; no `@deepseek-ai/*` import. */
export interface WorkingDirectoryLike {
  get(session: unknown): string
}

/** The subset of a cordis context this module reads (non-strict service lookup). */
export interface ServiceReadContext {
  get?(name: string, strict?: boolean): unknown
}

/**
 * Read the Session's current working directory from the host service.
 *
 * A missing service, a disposed service, a non-string answer or an empty answer
 * all mean "no opinion" so the caller can use its header fallback. This runs on
 * every prompt assembly and tool dispatch, so it must never throw.
 * @param ctx - the plugin context (or a test double) exposing `get`.
 * @param session - the Session whose directory is requested.
 * @returns the committed directory, or undefined when the host cannot say.
 */
export function sessionDirectoryOf(
  ctx: ServiceReadContext | undefined,
  session: SessionLike | undefined,
): string | undefined {
  if (ctx === undefined || session === undefined) return undefined
  try {
    const service = ctx.get?.('workingDirectory', false) as WorkingDirectoryLike | undefined
    if (typeof service?.get !== 'function') return undefined
    const directory = service.get(session)
    return typeof directory === 'string' && directory !== '' ? directory : undefined
  } catch {
    // A disposed or half-initialized service must not break prompt assembly or
    // a tool call; the immutable header cwd is still a usable fallback.
    return undefined
  }
}
