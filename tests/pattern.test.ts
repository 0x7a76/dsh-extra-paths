import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { expandPattern, isPattern, parsePattern, PATTERN_LIMITS } from '../src/pattern.js'
import { clearPatternCache, resolveRoots } from '../src/resolve.js'

// realpath the fixture: see tests/wrap-fs.test.ts for the darwin rationale.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'xpaths-')))
const repoA = join(base, 'repo-a')
const repoB = join(base, 'repo-b')
const worktreeA1 = join(repoA, '.worktrees', 'dev_1')
const worktreeA2 = join(repoA, '.worktrees', 'dev_2')
const worktreeB1 = join(repoB, '.worktrees', 'dev_b1')
mkdirSync(worktreeA1, { recursive: true })
mkdirSync(worktreeA2, { recursive: true })
mkdirSync(worktreeB1, { recursive: true })
mkdirSync(join(repoB, 'src'), { recursive: true })
mkdirSync(join(base, 'plain', 'notes'), { recursive: true })
// A `.worktrees` the walk must NOT reach: pruning is part of the safety story.
mkdirSync(join(repoA, 'node_modules', 'pkg', '.worktrees'), { recursive: true })

/** Resolve one pattern spelling against the fixture, through the real pipeline. */
function rootsFor(spelling: string) {
  const report = resolveRoots(normalizeConfig({ paths: [{ path: spelling, scope: 'always-write' }] }), base)
  return { report, entries: report.entries, roots: report.roots.map(root => root.root) }
}

describe('isPattern / parsePattern', () => {
  it('treats a wildcard spelling as a pattern and a literal one as a path', () => {
    expect(isPattern('/a/b/*')).toBe(true)
    expect(isPattern('/a/b/**/.worktrees/..')).toBe(true)
    expect(isPattern('../notes')).toBe(false)
  })

  it('refuses an anchor that is too shallow to bound the walk', () => {
    // `~/**` and `/**` would walk a whole home directory or the filesystem.
    expect(parsePattern('~/**', base, '/Users/someone')).toBeUndefined()
    expect(parsePattern('/**', base)).toBeUndefined()
    expect(parsePattern('/srv/**', base)).toBeUndefined()
    expect(parsePattern('**/.worktrees', base)).toBeUndefined()
    // …while a two-segment anchor is accepted.
    expect(parsePattern('/srv/data/**', base)?.anchor).toBe('/srv/data')
    expect(parsePattern('~/projects/**', base, '/Users/someone')?.anchor).toBe('/Users/someone/projects')
  })

  it('refuses an anchor that IS or CONTAINS the home directory', () => {
    expect(parsePattern('/Users/someone/**', base, '/Users/someone')).toBeUndefined()
    expect(parsePattern('/Users/**', base, '/Users/someone')).toBeUndefined()
  })

  it('separates a trailing .. run from the walk', () => {
    const pattern = parsePattern(`${base}/**/.worktrees/..`, base)
    expect(pattern?.segments).toEqual(['**', '.worktrees'])
    expect(pattern?.up).toBe(1)
  })
})

describe('expandPattern', () => {
  const parsed = (spelling: string) => {
    const pattern = parsePattern(spelling, base)
    if (pattern === undefined) throw new Error(`pattern not parsed: ${spelling}`)
    return pattern
  }

  it('matches a directory that CONTAINS .worktrees, at any depth (** and ..)', () => {
    expect(expandPattern(parsed(`${base}/**/.worktrees/..`)).matches).toEqual([repoA, repoB])
  })

  it('matches one level below .worktrees (*)', () => {
    expect(expandPattern(parsed(`${base}/**/.worktrees/*`)).matches)
      .toEqual([worktreeA1, worktreeA2, worktreeB1].sort())
  })

  it('lets ** match zero segments as well as many', () => {
    expect(expandPattern(parsed(`${base}/**/notes`)).matches).toEqual([join(base, 'plain', 'notes')])
    expect(expandPattern(parsed(`${base}/plain/**`)).matches).toEqual([join(base, 'plain'), join(base, 'plain', 'notes')])
  })

  it('never descends into node_modules or .git', () => {
    const matches = expandPattern(parsed(`${base}/**/.worktrees/..`)).matches
    expect(matches.some(match => match.includes('node_modules'))).toBe(false)
  })

  it('treats the depth bound as semantics, keeping what it found', () => {
    // `**` means "up to maxDepth levels": a shallower bound still matches, it
    // only reports that it stopped — unlike a runaway walk, which grants nothing.
    const shallow = expandPattern(parsed(`${base}/**`), {
      maxDirs: PATTERN_LIMITS.maxDirs,
      maxMatches: PATTERN_LIMITS.maxMatches,
      maxDepth: 0,
    })
    expect(shallow.capped).toBe(false)
    expect(shallow.truncated).toBe(true)
    expect(shallow.matches).toContain(base)
  })

  it('fails closed when the walk runs away (directories or matches)', () => {
    const wide = expandPattern(parsed(`${base}/**`), { maxDirs: 2, maxMatches: PATTERN_LIMITS.maxMatches, maxDepth: PATTERN_LIMITS.maxDepth })
    expect(wide.capped).toBe(true)
    expect(wide.cap).toBe('directories')
    expect(wide.matches).toEqual([])
    const many = expandPattern(parsed(`${base}/**`), { maxDirs: PATTERN_LIMITS.maxDirs, maxMatches: 1, maxDepth: PATTERN_LIMITS.maxDepth })
    expect(many.capped).toBe(true)
    expect(many.cap).toBe('matches')
    expect(many.matches).toEqual([])
  })
})

describe('patterns through resolveRoots', () => {
  beforeEach(() => { clearPatternCache() })

  it('turns one pattern entry into one root per match', () => {
    const { roots, entries, report } = rootsFor(`${base}/**/.worktrees/*`)
    expect(roots).toEqual([worktreeA1, worktreeA2, worktreeB1].sort())
    // One entry per match, all carrying the configured spelling so the page can
    // show "this row produced N roots".
    expect(entries.map(entry => entry.raw)).toEqual(Array(3).fill(`${base}/**/.worktrees/*`))
    expect(entries.every(entry => entry.status === 'ok')).toBe(true)
    expect(report.warnings).toEqual([])
  })

  it('warns when a granted root contains the session workspace', () => {
    // The worktree case this feature exists for: the session runs INSIDE a
    // worktree while the pattern grants the repository root above it.
    const report = resolveRoots(
      normalizeConfig({ paths: [`${base}/**/.worktrees/..`] }),
      worktreeA1,
    )
    expect(report.roots.map(root => root.root)).toEqual([repoA, repoB])
    expect(report.warnings.join('\n')).toContain('contains this session')
  })

  it('grants the repository root for the .worktrees parent pattern', () => {
    expect(rootsFor(`${base}/**/.worktrees/..`).roots).toEqual([repoA, repoB])
  })

  it('reports zero matches as missing, with a warning, and grants nothing', () => {
    const { roots, entries, report } = rootsFor(`${base}/**/nothing-here`)
    expect(roots).toEqual([])
    expect(entries[0]).toMatchObject({ status: 'missing', resolved: '' })
    expect(report.warnings.join('\n')).toContain('matches no existing directory')
  })

  it('reports an unwalkable anchor as rejected and grants nothing', () => {
    const { roots, entries, report } = rootsFor('/**')
    expect(roots).toEqual([])
    expect(entries[0]).toMatchObject({ status: 'rejected', resolved: '' })
    expect(report.warnings.join('\n')).toContain('was not expanded because its anchor is not walkable')
  })

  it('reuses an expansion for a few seconds, then follows the filesystem', () => {
    expect(rootsFor(`${base}/**/.worktrees/*`).roots).toHaveLength(3)
    const worktreeA3 = join(repoA, '.worktrees', 'dev_3')
    mkdirSync(worktreeA3)
    // Cached: a brand-new worktree is not granted yet (bounded staleness).
    expect(rootsFor(`${base}/**/.worktrees/*`).roots).toHaveLength(3)
    clearPatternCache()
    expect(rootsFor(`${base}/**/.worktrees/*`).roots).toEqual([worktreeA1, worktreeA2, worktreeA3, worktreeB1].sort())
  })

  it('leaves a literal entry exactly as it was', () => {
    const { roots, entries } = rootsFor(join(repoB, 'src'))
    expect(roots).toEqual([join(repoB, 'src')])
    expect(entries).toHaveLength(1)
  })
})
