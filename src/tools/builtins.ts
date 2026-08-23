import { evaluateExpression } from './calculator'
import { defineTool, type Tool } from './types'

interface SearchResponse {
  results?: { title: string; url: string; snippet: string }[]
  error?: string
}

interface FetchResponse {
  url?: string
  title?: string
  text?: string
  error?: string
}

/**
 * `web_search` and `read_page` depend on a proxy: the dev server in
 * development, serverless functions in production. A purely static host such as
 * GitHub Pages has none, and the deploy sets this to an empty string so the two
 * tools are left out of the model's tool list entirely rather than offered and
 * failing on every call.
 */
const API_BASE = import.meta.env.VITE_AGENT_API_BASE ?? '/api'

export const webToolsAvailable = API_BASE !== ''

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`)
  }
  return payload
}

export const webSearch = defineTool(
  'web_search',
  'Search the web and return ranked results with title, URL and snippet. Use for current events, facts you are unsure about, or anything after your training cutoff.',
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      limit: { type: 'integer', description: 'How many results to return (1-10, default 5)' },
    },
    required: ['query'],
  },
  async (args) => {
    const query = String(args.query ?? '').trim()
    if (!query) throw new Error('query must not be empty')
    const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10)
    const { results = [] } = await getJson<SearchResponse>(
      `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    )
    if (results.length === 0) return `No results for "${query}".`
    return results
      .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`)
      .join('\n')
  },
)

export const readPage = defineTool(
  'read_page',
  'Fetch a web page and return its readable text. Use after web_search when a snippet is not enough.',
  {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL of the page' },
    },
    required: ['url'],
  },
  async (args) => {
    const url = String(args.url ?? '').trim()
    if (!url) throw new Error('url must not be empty')
    const page = await getJson<FetchResponse>(`/fetch?url=${encodeURIComponent(url)}`)
    return `# ${page.title}\nSource: ${page.url}\n\n${page.text}`
  },
)

export const calculator = defineTool(
  'calculator',
  'Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses, and sqrt, abs, ln, log, sin, cos, tan, round, floor, ceil, plus the constants pi and e.',
  {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'For example: (17 * 23) / sqrt(2)' },
    },
    required: ['expression'],
  },
  async (args) => {
    const expression = String(args.expression ?? '').trim()
    if (!expression) throw new Error('expression must not be empty')
    return `${expression} = ${evaluateExpression(expression)}`
  },
)

export const currentTime = defineTool(
  'current_time',
  "Return the user's current date, time and timezone. Use whenever the answer depends on today's date.",
  { type: 'object', properties: {} },
  async () => {
    const now = new Date()
    return `${now.toISOString()} (local: ${now.toLocaleString()}, timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`
  },
)

export const builtinTools: Tool[] = webToolsAvailable
  ? [webSearch, readPage, calculator, currentTime]
  : [calculator, currentTime]
