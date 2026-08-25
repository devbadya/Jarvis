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

describe('web_search', () => {
  it('tells the model it is searching an encyclopedia when that is what it has', () => {
    const description = (provider: SearchProvider) =>
      createBuiltinTools({ provider }).find((tool) => tool.schema.function.name === 'web_search')!.schema
        .function.description

    expect(description('wikipedia')).toMatch(/Wikipedia/)
    expect(description('wikipedia')).toMatch(/does not cover current events/)
    expect(description('jina')).toMatch(/Search the web/)
    expect(description('duckduckgo')).toMatch(/Search the web/)
    expect(description('langsearch')).toMatch(/Search the web/)
  })
})
