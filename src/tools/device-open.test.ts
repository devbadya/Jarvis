import { describe, expect, it } from 'vitest'
import { planOpen, parseOpenTarget } from './device-open'

describe('parseOpenTarget', () => {
  it('accepts an https link and drops a username', () => {
    expect(parseOpenTarget('https://example.com/docs')).toEqual({
      kind: 'url',
      url: 'https://example.com/docs',
    })
    expect(() => parseOpenTarget('https://user:secret@example.com')).toThrow(/password/)
    expect(() => parseOpenTarget('file:///etc/passwd')).toThrow(/http and https/)
    expect(() => parseOpenTarget('javascript:alert(1)')).toThrow(/http and https/)
  })

  it('accepts an app name and refuses shell metacharacters', () => {
    expect(parseOpenTarget('Google Chrome')).toEqual({ kind: 'app', name: 'Google Chrome' })
    expect(() => parseOpenTarget('Notes & calc')).toThrow(/not allowed/)
    expect(() => parseOpenTarget('-rf')).toThrow(/not allowed/)
    expect(() => parseOpenTarget('Notes\ncalc')).toThrow(/single line/)
    expect(() => parseOpenTarget('')).toThrow(/empty/)
  })
})

describe('planOpen', () => {
  const url = { kind: 'url' as const, url: 'https://example.com/' }
  const app = { kind: 'app' as const, name: 'Safari' }

  it('opens links without a shell', () => {
    expect(planOpen(url, 'darwin')).toEqual({ file: 'open', args: ['https://example.com/'] })
    expect(planOpen(url, 'win32').file).toBe('rundll32.exe')
    expect(planOpen(url, 'linux')).toEqual({ file: 'xdg-open', args: ['https://example.com/'] })
  })

  it('opens apps by argv, and keeps the Windows name out of the script', () => {
    expect(planOpen(app, 'darwin')).toEqual({ file: 'open', args: ['-a', 'Safari'] })
    const windows = planOpen(app, 'win32')
    expect(windows.args.join(' ')).not.toContain('Safari')
    expect(windows.env).toEqual({ JARVIS_OPEN_TARGET: 'Safari' })
    expect(planOpen({ kind: 'app', name: 'Visual Studio Code' }, 'linux')).toEqual({
      file: 'gtk-launch',
      args: ['visual-studio-code'],
    })
  })
})
