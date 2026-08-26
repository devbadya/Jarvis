import { evaluateExpression } from './calculator'
import { pageExtract } from './extract'
import { memory } from './memory'
import { defineTool, type Tool } from './types'
import { convertQuantity } from './units'
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
    // The question comes from the agent loop rather than from the model: what
    // part of a long page is worth the context is decided in `extract.ts`, and
    // asking the model for it would spend a tool argument on something already
    // known. Without one, a page too long to fit falls back to its head.
    async (args, context) => {
      const url = String(args.url ?? '').trim()
      if (!url) throw new Error('url must not be empty')
      const page = await readPage(url, config)
      return `# ${page.title}\nSource: ${page.url}\n\n${pageExtract(page.text, context?.question ?? '')}`
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

/**
 * The one thing on this list the model was previously left to do in its head.
 * A conversion is not arithmetic, so the calculator refuses it, and searching
 * for it verbatim answers nothing — see `src/tools/units.ts`.
 */
export const convert = defineTool(
  'convert',
  'Convert a quantity into different units: length, mass, temperature, volume, speed, area, data or duration. Use whenever the user asks what something is in other units.',
  {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'The number to convert. For example: 32' },
      from: { type: 'string', description: 'The unit it is given in. For example: fahrenheit' },
      to: { type: 'string', description: 'The unit it is wanted in. For example: celsius' },
    },
    required: ['value', 'from', 'to'],
  },
  async (args) => convertQuantity(args),
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
 * `memory` is the exception, and is left out entirely when the user has turned
 * memory off. Offering a tool that then refuses would spend a tool round to
 * arrive at nothing, and would put the word "remember" in a prompt from someone
 * who asked not to be remembered.
 */
export function createBuiltinTools(config: WebAccessConfig, options: { memory?: boolean } = {}): Tool[] {
  const tools = [createWebSearch(config), createReadPage(config), calculator, convert, currentTime, weather]
  return options.memory === false ? tools : [...tools, memory]
}

/** The set as configured out of the box, for callers with no user settings to hand. */
export const builtinTools: Tool[] = createBuiltinTools(DEFAULT_WEB_ACCESS)
