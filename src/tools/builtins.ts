import { evaluateExpression } from './calculator'
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

/**
 * The same distinction `searchDescription` draws, for the same reason: told it
 * has the whole web, the model asks this for the morning's news, and under the
 * Wikipedia provider every source it gets back is an encyclopedia article.
 */
function researchDescription(provider: SearchProvider): string {
  if (provider === 'wikipedia') {
    return 'Research a question across several Wikipedia articles at once and return quoted passages with the URL each came from. Use for facts, definitions, people, places and history; it does not cover current events.'
  }
  return 'Research a question across several independent web sources at once and return quoted passages with the URL each came from. Use for current events, people, organisations, prices, and anything where one source is not enough.'
}

/**
 * One call for a whole question, rather than a search the model then has to
 * follow up. The fan-out and the narrowing both happen in `research.ts`; what
 * arrives here is already short enough to hand to the model whole.
 */
function createResearch(config: WebAccessConfig): Tool {
  return defineTool(
    'research',
    researchDescription(config.provider),
    {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to research, in the words it was asked in' },
      },
      required: ['question'],
    },
    async (args) => {
      const question = String(args.question ?? '').trim()
      if (!question) throw new Error('question must not be empty')
      return researchQuestion(question, config)
    },
  )
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
 *
 * `research` and `web_search` overlap on purpose, and the difference is cost.
 * One search is a single request through the reader; a research call is six, out
 * of the twenty a minute the keyless tier allows. So a question that wants
 * corroboration gets `research` and a term that wants a definition gets
 * `web_search`, and which one a turn sees is decided by the skill that routes it
 * rather than by the model weighing that up for itself.
 *
 * `memory` is the exception, and is left out entirely when the user has turned
 * memory off. Offering a tool that then refuses would spend a tool round to
 * arrive at nothing, and would put the word "remember" in a prompt from someone
 * who asked not to be remembered.
 */
export function createBuiltinTools(config: WebAccessConfig, options: { memory?: boolean } = {}): Tool[] {
  const tools = [
    createResearch(config),
    createWebSearch(config),
    createReadPage(config),
    calculator,
    currentTime,
    weather,
  ]
  return options.memory === false ? tools : [...tools, memory]
}

/** The set as configured out of the box, for callers with no user settings to hand. */
export const builtinTools: Tool[] = createBuiltinTools(DEFAULT_WEB_ACCESS)
