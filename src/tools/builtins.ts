import { evaluateExpression } from './calculator'
import { clockReading } from './clock'
import { memory } from './memory'
import { researchQuestion } from './research'
import { defineTool, type Tool } from './types'
import { DEFAULT_WEB_ACCESS, readPage, searchWeb, type SearchProvider, type WebAccessConfig } from './web'
import { weatherReport } from './weather'

/**
 * Wikipedia and a general search engine are different instruments, and a 0.8B
 * model will not infer the difference. Saying which one it has stops it asking
 * an encyclopedia about this morning's news.
 */
function searchDescription(provider: SearchProvider): string {
  if (provider === 'wikipedia') {
    return 'Search Wikipedia and return matching articles with a summary of each. Use for facts, definitions, people, places, science and history. It does not cover current events or recent news. German questions are searched on German Wikipedia.'
  }
  return 'Search the web and return ranked results with title, URL and snippet. Use for current events, facts you are unsure about, or anything after your training cutoff.'
}

/** Local calendar date, so "today's news" is dated in the user's timezone rather than UTC. */
function todayStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function formatSearchResults(
  query: string,
  results: { title: string; url: string; snippet: string }[],
): string {
  const heading = `Searched ${todayStamp()} for "${query}".`
  if (results.length === 0) return `${heading} No results.`
  return `${heading}\n\n${results
    .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`)
    .join('\n')}`
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
      return formatSearchResults(query, results)
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

export const weather = defineTool(
  'weather',
  'Return the current weather and a three-day outlook for a place, in metric units, reconciled across several forecast services. Use for any question about the weather, the temperature, rain or a forecast.',
  {
    type: 'object',
    properties: {
      place: { type: 'string', description: 'Town, city or region. For example: Berlin' },
    },
    required: ['place'],
  },
  async (args) => {
    const place = String(args.place ?? '').trim()
    if (!place) throw new Error('place must not be empty')
    return weatherReport(place)
  },
)

export const currentTime = defineTool(
  'current_time',
  'Return the current date and time for a place, or for the user when no place is given. Use whenever the answer depends on the time or date now.',
  {
    type: 'object',
    properties: {
      place: {
        type: 'string',
        description: "City, country or timezone. For example: Berlin. Omit for the user's own clock.",
      },
    },
  },
  async (args) => clockReading(String(args.place ?? '').trim()),
)

function createResearch(config: WebAccessConfig): Tool {
  return defineTool(
    'research',
    'Search the web, read the three most independent results and return quoted passages from each. Use for current events, people, organisations, facts you would otherwise be guessing at, or any question whose answer can be looked up.',
    {
      type: 'object',
      properties: { query: { type: 'string', description: 'The question to research' } },
      required: ['query'],
    },
    async (args) => {
      const query = String(args.query ?? '').trim()
      if (!query) throw new Error('query must not be empty')
      return researchQuestion(query, config)
    },
  )
}

/**
 * The network tools close over the current provider settings, so they are
 * rebuilt when those change. Every tool ships in every deployment: none of them
 * needs a server, so a static host is not a reason to withhold one. DuckDuckGo
 * search and page reads use a proxy when one is configured, and the reader when
 * one is not.
 *
 * `memory` is the exception, and is left out entirely when the user has turned
 * memory off. Offering a tool that then refuses would spend a tool round to
 * arrive at nothing, and would put the word "remember" in a prompt from someone
 * who asked not to be remembered.
 */
export function createBuiltinTools(config: WebAccessConfig, options: { memory?: boolean } = {}): Tool[] {
  const tools = [
    createWebSearch(config),
    createReadPage(config),
    createResearch(config),
    calculator,
    currentTime,
    weather,
  ]
  return options.memory === false ? tools : [...tools, memory]
}

/** The set as configured out of the box, for callers with no user settings to hand. */
export const builtinTools: Tool[] = createBuiltinTools(DEFAULT_WEB_ACCESS)
