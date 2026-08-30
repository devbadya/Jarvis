import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinTools } from './builtins'
import { DEFAULT_WEB_ACCESS, type SearchProvider } from './web'

function toolNamed(name: string) {
  const tool = createBuiltinTools(DEFAULT_WEB_ACCESS).find(
    (candidate) => candidate.schema.function.name === name,
  )
  if (!tool) throw new Error(`No such built-in tool: ${name}`)
  return tool
}

function stubReader(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { title: 'Long', url: 'https://example.com/', content } }),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('read_page', () => {
  // Long tool results measurably degrade function calling, so the cap is a
  // property of the tool rather than an incidental detail of the reader.
  it('caps a long page and says that it did', async () => {
    stubReader('x'.repeat(20_000))

    const result = await toolNamed('read_page').execute({ url: 'https://example.com' })

    expect(result).toContain('[Truncated: the page continues beyond this point.]')
    expect(result.length).toBeLessThan(8_200)
  })

  it('leaves a short page whole', async () => {
    stubReader('Short body.')

    const result = await toolNamed('read_page').execute({ url: 'https://example.com' })

    expect(result).toBe('# Long\nSource: https://example.com/\n\nShort body.')
  })
})

describe('weather', () => {
  it('refuses an empty place without asking any provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(toolNamed('weather').execute({ place: '   ' })).rejects.toThrow('place must not be empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('current_time', () => {
  it('reads the local clock without a lookup when no place is given', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await toolNamed('current_time').execute({})

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatch(/^\d{2}:\d{2} /)
    expect(result).not.toMatch(/instant|\d{4}-\d{2}-\d{2}T/)
  })

  it('refuses to invent a place that cannot be geocoded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      })),
    )

    await expect(toolNamed('current_time').execute({ place: 'Narnia' })).rejects.toThrow(
      /No place called "Narnia"/,
    )
  })
})

describe('web_search', () => {
  it('tells the model it is searching an encyclopedia when that is what it has', () => {
    const description = (provider: SearchProvider) =>
      createBuiltinTools({ provider }).find((tool) => tool.schema.function.name === 'web_search')!.schema
        .function.description

    expect(description('wikipedia')).toMatch(/Wikipedia/)
    expect(description('wikipedia')).toMatch(/does not cover current events/)
    expect(description('wikipedia')).toMatch(/German Wikipedia/)
    expect(description('jina')).toMatch(/Search the web/)
    expect(description('duckduckgo')).toMatch(/Search the web/)
    expect(description('langsearch')).toMatch(/Search the web/)
  })

  it('refuses an empty research query without asking the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const tool = createBuiltinTools(DEFAULT_WEB_ACCESS).find(
      (candidate) => candidate.schema.function.name === 'research',
    )!
    await expect(tool.execute({ query: '  ' })).rejects.toThrow('query must not be empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stamps today on the results so a current-events answer has a date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T15:00:00'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          query: {
            pages: {
              '1': {
                pageid: 1,
                title: 'WebGPU',
                index: 1,
                extract: 'A GPU API.',
                fullurl: 'https://en.wikipedia.org/wiki/WebGPU',
              },
            },
          },
        }),
      })),
    )

    const tool = createBuiltinTools({ provider: 'wikipedia' }).find(
      (candidate) => candidate.schema.function.name === 'web_search',
    )!
    const result = await tool.execute({ query: 'webgpu' })

    expect(result).toMatch(/^Searched 2026-08-26 for "webgpu"/)
    expect(result).toContain('https://en.wikipedia.org/wiki/WebGPU')
    vi.useRealTimers()
  })

  it('still stamps the date when nothing matched', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T15:00:00'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ batchcomplete: '' }),
      })),
    )

    const tool = createBuiltinTools({ provider: 'wikipedia' }).find(
      (candidate) => candidate.schema.function.name === 'web_search',
    )!
    expect(await tool.execute({ query: 'zzzz' })).toBe('Searched 2026-08-26 for "zzzz". No results.')
    vi.useRealTimers()
  })
})
