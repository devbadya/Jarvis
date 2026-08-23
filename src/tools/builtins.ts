import { evaluateExpression } from './calculator'
import { defineTool, type Tool } from './types'
import { DEFAULT_WEB_ACCESS, readPage, searchWeb, type SearchProvider, type WebAccessConfig } from './web'

/**
 * Wikipedia and a general search engine are different instruments, and a 0.8B
 * model will not infer the difference. Saying which one it has stops it asking
 * an encyclopedia about this morning's news.
 */
function searchDescription(provider: SearchProvider): string {
  if (provider === 'wikipedia') {
    return 'Search Wikipedia and return matching articles with a summary of each. Use for facts, definitions, people, places, science and history. It does not cover current events or recent news.'
  }
  return 'Search the web and return ranked results with title, URL and snippet. Use for current events, facts you are unsure about, or anything after your training cutoff.'
}

function createWebSearch(config: WebAccessConfig): Tool {
  return defineTool(
    'web_search',
    searchDescription(config.provider),
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
      const results = await searchWeb(query, limit, config)
      if (results.length === 0) return `No results for "${query}".`
      return results
        .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`)
        .join('\n')
    },
  )
}

/**
 * Tool results are fed straight back into the context, and long ones are not a
 * neutral cost: measured across several models, function-calling accuracy falls
 * by between 7% and 91% as tool responses grow (arXiv:2505.10570). An unbounded
 * page would be by far the largest thing in a 0.8B model's context.
 *
 * Roughly 2,000 tokens, which leaves room for the prompt and the answer.
 */
const MAX_PAGE_CHARS = 8000

function truncate(text: string): string {
  if (text.length <= MAX_PAGE_CHARS) return text
  return `${text.slice(0, MAX_PAGE_CHARS)}\n\n[Truncated: the page continues beyond this point.]`
}

function createReadPage(config: WebAccessConfig): Tool {
  return defineTool(
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
      const page = await readPage(url, config)
      return `# ${page.title}\nSource: ${page.url}\n\n${truncate(page.text)}`
    },
  )
}

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

/**
 * The network tools close over the current provider settings, so they are
 * rebuilt when those change. Every tool ships in every deployment: none of them
 * needs a server, so a static host is no longer a reason to withhold one.
 */
export function createBuiltinTools(config: WebAccessConfig): Tool[] {
  return [createWebSearch(config), createReadPage(config), calculator, currentTime]
}

/** The set as configured out of the box, for callers with no user settings to hand. */
export const builtinTools: Tool[] = createBuiltinTools(DEFAULT_WEB_ACCESS)
