import { describe, expect, it } from 'vitest'
import { isHttpUrl } from './mcp'

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
