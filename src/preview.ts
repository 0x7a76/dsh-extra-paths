/**
 * The settings page's effective-roots preview: one authenticated read-only
 * route that resolves the entries the page asks about for a workspace the page
 * supplies. It never probes arbitrary paths — every entry still goes through
 * `normalizeConfig` + `resolveRoots`, the same pair the enforcement layers use —
 * and it computes only path spellings, never file contents.
 * @module dsh-extra-paths/preview
 */

import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import { normalizeConfig, type ExtraPathsConfig, type RawConfig } from './config.js'
import { canonicalizeRoot, expandPath } from './paths.js'
import { resolveRoots, type EntryResolution } from './resolve.js'

/** The single route this plugin owns. */
export const PREVIEW_PATH = '/extra-paths/resolved'

/** The most entries one preview request may carry (a settings page sends its rows). */
export const MAX_PREVIEW_ENTRIES = 64

/** The preview payload. */
export interface PreviewResponse {
  readonly workspaceCwd: string
  /** The host's home directory, so the page can resolve `~` locally too. */
  readonly home: string
  readonly entries: readonly EntryResolution[]
  readonly effective: readonly string[]
  readonly warnings: readonly string[]
}

/**
 * Parse the optional `paths` query parameter: the page's UNSAVED rows, so the
 * preview can answer for what the user is typing instead of only for what is
 * already stored.
 * @param raw - the raw query value (a JSON array of strings / entry objects).
 * @returns a raw configuration carrying those entries, or undefined when absent.
 * @throws {Error} when the payload is not a usable array (the caller answers 400).
 */
export function parseStagedPaths(raw: string | null | undefined): RawConfig | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  if (raw.length > 8192) throw new Error('paths is too long')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('paths must be JSON')
  }
  if (!Array.isArray(parsed)) throw new Error('paths must be a JSON array')
  if (parsed.length > MAX_PREVIEW_ENTRIES) throw new Error(`paths must hold at most ${MAX_PREVIEW_ENTRIES} entries`)
  return { paths: parsed }
}

/**
 * Normalise the workspace base the page sent.
 *
 * `~` is expanded here — the page cannot know the home directory before its
 * first answer — and a RELATIVE spelling is refused outright. That refusal is
 * the fix for a real defect: `resolvePath('~/projects', '..')` used to be evaluated
 * server-side, so a `~` base produced `…/<server cwd>/~/` in the preview while
 * looking like an ordinary path.
 * @param workspaceRoot - the raw query value.
 * @returns the canonical absolute base.
 * @throws {Error} when the base is missing, relative, or a `~user` spelling.
 */
function workspaceBaseOf(workspaceRoot: string | undefined): string {
  if (workspaceRoot === undefined || workspaceRoot.trim() === '') throw new Error('cwd is required')
  const trimmed = workspaceRoot.trim()
  if (trimmed === '~' || trimmed.startsWith('~/')) return canonicalizeRoot(expandPath(trimmed, homedir()))
  if (!isAbsolute(trimmed)) {
    throw new Error(`cwd must be an absolute path or start with ~, received ${JSON.stringify(workspaceRoot)}`)
  }
  return canonicalizeRoot(trimmed)
}

/**
 * Resolve a configuration for one workspace.
 * @param config - the stored configuration snapshot.
 * @param workspaceRoot - the workspace the page is asking about.
 * @param staged - the page's unsaved rows, when it sent any: they REPLACE the
 * stored entries so the preview answers for the draft, not for the document.
 * @returns the preview payload.
 * @throws {Error} when no usable workspace was supplied or the staged rows are
 * invalid (the caller answers 400).
 */
export function buildPreview(
  config: ExtraPathsConfig,
  workspaceRoot: string | undefined,
  staged?: RawConfig | undefined,
): PreviewResponse {
  const base = workspaceBaseOf(workspaceRoot)
  // `normalizeConfig` is the same gate the settings service and the enforcement
  // layers use, so an invalid draft fails here with the user's own message.
  const effectiveConfig = staged === undefined ? config : normalizeConfig(staged)
  const report = resolveRoots(effectiveConfig, base)
  return {
    workspaceCwd: base,
    home: homedir(),
    entries: report.entries,
    effective: report.roots.map(root => root.root),
    warnings: report.warnings,
  }
}

/** The route-registration context surface (webServer + connection). */
export interface PreviewRouteContext {
  webServer: {
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessageLike, res: ServerResponseLike) => void | Promise<void> }): () => void
  }
  connection: {
    requestRejection(request: unknown): number | undefined
  }
  effect(callback: () => () => void, label: string): unknown
}

/** Minimal node:http shapes (the plugin imports no core type for them). */
export interface IncomingMessageLike {
  readonly method?: string
  readonly url?: string
}
export interface ServerResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/**
 * Register the preview route on the calling fiber.
 * Optional capability: if the composition has no web carrier or no Connection
 * service, the caller never invokes this, and enforcement is unaffected.
 * @param ctx - a context that has both `webServer` and `connection`.
 * @param deps - configuration source and warning sink.
 */
export function registerPreviewRoute(
  ctx: PreviewRouteContext,
  deps: { readConfig(): ExtraPathsConfig; warn(message: string): void },
): void {
  const handler = async (req: IncomingMessageLike, res: ServerResponseLike): Promise<void> => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.writeHead(rejection)
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if ((req.method ?? 'GET') !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const staged = parseStagedPaths(url.searchParams.get('paths'))
      const body = JSON.stringify(buildPreview(deps.readConfig(), url.searchParams.get('cwd') ?? undefined, staged))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    } catch (error) {
      deps.warn(`extra-paths: preview route failed: ${String(error)}`)
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String((error as Error).message ?? error))
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PREVIEW_PATH, handler }), 'extra-paths: preview route')
}
