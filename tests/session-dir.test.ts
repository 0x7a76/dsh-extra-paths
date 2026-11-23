import { expect, it } from 'vitest'
import { sessionDirectoryOf } from '../src/session-dir.js'

const session = { header: { cwd: '/original' } }

it('reads the host working directory when the service is present', () => {
  const ctx = { get: (name: string) => name === 'workingDirectory' ? { get: () => '/moved' } : undefined }
  expect(sessionDirectoryOf(ctx, session)).toBe('/moved')
})

it('returns no opinion without a context, a session or the service', () => {
  expect(sessionDirectoryOf(undefined, session)).toBeUndefined()
  expect(sessionDirectoryOf({ get: () => undefined }, undefined)).toBeUndefined()
  expect(sessionDirectoryOf({}, session)).toBeUndefined()
  expect(sessionDirectoryOf({ get: () => ({}) }, session)).toBeUndefined()
})

it('ignores empty and non-string answers so callers can fall back to the header', () => {
  expect(sessionDirectoryOf({ get: () => ({ get: () => '' }) }, session)).toBeUndefined()
  expect(sessionDirectoryOf({ get: () => ({ get: () => 42 }) }, session)).toBeUndefined()
})

it('swallows a disposed or throwing service', () => {
  const ctx = { get: () => ({ get: () => { throw new Error('disposed') } }) }
  expect(sessionDirectoryOf(ctx, session)).toBeUndefined()
  const throwingLookup = { get: () => { throw new Error('unavailable') } }
  expect(sessionDirectoryOf(throwingLookup, session)).toBeUndefined()
})
