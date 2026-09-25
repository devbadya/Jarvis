import { isHttpUrl } from './mcp'
import { defineTool, type Tool } from './types'
import type { WebAccessConfig } from './web'

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i

/**
 * Where `open` should POST, or undefined when the user has not pointed Jarvis
 * at a device agent on this computer.
 *
 * Anything that is not loopback is ignored. A public URL here would send
 * "open this app" to someone else's server.
 */
export function configuredDeviceBase(config: WebAccessConfig): string | undefined {
  const raw = config.deviceUrl?.trim()
  if (!raw || !isHttpUrl(raw)) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!LOOPBACK.test(url.hostname)) return undefined
    if (url.username || url.password) return undefined
    return raw.replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function createOpenTool(config: WebAccessConfig): Tool | null {
  const base = configuredDeviceBase(config)
  if (!base) return null

  return defineTool(
    'open',
    'Open an app or an http(s) link on the computer running the device agent. Use when the user asks to open or launch something on this computer.',
    {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'App name, such as Safari or Notes, or a full http(s) URL',
        },
      },
      required: ['target'],
    },
    async (args) => {
      const target = String(args.target ?? '').trim()
      if (!target) throw new Error('target must not be empty')
      const response = await fetch(`${base}/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || `device agent answered ${response.status}`)
      }
      const message = payload?.message?.trim()
      if (!message) throw new Error('device agent returned an empty result')
      return message
    },
  )
}
