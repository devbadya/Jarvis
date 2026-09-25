import { describe, expect, it, vi, afterEach } from 'vitest'
import { openSeed, openTarget, settleOpen } from '@/agent/device'
import { groundingFor } from '@/agent/ground'
import { createBuiltinTools } from './builtins'
import { configuredDeviceBase, createOpenTool } from './device'
import { DEFAULT_WEB_ACCESS } from './web'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('configuredDeviceBase', () => {
  it('keeps a loopback origin and ignores anything else', () => {
    expect(configuredDeviceBase({ ...DEFAULT_WEB_ACCESS, deviceUrl: 'http://127.0.0.1:8791/' })).toBe(
      'http://127.0.0.1:8791',
    )
    expect(configuredDeviceBase({ ...DEFAULT_WEB_ACCESS, deviceUrl: 'http://localhost:8791' })).toBe(
      'http://localhost:8791',
    )
    expect(configuredDeviceBase({ ...DEFAULT_WEB_ACCESS, deviceUrl: 'https://example.com' })).toBeUndefined()
    expect(configuredDeviceBase({ ...DEFAULT_WEB_ACCESS, deviceUrl: '127.0.0.1:8791' })).toBeUndefined()
  })
})

describe('createBuiltinTools', () => {
  it('omits open until a device agent is configured', () => {
    const names = (url?: string) =>
      createBuiltinTools({ ...DEFAULT_WEB_ACCESS, ...(url ? { deviceUrl: url } : {}) }).map(
        (tool) => tool.schema.function.name,
      )
    expect(names()).not.toContain('open')
    expect(names('https://example.com')).not.toContain('open')
    expect(names('http://127.0.0.1:8791')).toContain('open')
  })
})

describe('createOpenTool', () => {
  it('posts the target and returns the agent message', async () => {
    const tool = createOpenTool({ ...DEFAULT_WEB_ACCESS, deviceUrl: 'http://127.0.0.1:8791' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'Opened Safari' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(tool!.execute({ target: 'Safari' })).resolves.toBe('Opened Safari')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8791/open',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ target: 'Safari' }) }),
    )
  })

  it('throws when the agent refuses', async () => {
    const tool = createOpenTool({ ...DEFAULT_WEB_ACCESS, deviceUrl: 'http://127.0.0.1:8791' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'app name contains a character that is not allowed' }),
      }),
    )
    await expect(tool!.execute({ target: 'Notes & calc' })).rejects.toThrow(/not allowed/)
  })
})

describe('openTarget', () => {
  it('reads the app or link out of an imperative', () => {
    expect(openTarget('Open Safari.')).toBe('Safari')
    expect(openTarget('Please open the Notes app')).toBe('Notes')
    expect(openTarget('Öffne https://example.com')).toBe('https://example.com')
    expect(openTarget('Open source is a license')).toBeNull()
    expect(openTarget('What is open source?')).toBeNull()
  })
})

describe('open grounding', () => {
  const tools = createBuiltinTools({ ...DEFAULT_WEB_ACCESS, deviceUrl: 'http://127.0.0.1:8791' })
  const activation = {
    skill: { name: 'open-device' },
    tools,
  }

  it('seeds open and answers from the tool line', () => {
    expect(openSeed(activation, 'Open Safari.')).toEqual({ name: 'open', arguments: { target: 'Safari' } })
    expect(openSeed({ skill: { name: 'calendar' }, tools }, 'Open Safari.')).toBeNull()
    const grounded = groundingFor(activation, 'Open Safari.')
    expect(grounded.groundOpen).toBe(true)
    expect(grounded.seed).toEqual([{ name: 'open', arguments: { target: 'Safari' } }])
    expect(
      settleOpen({ toolResults: [{ tool: 'open', result: 'Opened Safari' }], knownUrls: [] }, 'Open Safari.'),
    ).toBe('Opened Safari.')
  })
})
