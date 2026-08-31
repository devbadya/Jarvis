import { afterEach, describe, expect, it } from 'vitest'
import {
  anthropicChatBody,
  applyOpenAiToolDelta,
  chatConfig,
  chatPublicInfo,
  eventsFromAnthropicEvent,
  eventsFromOpenAiChunk,
  finalizeToolCalls,
  handleChatRequest,
  mockChatEvents,
  parseToolArguments,
  toAnthropicRequest,
  toAnthropicTools,
  toOpenAiMessages,
} from './agent-chat.ts'
import type { ServerResponse } from 'node:http'

afterEach(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_MODEL
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_MODEL
})

describe('chatConfig', () => {
  it('is off when no key is set', () => {
    expect(chatConfig()).toBeNull()
    expect(chatPublicInfo()).toBeNull()
  })

  it('treats the mock key as a local stand-in', () => {
    process.env.ANTHROPIC_API_KEY = 'mock'
    expect(chatConfig()).toEqual({ provider: 'mock', apiKey: 'mock', baseUrl: '', model: 'mock' })
    expect(chatPublicInfo()).toEqual({ model: 'mock', provider: 'mock' })
  })

  it('prefers Anthropic Opus when that key is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    expect(chatConfig()).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-opus-5',
    })
    expect(chatPublicInfo()).toEqual({ model: 'claude-opus-5', provider: 'anthropic' })
  })

  it('falls back to an OpenAI-compatible host', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    expect(chatConfig()).toEqual({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
  })

  it('accepts Groq or any other OpenAI-compatible host', () => {
    process.env.OPENAI_API_KEY = 'gsk-test'
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1/'
    process.env.OPENAI_MODEL = 'llama-3.3-70b-versatile'
    expect(chatConfig()).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
    })
  })
})

describe('toOpenAiMessages', () => {
  it('keeps roles the chat template already uses', () => {
    expect(
      toOpenAiMessages([
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]),
    ).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ])
  })

  it('turns structured tool calls into the Completions shape', () => {
    expect(
      toOpenAiMessages([
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'calculator', arguments: { expression: '2+2' } }],
        },
        { role: 'tool', content: '2 + 2 = 4', toolCallId: 'call_1' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expression":"2+2"}' },
          },
        ],
      },
      { role: 'tool', content: '2 + 2 = 4', tool_call_id: 'call_1' },
    ])
  })

  it('drops junk rather than 400ing the turn', () => {
    expect(
      toOpenAiMessages([{ role: 'nope', content: 'x' }, 'leave', { role: 'user', content: 'ok' }]),
    ).toEqual([{ role: 'user', content: 'ok' }])
  })
})

describe('parseToolArguments', () => {
  it('parses a JSON object and keeps a bare string', () => {
    expect(parseToolArguments('{"expression":"3*4"}')).toEqual({ expression: '3*4' })
    expect(parseToolArguments('3 * 4')).toEqual({ value: '3 * 4' })
  })
})

describe('eventsFromOpenAiChunk', () => {
  it('streams content deltas and assembles a tool call', () => {
    const buckets = new Map()
    expect(eventsFromOpenAiChunk({ choices: [{ delta: { content: 'Hi' } }] }, buckets)).toEqual([
      { text: 'Hi' },
    ])

    applyOpenAiToolDelta(buckets, [
      { index: 0, id: 'call_9', function: { name: 'web_search', arguments: '{"query":' } },
    ])
    applyOpenAiToolDelta(buckets, [{ index: 0, function: { arguments: '"webgpu"}' } }])
    expect(eventsFromOpenAiChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, buckets)).toEqual(
      [{ tool_calls: [{ id: 'call_9', name: 'web_search', arguments: { query: 'webgpu' } }] }],
    )
  })

  it('surfaces a provider error object', () => {
    expect(eventsFromOpenAiChunk({ error: { message: 'quota' } }, new Map())).toEqual([{ error: 'quota' }])
  })
})

describe('finalizeToolCalls', () => {
  it('skips a bucket that never got a name or id', () => {
    const buckets = new Map([
      [0, { arguments: '{}' }],
      [1, { id: 'call_1', name: 'calculator', arguments: '{"expression":"1+1"}' }],
    ])
    expect(finalizeToolCalls(buckets)).toEqual([
      { id: 'call_1', name: 'calculator', arguments: { expression: '1+1' } },
    ])
  })
})

describe('mockChatEvents', () => {
  const calculator = [{ type: 'function', function: { name: 'calculator' } }]

  it('calls the calculator for an arithmetic question', () => {
    expect(mockChatEvents([{ role: 'user', content: 'What is 12 * 8?' }], calculator)).toEqual([
      { tool_calls: [{ id: 'mock_calc', name: 'calculator', arguments: { expression: '12 * 8' } }] },
    ])
  })

  it('answers from the tool result on the next round', () => {
    const events = mockChatEvents(
      [
        { role: 'user', content: 'What is 12 * 8?' },
        { role: 'tool', content: '12 * 8 = 96' },
      ],
      calculator,
    )
    expect(events[0]).toEqual({ text: '12 * 8 = 96' })
  })

  it('answers in prose when no tool is needed', () => {
    const events = mockChatEvents([{ role: 'user', content: 'Hello' }], [])
    expect(events[0]?.text).toMatch(/search/i)
  })
})

describe('toAnthropicRequest', () => {
  it('lifts the system prompt and turns tool results into user blocks', () => {
    expect(
      toAnthropicRequest([
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: '2+2' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'toolu_1', name: 'calculator', arguments: { expression: '2+2' } }],
        },
        { role: 'tool', content: '4', toolCallId: 'toolu_1' },
      ]),
    ).toEqual({
      system: 'Be brief.',
      messages: [
        { role: 'user', content: '2+2' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'calculator', input: { expression: '2+2' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '4' }],
        },
      ],
    })
  })
})

describe('toAnthropicTools', () => {
  it('rewrites our function schemas into input_schema', () => {
    expect(
      toAnthropicTools([
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Exact arithmetic.',
            parameters: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
          },
        },
      ]),
    ).toEqual([
      {
        name: 'calculator',
        description: 'Exact arithmetic.',
        input_schema: {
          type: 'object',
          properties: { expression: { type: 'string' } },
          required: ['expression'],
        },
      },
    ])
  })
})

describe('eventsFromAnthropicEvent', () => {
  it('streams text and assembles a tool_use block', () => {
    const buckets = new Map()
    expect(
      eventsFromAnthropicEvent(
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        buckets,
      ),
    ).toEqual([{ text: 'Hi' }])

    eventsFromAnthropicEvent(
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_9', name: 'web_search' },
      },
      buckets,
    )
    eventsFromAnthropicEvent(
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"webgpu"}' },
      },
      buckets,
    )
    expect(
      eventsFromAnthropicEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }, buckets),
    ).toEqual([{ tool_calls: [{ id: 'toolu_9', name: 'web_search', arguments: { query: 'webgpu' } }] }])
  })
})

describe('anthropicChatBody', () => {
  it('disables thinking at high effort so rebuilt tool turns stay valid', () => {
    const converted = toAnthropicRequest([{ role: 'user', content: 'Hi' }])
    expect(anthropicChatBody('claude-opus-5', converted, [])).toMatchObject({
      model: 'claude-opus-5',
      stream: true,
      thinking: { type: 'disabled' },
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('is empty when there is nothing to send', () => {
    expect(anthropicChatBody('claude-opus-5', { messages: [] }, [])).toBeNull()
  })
})

function fakeRes(): { res: ServerResponse; body: () => string; status: () => number } {
  const chunks: string[] = []
  const res = {
    statusCode: 0,
    setHeader() {
      return this
    },
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk)
    },
  }
  return {
    res: res as unknown as ServerResponse,
    body: () => chunks.join(''),
    status: () => res.statusCode,
  }
}

describe('handleChatRequest', () => {
  it('refuses chat when no key is configured', async () => {
    const captured = fakeRes()
    await handleChatRequest({ messages: [{ role: 'user', content: 'Hi' }] }, captured.res)
    expect(captured.status()).toBe(503)
    expect(captured.body()).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('streams the mock model without calling a provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'mock'
    const captured = fakeRes()
    await handleChatRequest({ messages: [{ role: 'user', content: 'Hello' }] }, captured.res)
    expect(captured.status()).toBe(200)
    expect(captured.body()).toMatch(/search/i)
  })
})
