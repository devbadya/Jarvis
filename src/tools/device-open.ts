/**
 * What `pnpm device` is willing to launch, decided before any process starts.
 *
 * The agent binds to loopback and still must not grow a shell. A target is
 * either an http(s) URL or an application name, and the command is an argv
 * array. Windows never sees the name inside `cmd /c`, because `cmd` would
 * parse `&` out of a string we had already checked.
 */

export type OpenTarget = { kind: 'url'; url: string } | { kind: 'app'; name: string }

export interface OpenPlan {
  file: string
  args: string[]
  /** Set on Windows app launches so the name never enters the PowerShell script. */
  env?: Record<string, string>
}

const MAX_URL_LENGTH = 2000
const MAX_APP_LENGTH = 80

/** Letters, digits, spaces and the punctuation real app names use. No shell metacharacters. */
const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .+'’-]*$/u

export function parseOpenTarget(raw: string): OpenTarget {
  const target = raw.trim()
  if (!target) throw new Error('target must not be empty')
  if (/[\r\n]/.test(target)) throw new Error('target must be a single line')

  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    if (target.length > MAX_URL_LENGTH) throw new Error('url is too long')
    let url: URL
    try {
      url = new URL(target)
    } catch {
      throw new Error('url is not a valid address')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('only http and https links can be opened')
    }
    if (url.username || url.password) throw new Error('links with a username or password are refused')
    return { kind: 'url', url: url.toString() }
  }

  if (target.length > MAX_APP_LENGTH) throw new Error('app name is too long')
  if (target.startsWith('-') || target.startsWith('.')) throw new Error('app name is not allowed')
  if (!APP_NAME.test(target)) throw new Error('app name contains a character that is not allowed')
  return { kind: 'app', name: target }
}

/** Argv for this platform. `platform` is injectable so tests never spawn a process. */
export function planOpen(target: OpenTarget, platform: NodeJS.Platform): OpenPlan {
  if (target.kind === 'url') {
    if (platform === 'darwin') return { file: 'open', args: [target.url] }
    if (platform === 'win32')
      return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', target.url] }
    return { file: 'xdg-open', args: [target.url] }
  }

  if (platform === 'darwin') return { file: 'open', args: ['-a', target.name] }
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:JARVIS_OPEN_TARGET'],
      env: { JARVIS_OPEN_TARGET: target.name },
    }
  }
  const desktop = target.name.toLowerCase().replace(/\s+/g, '-')
  return { file: 'gtk-launch', args: [desktop] }
}
