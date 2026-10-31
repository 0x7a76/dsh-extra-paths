#!/usr/bin/env node
/**
 * Generate tsconfig.peers.json: map @deepseek-ai/* to a directory that really
 * holds the peer packages, so tsc can resolve peer types without this repo
 * installing them as runtime dependencies.
 *
 * Candidate directories, the first one that holds a READABLE
 * `@deepseek-ai/<pkg>/package.json` wins:
 *   0. <this repo>/node_modules                        (an explicit devDependency)
 *   1. $DSH_APP_DIR/node_modules
 *   2. `which dsh` -> realpath -> <app>/node_modules    (npm/pnpm global install)
 *   3. $DSH_HOME/profiles/node_modules                  (desktop apps that installed
 *      their runtime with npx into ~/.npm/_npx)
 *
 * Readability, not mere existence, is the test. Desktop builds since 0.2.1 pack
 * every host package inside app.asar and leave the npx-era symlinks under
 * `$DSH_HOME/profiles/node_modules` behind as broken links; trusting the
 * directory alone pointed tsc at those and only failed later, as TS2307 from
 * `tsc -p tsconfig.client.json`. Pointing tsc at a directory with no readable
 * packages is worse than failing here, with the reason and the two fixes.
 *
 * Strict by default (exit 1 on failure). `--tolerant`, used by `prepare`, turns
 * any failure into a warning and exit 0 so `pnpm install` works on a machine
 * that has no dsh at all.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const tolerant = process.argv.includes('--tolerant')

/**
 * The peer packages this repo expects the HOST to provide.
 *
 * A candidate only counts when it carries one of these: `@deepseek-ai/schemastery`
 * (a real dependency) sits in this repo's own node_modules and would otherwise
 * make every directory look like a DSH installation.
 */
const PEERS = (() => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  return Object.keys(manifest.peerDependencies ?? {}).map((name) => name.replace('@deepseek-ai/', ''))
})()

function fail(reason, tried, stale) {
  console.error(`dsh-paths: ${reason}`)
  for (const path of tried) console.error(`dsh-paths:   tried ${path}`)
  for (const path of stale) {
    console.error(`dsh-paths:   ${path} has @deepseek-ai but no peer package is readable (only non-peers, or stale links?)`)
  }
  console.error('dsh-paths: fix one of these:')
  console.error('dsh-paths:   - DSH_APP_DIR=/path/to/dir   (dir/node_modules/@deepseek-ai/<peer> must hold real files)')
  console.error('dsh-paths:   - pnpm add -D @deepseek-ai/dsh-client-ui-settings@<the host line you develop against>')
  process.exit(tolerant ? 0 : 1)
}

/** Every directory that might hold the dsh runtime's own node_modules, in order. */
function candidates() {
  const list = [join(REPO_ROOT, 'node_modules')]
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

/**
 * Whether a candidate actually carries the host's peer packages.
 * @param dir - the candidate's `node_modules`.
 * @returns true when at least one peer's `package.json` is readable, which also
 * rejects a directory of broken symlinks.
 */
function holdsPeers(dir) {
  const scope = join(dir, '@deepseek-ai')
  return PEERS.some((name) => existsSync(join(scope, name, 'package.json')))
}

const tried = candidates()
const modules = tried.find(holdsPeers)
if (modules === undefined) {
  const stale = tried.filter((dir) => existsSync(join(dir, '@deepseek-ai')))
  fail('no directory with readable @deepseek-ai/* packages found', tried, stale)
}

const out = {
  compilerOptions: {
    baseUrl: '.',
    paths: { '@deepseek-ai/*': [`${modules}/@deepseek-ai/*`] },
  },
}

try {
  writeFileSync(join(REPO_ROOT, 'tsconfig.peers.json'), `${JSON.stringify(out, null, 2)}\n`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), tried, [])
}

console.log(`tsconfig.peers.json -> ${modules}`)
