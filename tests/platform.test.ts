import { describe, expect, it } from 'vitest'
import {
  classifySpelling,
  collapsePosix,
  collapseWindows,
  expandPath,
  isAbsoluteSpelling,
  isBareNameSpelling,
  isHostVolumeRoot,
  isVolumeRootSpelling,
  normalizePatternSpelling,
  posixToWindows,
  stripWindowsPrefix,
  windowsToWsl,
  type PlatformFacts,
} from '../src/platform.js'

const posix: PlatformFacts = { platform: 'darwin', wsl: false, wslMountRoot: '/mnt', home: '/Users/someone' }
const wsl: PlatformFacts = { platform: 'linux', wsl: true, wslMountRoot: '/mnt', home: '/home/someone' }
const windows: PlatformFacts = { platform: 'win32', wsl: false, wslMountRoot: '/mnt', home: 'C:\\Users\\someone' }

describe('classifySpelling', () => {
  it.each([
    ['~', 'home'],
    ['~/notes', 'home'],
    ['~\\notes', 'windows-home'],
    ['C:\\Users\\someone', 'windows-absolute'],
    ['C:/Users/someone', 'windows-absolute'],
    ['\\\\server\\share\\x', 'windows-absolute'],
    ['//server/share/x', 'windows-absolute'],
    ['C:foo', 'windows-drive-relative'],
    ['/abs/x', 'posix-absolute'],
    ['\\foo', 'windows-current-drive'],
    ['relative/x', 'relative'],
    ['..', 'relative'],
  ] as const)('classifies %j as %s', (spelling, kind) => {
    expect(classifySpelling(spelling)).toBe(kind)
  })

  it('strips the extended-length prefix before classifying', () => {
    expect(classifySpelling('\\\\?\\C:\\Users\\someone')).toBe('windows-absolute')
    expect(classifySpelling('\\\\?\\UNC\\server\\share\\x')).toBe('windows-absolute')
    expect(stripWindowsPrefix('\\\\?\\UNC\\server\\share\\x')).toBe('\\\\server\\share\\x')
  })

  it('does not call a bare // a UNC path', () => {
    expect(classifySpelling('//')).toBe('posix-absolute')
  })

  it('treats a backslash on POSIX as a filename character, not a separator', () => {
    expect(classifySpelling('name\\with\\backslashes')).toBe('relative')
  })

  it('isAbsoluteSpelling accepts home and both absolute dialects', () => {
    for (const spelling of ['~', '~/x', '~\\x', '/x', 'C:\\x', '\\\\server\\share']) {
      expect(isAbsoluteSpelling(spelling)).toBe(true)
    }
    for (const spelling of ['x', '..', 'C:x', '\\x']) {
      expect(isAbsoluteSpelling(spelling)).toBe(false)
    }
  })
})

describe('isBareNameSpelling', () => {
  it('treats a single component as a name rule', () => {
    for (const spelling of ['.git', '.env', 'node_modules', 'secrets', '.gitignore']) {
      expect(isBareNameSpelling(spelling)).toBe(true)
    }
  })

  it('never treats a path, a pattern, the relative specials or a ~ spelling as a name rule', () => {
    for (const spelling of ['.', '..', './.git', '../.git', 'a/b', 'C:\\x', '~', '~foo', '~/x', '*.git', '.git*', 'C:foo', 'D:bar', '']) {
      expect(isBareNameSpelling(spelling)).toBe(false)
    }
  })

  it('treats a backslash as a separator on any host spelling', () => {
    expect(isBareNameSpelling('a\\b')).toBe(false)
  })
})

describe('normalizePatternSpelling', () => {
  it('turns Windows separators into the pattern separator', () => {
    expect(normalizePatternSpelling('C:\\Users\\someone\\**\\.worktrees\\..')).toBe('C:/Users/someone/**/.worktrees/..')
    expect(normalizePatternSpelling('\\\\server\\share\\proj\\**')).toBe('//server/share/proj/**')
    expect(normalizePatternSpelling('~\\projects\\**')).toBe('~/projects/**')
  })

  it('leaves POSIX spellings verbatim, including a literal backslash', () => {
    expect(normalizePatternSpelling('~/projects/**/.worktrees/..')).toBe('~/projects/**/.worktrees/..')
    expect(normalizePatternSpelling('/srv/name\\*/**')).toBe('/srv/name\\*/**')
  })
})

describe('collapse helpers', () => {
  it('collapses a POSIX spelling', () => {
    expect(collapsePosix('/a//b/./c/../d')).toBe('/a/b/d')
    expect(collapsePosix('/a/../..')).toBe('/')
  })

  it('collapses a Windows drive spelling and keeps case', () => {
    expect(collapseWindows('C:\\Work\\Projects\\..\\Other\\x')).toBe('C:\\Work\\Other\\x')
    expect(collapseWindows('C:/Work/Projects/../x')).toBe('C:\\Work\\x')
    expect(collapseWindows('C:\\..\\..\\x')).toBe('C:\\x')
    expect(collapseWindows('C:\\')).toBe('C:\\')
  })

  it('collapses a UNC spelling without eating the share prefix', () => {
    expect(collapseWindows('\\\\server\\share\\a\\..\\b')).toBe('\\\\server\\share\\b')
    expect(collapseWindows('//server/share/x')).toBe('\\\\server\\share\\x')
  })
})

describe('windowsToWsl / posixToWindows', () => {
  it('maps a Windows drive path into the default WSL mount root', () => {
    expect(windowsToWsl('C:\\Users\\someone\\work')).toBe('/mnt/c/Users/someone/work')
    expect(windowsToWsl('D:/data')).toBe('/mnt/d/data')
    expect(windowsToWsl('C:\\')).toBe('/mnt/c')
    expect(windowsToWsl('C:')).toBe('/mnt/c')
  })

  it('honours a remapped WSL automount root', () => {
    expect(windowsToWsl('C:\\Users\\someone', '/windows')).toBe('/windows/c/Users/someone')
  })

  it('refuses a UNC path, which has no reliable WSL mapping', () => {
    expect(windowsToWsl('\\\\server\\share\\x')).toBeUndefined()
  })

  it('maps the WSL and MSYS drive forms back to Windows', () => {
    expect(posixToWindows('/mnt/c/Users/someone')).toBe('C:\\Users\\someone')
    expect(posixToWindows('/mnt/c')).toBe('C:\\')
    expect(posixToWindows('/c/Users/someone')).toBe('C:\\Users\\someone')
  })

  it('leaves an ordinary POSIX path unmapped', () => {
    expect(posixToWindows('/home/someone/work')).toBeUndefined()
    expect(posixToWindows('/mnt/cc/x')).toBeUndefined()
  })
})

describe('isVolumeRootSpelling / isHostVolumeRoot', () => {
  it.each(['/', 'C:', 'C:\\', 'D:/', '\\\\server\\share', '//server/share', '//server/share/'])('rejects %j', spelling => {
    expect(isVolumeRootSpelling(spelling)).toBe(true)
  })

  it.each(['/tmp', '~', 'C:\\tmp', '//', '\\\\server\\share\\x'])('accepts %j', spelling => {
    expect(isVolumeRootSpelling(spelling)).toBe(false)
  })

  it('recognizes the WSL spelling of a drive root on a WSL host only', () => {
    expect(isHostVolumeRoot('/mnt/c', wsl)).toBe(true)
    expect(isHostVolumeRoot('/mnt/c/x', wsl)).toBe(false)
    expect(isHostVolumeRoot('/mnt/c', posix)).toBe(false)
  })
})

describe('expandPath', () => {
  it('expands and resolves on a POSIX host', () => {
    expect(expandPath('~', '/ws', posix)).toMatchObject({ ok: true, path: '/Users/someone' })
    expect(expandPath('~/notes', '/ws', posix)).toMatchObject({ ok: true, path: '/Users/someone/notes' })
    expect(expandPath('/abs/x', '/ws', posix)).toMatchObject({ ok: true, path: '/abs/x' })
    expect(expandPath('../../notes/home', '/work/typescript/proj', posix)).toMatchObject({ ok: true, path: '/work/notes/home' })
    expect(expandPath('~foo', '/ws', posix)).toMatchObject({ ok: true, path: '/ws/~foo' })
  })

  it('marks Windows spellings foreign on a POSIX host (same config, other machine)', () => {
    expect(expandPath('C:\\Users\\someone\\work', '/ws', posix)).toMatchObject({ ok: false })
    expect(expandPath('\\\\server\\share\\x', '/ws', posix)).toMatchObject({ ok: false })
    expect(expandPath('~\\work', '/ws', posix)).toMatchObject({ ok: false })
  })

  it('translates a Windows spelling to /mnt inside WSL', () => {
    expect(expandPath('C:\\Users\\someone\\work', '/ws', wsl)).toMatchObject({ ok: true, path: '/mnt/c/Users/someone/work', translated: true })
    expect(expandPath('C:/Users/someone/work', '/ws', wsl)).toMatchObject({ ok: true, path: '/mnt/c/Users/someone/work' })
    expect(expandPath('\\\\server\\share\\x', '/ws', wsl)).toMatchObject({ ok: false })
  })

  it('keeps native POSIX spellings inside WSL', () => {
    expect(expandPath('/mnt/c/Users/someone', '/ws', wsl)).toMatchObject({ ok: true, path: '/mnt/c/Users/someone', translated: false })
  })

  it('translates WSL/M SYS spellings to a drive on a Windows host, and refuses other POSIX paths', () => {
    expect(expandPath('/mnt/c/Users/someone', '/ws', windows)).toMatchObject({ ok: true, path: 'C:\\Users\\someone', translated: true })
    expect(expandPath('/c/Users/someone', '/ws', windows)).toMatchObject({ ok: true, path: 'C:\\Users\\someone' })
    expect(expandPath('/home/someone', '/ws', windows)).toMatchObject({ ok: false })
  })

  it('keeps native Windows spellings and resolves relative ones on Windows', () => {
    expect(expandPath('C:\\Users\\someone', '/ws', windows)).toMatchObject({ ok: true, path: 'C:\\Users\\someone' })
    expect(expandPath('~\\work', '/ws', windows)).toMatchObject({ ok: true, path: 'C:\\Users\\someone\\work' })
    expect(expandPath('sub\\dir', 'C:\\ws', windows)).toMatchObject({ ok: true, path: 'C:\\ws\\sub\\dir' })
  })

  it('refuses drive-relative spellings everywhere', () => {
    for (const facts of [posix, wsl, windows]) {
      expect(expandPath('C:foo', '/ws', facts)).toMatchObject({ ok: false })
    }
  })
})
