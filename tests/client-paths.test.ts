import { describe, expect, it } from 'vitest'
import { collapse, resolveLexically } from '../src/client/paths.js'

describe('collapse', () => {
  it('collapses . and .. segments and duplicate separators', () => {
    expect(collapse('/a/b/../c')).toBe('/a/c')
    expect(collapse('/a//b/./c/')).toBe('/a/b/c')
    expect(collapse('/a/b/../../c')).toBe('/c')
  })

  it('clamps .. above the root instead of escaping it', () => {
    expect(collapse('/../..')).toBe('/')
    expect(collapse('/a/../../..')).toBe('/')
  })

  it('keeps names that merely start with dots', () => {
    expect(collapse('/a/..cache/x')).toBe('/a/..cache/x')
  })
})

describe('resolveLexically', () => {
  const ws = '/home/user/projects/example-repo'
  const home = '/home/user'

  it('resolves the parent of the workspace', () => {
    expect(resolveLexically('..', ws, home)).toBe('/home/user/projects')
    expect(resolveLexically('../某仓库', ws, home)).toBe('/home/user/projects/某仓库')
  })

  it('resolves deeper relative spellings', () => {
    expect(resolveLexically('../../notes/home', ws, home)).toBe('/home/user/notes/home')
    expect(resolveLexically('./sub/../notes', ws, home)).toBe(`${ws}/notes`)
  })

  it('expands ~ and ~/x, and leaves ~user literal like the host does', () => {
    expect(resolveLexically('~', ws, home)).toBe(home)
    expect(resolveLexically('~/projects/notes/home', ws, home)).toBe('/home/user/projects/notes/home')
    expect(resolveLexically('~foo', ws, home)).toBe(`${ws}/~foo`)
  })

  it('passes absolute spellings through after collapsing them', () => {
    expect(resolveLexically('/home/user/projects/notes/home/', ws, home)).toBe('/home/user/projects/notes/home')
    expect(resolveLexically('/home/user/projects/../projects/notes', ws, home)).toBe('/home/user/projects/notes')
  })

  it('reports undefined instead of guessing', () => {
    expect(resolveLexically('', ws, home)).toBeUndefined()
    expect(resolveLexically('   ', ws, home)).toBeUndefined()
    // `~` before the host has told the page the home directory.
    expect(resolveLexically('~', ws, undefined)).toBeUndefined()
    // A relative entry with no usable base.
    expect(resolveLexically('notes', '', home)).toBeUndefined()
    expect(resolveLexically('notes', 'relative/ws', home)).toBeUndefined()
  })
})
