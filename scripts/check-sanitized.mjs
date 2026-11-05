#!/usr/bin/env node
/**
 * Repository hygiene guard: fail when a TRACKED file carries machine-local
 * paths, personal identifiers, or credential-looking strings.
 *
 * This repository is published (GitHub + npm), so a path like
 * `/Users/<name>/…` or a personal email in a doc leaks the maintainer's
 * environment. The allowlist below accepts documented placeholders and
 * clearly fictional fixtures; everything else must use `<placeholder>` or `~`.
 *
 * Run locally with `pnpm run check:sanitized`; CI runs it on every push/PR.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Files allowed to spell out forbidden SAMPLE strings. Only this guard: its
 * comments show what a bad path/token looks like, and the personal-identifier
 * rule is assembled at runtime so the identifier itself is never spelled out.
 */
const ALLOWED_FILES = new Set(['scripts/check-sanitized.mjs'])

/** Fictional/placeholder user names accepted in fixtures and docs (`u` is a one-letter test fixture). */
const ALLOWED_USERS = ['someone', 'shared', 'user', 'you', 'example', 'u']

/**
 * A home root only counts when it starts a path segment (so a nested
 * `notes/home/x.md` does not look like `/home/x.md`) and its first component is
 * not a documented placeholder user.
 */
const homeRoot = (segment) =>
  `(?<![A-Za-z0-9._-])/${segment}/(?!(?:${ALLOWED_USERS.join('|')})(?![A-Za-z0-9._-]))[A-Za-z0-9._-]+`

/** What a tracked file must never contain. Each regex is global and multiline-safe. */
const RULES = [
  {
    name: 'machine-local macOS home path',
    pattern: new RegExp(homeRoot('Users'), 'g'),
  },
  {
    name: 'machine-local Linux home path',
    pattern: new RegExp(homeRoot('home'), 'g'),
  },
  {
    name: 'personal identifier or personal email',
    // Assembled at runtime so this guard does not itself spell out the
    // identifier it forbids; the email pattern is generic (any Gmail address).
    pattern: new RegExp([['zevi', 'chen'].join(''), '[A-Za-z0-9._%+-]+@gmail\\.com'].join('|'), 'gi'),
  },
  {
    name: 'machine hostname',
    pattern: /\b[A-Za-z0-9-]+\.local\b/g,
  },
  {
    name: 'GitHub token',
    pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  },
  {
    name: 'npm token or auth config',
    pattern: /_authToken|\bnpm_[A-Za-z0-9]{20,}/g,
  },
  {
    name: 'cloud/LLM API key',
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
  },
  {
    name: 'private key material',
    pattern: /BEGIN [A-Z ]*PRIVATE KEY/g,
  },
]

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean)

const findings = []
for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // binary or unreadable; tracked binaries are not prose/config
  }
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split('\n').length
      findings.push(`${file}:${line}: ${rule.name}: ${match[0]}`)
    }
  }
}

if (findings.length > 0) {
  console.error('check-sanitized: tracked files carry machine-local or personal data:\n')
  for (const finding of findings) console.error(`  ${finding}`)
  console.error('\nUse a placeholder (`<name>`, `~/…`, `/tmp/…`) or remove the value, then re-run `pnpm run check:sanitized`.')
  process.exit(1)
}
console.log(`check-sanitized: ${files.length} tracked files clean`)
