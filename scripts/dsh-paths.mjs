#!/usr/bin/env node
/**
 * Generate tsconfig.peers.json: map @deepseek-ai/* to the INSTALLED dsh's own
 * node_modules so tsc can resolve peer types without installing them. The
 * profile runs with autoInstallPeers:false, so these packages exist only inside
 * the dsh installation — never in this repo's node_modules.
 *
 * Candidate directories, first one that actually holds `@deepseek-ai` wins:
 *   1. $DSH_APP_DIR/node_modules
 *   2. `which dsh` -> realpath -> <app>/node_modules   (npm/pnpm global install)
 *   3. $DSH_HOME/profiles/node_modules                 (desktop app: its runtime
 *      deps live here; the app's own copy is packed inside app.asar, and the CLI
 *      shim at runtime/cli/bin/dsh has no node_modules next to it)
 *
 * Writing a path that does not contain `@deepseek-ai` is worse than failing: it
 * only surfaces later, as TS2307 from `tsc -p tsconfig.client.json`.
 *
 * Strict by default (exit 1 on failure). `--tolerant`, used by `prepare`, turns
 * any failure into a warning and exit 0 so `pnpm install` works on a machine
 * that has no dsh at all.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REMEDY = 'install DSH, put it on PATH, or set DSH_APP_DIR'
const tolerant = process.argv.includes('--tolerant')

function fail(reason, tried) {
  console.error(`dsh-paths: cannot resolve the DSH app directory (${reason}); ${REMEDY}`)
  if (tried !== undefined) for (const path of tried) console.error(`dsh-paths:   tried ${path}`)
  process.exit(tolerant ? 0 : 1)
}

/** Every directory that might hold the dsh runtime's own node_modules, in order. */
function candidates() {
  const list = []
  const override = process.env.DSH_APP_DIR
  if (typeof override === 'string' && override.length > 0) list.push(join(override, 'node_modules'))
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
    if (bin !== '') list.push(join(dirname(dirname(realpathSync(bin))), 'node_modules'))
  } catch {
    // No `dsh` on PATH: the desktop app ships its own CLI, so this is not fatal.
  }
  const home = process.env.DSH_HOME
  const dshHome = typeof home === 'string' && home.length > 0 ? home : join(homedir(), '.dsh')
  list.push(join(dshHome, 'profiles', 'node_modules'))
  return list
}

const tried = candidates()
const modules = tried.find((dir) => existsSync(join(dir, '@deepseek-ai')))
if (modules === undefined) fail('no candidate directory holds @deepseek-ai', tried)

const out = {
  compilerOptions: {
    baseUrl: '.',
    paths: { '@deepseek-ai/*': [`${modules}/@deepseek-ai/*`] },
  },
}

try {
  writeFileSync(new URL('../tsconfig.peers.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), tried)
}

console.log(`tsconfig.peers.json -> ${modules}`)
