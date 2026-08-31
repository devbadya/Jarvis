import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventFromSseFrame, HostedLlmClient, probeHostedChat, readChatSse } from './hosted'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('probeHostedChat', () => {
  it('is off when no proxy is configured', async () => {
    vi.stubEnv('VITE_AGENT_API_BASE', '')
    await expect(probeHostedChat({ provider: 'duckduckgo' })).resolves.toBeNull()
  })

  it('reads the model name from health', async () => {
    vi.stubEnv('VITE_AGENT_API_BASE', 'https://proxy.example')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, chat: { model: 'gpt-4o-mini' } }))),
    )
    await expect(probeHostedChat({ provider: 'duckduckgo' })).resolves.toEqual({
      base: 'https://proxy.example',
      model: 'gpt-4o-mini',
    })
  })

  it('treats a healthy proxy without chat as on-device', async () => {
    vi.stubEnv('VITE_AGENT_API_BASE', 'https://proxy.example')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    )
    await expect(probeHostedChat({ provider: 'duckduckgo' })).resolves.toBeNull()
  })
})

describe('eventFromSseFrame', () => {
  it('reads a data line and ignores done', () => {
    expect(eventFromSseFrame('data: {"text":"Hi"}')).toEqual({ text: 'Hi' })
    expect(eventFromSseFrame('data: [DONE]')).toBeNull()
  })
})

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(frames.join(''))
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('HostedLlmClient', () => {
  it('streams text and returns native tool calls', async () => {
    const frames = [
      'data: {"text":"Let me calculate."}\n\n',
      'data: {"tool_calls":[{"id":"c1","name":"calculator","arguments":{"expression":"2+2"}}]}\n\n',
      'data: {"usage":{"completion_tokens":8}}\n\n',
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sseBody(frames), { headers: { 'content-type': 'text/event-stream' } })),
    )
    const chunks: string[] = []
    const client = new HostedLlmClient('https://proxy.example')
    const result = await client.generate([{ role: 'user', content: '2+2' }], [], {
      onChunk: (text) => chunks.push(text),
    })
    expect(chunks).toEqual(['Let me calculate.'])
    expect(result.text).toBe('Let me calculate.')
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'calculator', arguments: { expression: '2+2' } }])
    expect(result.tokens).toBe(8)
  })

  it('raises the proxy error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'quota' }), { status: 502 })),
    )
    const client = new HostedLlmClient('https://proxy.example')
    await expect(
      client.generate([{ role: 'user', content: 'hi' }], [], { onChunk: () => undefined }),
    ).rejects.toThrow('quota')
  })
})

describe('readChatSse', () => {
  it('yields events as frames arrive', async () => {
    const stream = sseBody(['data: {"text":"A"}\n\n', 'data: {"text":"B"}\n\n'])
    const events = []
    for await (const event of readChatSse(stream)) events.push(event)
    expect(events).toEqual([{ text: 'A' }, { text: 'B' }])
  })
})
