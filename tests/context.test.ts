import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { renderExtraPathsContext } from '../src/context.js'

const base = mkdtempSync(join(tmpdir(), 'xpaths-'))
mkdirSync(join(base, 'notes'))

it('renders nothing without a session cwd or without effective roots', () => {
  const config = normalizeConfig({ paths: ['notes'] })
  expect(renderExtraPathsContext(() => config, undefined)).toBe('')
  expect(renderExtraPathsContext(() => config, join(base, 'elsewhere'))).toBe('')
})

it('lists the effective roots with their scope', () => {
  const config = normalizeConfig({ paths: [{ path: 'notes', scope: 'always-write' }] })
  const text = renderExtraPathsContext(() => config, base)
  expect(text).toContain(join(base, 'notes'))
  expect(text).toContain('regardless of the standing sandbox mode')
  expect(text).toContain('no approval is required')
})
