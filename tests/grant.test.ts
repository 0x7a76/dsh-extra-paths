import { describe, expect, it } from 'vitest'
import { grantFor } from '../src/grant.js'
import type { ResolvedRoot } from '../src/resolve.js'
import { syntheticPolicy } from '../src/policy.js'

const write: ResolvedRoot = { raw: 'a', root: '/a', scope: 'write', surfaces: ['fs', 'shell'] }
const always: ResolvedRoot = { raw: 'b', root: '/b', scope: 'always-write', surfaces: ['fs', 'shell'] }
const shellOnly: ResolvedRoot = { raw: 'c', root: '/c', scope: 'always-write', surfaces: ['shell'] }
const roots = [write, always, shellOnly]

describe('grantFor', () => {
  it('grants every matching root under workspace-write', () => {
    expect(grantFor('workspace-write', roots, 'fs').map(r => r.root)).toEqual(['/a', '/b'])
  })

  it('grants only always-write roots under read-only', () => {
    expect(grantFor('read-only', roots, 'fs').map(r => r.root)).toEqual(['/b'])
  })

  it('filters by surface', () => {
    expect(grantFor('workspace-write', roots, 'shell').map(r => r.root)).toEqual(['/a', '/b', '/c'])
  })

  it('grants nothing under danger-full-access (the base is unfenced already)', () => {
    expect(grantFor('danger-full-access', roots, 'fs')).toEqual([])
  })
})

describe('syntheticPolicy', () => {
  it('keeps mode at workspace-write and replaces only the root', () => {
    const policy = { mode: 'read-only', workspaceRoot: '/ws', sessionId: 's1' } as const
    expect(syntheticPolicy(policy, '/extra')).toEqual({ mode: 'workspace-write', workspaceRoot: '/extra', sessionId: 's1' })
  })
})
