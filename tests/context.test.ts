import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { renderExtraPathsContext } from '../src/context.js'

const base = mkdtempSync(join(tmpdir(), 'xpaths-'))
// Multi-component relative fixtures: a bare name is a NAME RULE now, so a
// single-segment relative spelling would no longer mean `<workspace>/<name>`.
mkdirSync(join(base, 'sub', 'notes'), { recursive: true })
mkdirSync(join(base, 'sub', 'docs'), { recursive: true })
mkdirSync(join(base, 'sub', 'secrets'), { recursive: true })

it('renders nothing without a session cwd or without effective rules', () => {
  const config = normalizeConfig({ paths: ['sub/notes'] })
  expect(renderExtraPathsContext(() => config, undefined)).toBe('')
  expect(renderExtraPathsContext(() => config, join(base, 'elsewhere'))).toBe('')
})

it('renders nothing when every configured entry is inactive', () => {
  const config = normalizeConfig({ paths: [{ path: './nope', access: 'deny' }] })
  expect(renderExtraPathsContext(() => config, base)).toBe('')
})

it('lists the effective roots with their scope', () => {
  const config = normalizeConfig({ paths: [{ path: 'sub/notes', scope: 'always-write' }] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain(join(base, 'sub', 'notes'))
  expect(text).toContain('regardless of the standing sandbox mode')
  expect(text).toContain('no approval is required')
})

it('tells the model where it may not write', () => {
  const config = normalizeConfig({ paths: [{ path: 'sub/docs', access: 'read', surfaces: ['fs'] }] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain('Read-only roots (do not write):')
  expect(text).toContain(`${join(base, 'sub', 'docs')} (surfaces: fs)`)
})

it('tells the model where it may neither read nor write', () => {
  const config = normalizeConfig({ paths: [{ path: 'sub/secrets', access: 'deny' }] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain('Denied paths (do not read or write):')
  expect(text).toContain(`${join(base, 'sub', 'secrets')} (surfaces: fs+shell)`)
})

it('names denied/read-only NAME rules instead of pretending they are paths', () => {
  const config = normalizeConfig({ paths: [
    { path: '.git', access: 'deny' },
    { path: '.env', access: 'read', surfaces: ['fs'] },
  ] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain('Denied names')
  expect(text).toContain('  - .git (surfaces: fs+shell)')
  expect(text).toContain('Read-only names')
  expect(text).toContain('  - .env (surfaces: fs)')
})

it('renders writable, read-only and denied rules together, writable first', () => {
  const config = normalizeConfig({ paths: [
    'sub/notes',
    { path: 'sub/docs', access: 'read' },
    { path: 'sub/secrets', access: 'deny' },
  ] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain('Additional configured writable roots for this session')
  const writable = text.indexOf('Additional configured writable roots')
  const readOnly = text.indexOf('Read-only roots (do not write):')
  const denied = text.indexOf('Denied paths (do not read or write):')
  expect(writable).toBeGreaterThanOrEqual(0)
  expect(readOnly).toBeGreaterThan(writable)
  expect(denied).toBeGreaterThan(readOnly)
})
