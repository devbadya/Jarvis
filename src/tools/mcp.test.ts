import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_PAGE_CHARS } from './extract'
import { isHttpUrl, McpClient } from './mcp'

describe('isHttpUrl', () => {
  it('accepts the addresses fetch can reach', () => {
    expect(isHttpUrl('https://host/mcp')).toBe(true)
    expect(isHttpUrl('http://localhost:3000/mcp')).toBe(true)
  })

  it('rejects a host with no scheme, which is the usual mistake', () => {
    expect(isHttpUrl('localhost:3000/mcp')).toBe(false)
    expect(isHttpUrl('host/mcp')).toBe(false)
  })

  it('rejects schemes the transport cannot speak', () => {
    expect(isHttpUrl('ws://host/mcp')).toBe(false)
    expect(isHttpUrl('file:///tmp/mcp')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects nothing at all', () => {
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('callTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function serverReturning(text: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ text }] } }),
      })),
    )
  }

  const client = new McpClient({ id: 'server', url: 'https://host/mcp' })

  it('passes a compact result straight through', async () => {
    serverReturning('42')

    await expect(client.callTool('answer', {})).resolves.toBe('42')
  })

  it('caps a result that would take the whole prompt', async () => {
    // Nothing capped this before, so one verbose server could spend the context
    // the answer needed — the same cost `read_page` has always been capped for.
    serverReturning('x'.repeat(MAX_PAGE_CHARS * 3))

    const result = await client.callTool('firehose', {})

    expect(result.length).toBeLessThan(MAX_PAGE_CHARS + 100)
    expect(result).toContain('[Truncated')
  })
})
