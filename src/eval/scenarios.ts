/**
 * What "working" means, written down.
 *
 * The README has long carried numbers like "called the calculator for
 * 98765 * 4321 five times out of ten". Those runs were manual, so every change
 * to the prompt or the reasoning budget was a bet nobody could settle. These
 * scenarios turn that into something repeatable.
 *
 * Each case fixes two things independently: which tool the model should reach
 * for, and whether the final answer is right. They fail apart often — the model
 * calls the calculator and then paraphrases the result wrongly, or answers
 * correctly from memory without the tool — and a single pass/fail would hide
 * exactly the distinction that matters when tuning a small model.
 */

export type Category = 'arithmetic' | 'time' | 'recall' | 'memory' | 'no-tool' | 'web' | 'lookup' | 'weather'

export interface Invocation {
  name: string
  arguments: Record<string, unknown>
}

export interface Scenario {
  id: string
  category: Category
  /** Turns that precede the one under test, for multi-turn cases. */
  history?: { role: 'user' | 'assistant'; content: string }[]
  prompt: string
  /** The tool this needs. `null` means the model should answer unaided. */
  expectTool: string | null
  accept: (answer: string) => boolean
  /**
   * Optional check on the arguments the model passed.
   *
   * Reaching for the right tool with the wrong arguments is its own failure, and
   * one the tool name alone cannot see: a search for the correct term and a
   * search for a term the model rewrote both register as `web_search`.
   */
  acceptCall?: (calls: Invocation[]) => boolean
  /**
   * Requires a working network, and a `web_search` provider that can answer it.
   * The default provider is Wikipedia, so a scenario about current events needs
   * a key configured under Tools → Web access before it can pass.
   */
  online?: boolean
}

function searchQuery(calls: Invocation[]): string | null {
  const search = calls.find((call) => call.name === 'web_search')
  return search ? String(search.arguments.query ?? '') : null
}

/**
 * Passes when the place survived into the search query.
 *
 * A search for bare `weather` is answerable about nowhere, so dropping the
 * location is a failure the tool name cannot see.
 */
function searchesFor(place: string): (calls: Invocation[]) => boolean {
  return (calls) => searchQuery(calls)?.toLowerCase().includes(place.toLowerCase()) === true
}

/**
 * Passes when the term reached the search engine intact.
 *
 * The observed failure was a query for `1 inch to measurement in centimeters`:
 * the model split the token and invented a unit-conversion intent, so the
 * results could never tell it that 1inch is a project.
 */
function keepsTermIntact(term: string): (calls: Invocation[]) => boolean {
  const intact = term.toLowerCase()
  const split = new RegExp(`\\b${intact.replace(/(\d+)/g, '$1\\s+')}\\b`)
  return (calls) => {
    const query = searchQuery(calls)?.toLowerCase()
    return query !== null && query !== undefined && query.includes(intact) && !split.test(query)
  }
}

/**
 * The command the model asked `memory` for, normalised the way the tool does.
 *
 * Which command it picked is the whole question for these: calling `memory` to
 * answer "remember that…" and then listing instead of saving is a failure the
 * tool name cannot see.
 */
function memoryCommand(calls: Invocation[]): string | null {
  const call = calls.find((entry) => entry.name === 'memory')
  return call ? String(call.arguments.command ?? '').toLowerCase() : null
}

/**
 * Digits only, so `426,763,565` and `426763565` both match. Model output puts
 * separators in unpredictable places and that is not what is being tested.
 */
function hasNumber(answer: string, expected: string): boolean {
  return answer.replace(/[,\s_]/g, '').includes(expected)
}

function matches(pattern: RegExp): (answer: string) => boolean {
  return (answer) => pattern.test(answer)
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'arith-large-product',
    category: 'arithmetic',
    prompt: 'What is 98765 * 4321?',
    expectTool: 'calculator',
    accept: (answer) => hasNumber(answer, '426763565'),
  },
  {
    id: 'arith-mixed-precedence',
    category: 'arithmetic',
    prompt: 'Work out (17 * 23) / 4 exactly.',
    expectTool: 'calculator',
    accept: (answer) => hasNumber(answer, '97.75'),
  },
  {
    id: 'arith-percentage',
    category: 'arithmetic',
    prompt: 'How much is 18 percent of 2450?',
    expectTool: 'calculator',
    accept: (answer) => hasNumber(answer, '441'),
  },
  {
    id: 'arith-power',
    category: 'arithmetic',
    prompt: 'What is 2 to the power of 20?',
    expectTool: 'calculator',
    accept: (answer) => hasNumber(answer, '1048576'),
  },
  {
    id: 'time-current-year',
    category: 'time',
    prompt: 'What year is it right now?',
    expectTool: 'current_time',
    accept: matches(new RegExp(String(new Date().getFullYear()))),
  },
  {
    id: 'recall-favourite-colour',
    category: 'recall',
    history: [
      { role: 'user', content: 'My favourite colour is teal.' },
      { role: 'assistant', content: 'Noted — teal it is.' },
    ],
    prompt: 'What is my favourite colour?',
    expectTool: null,
    accept: matches(/teal/i),
  },
  /**
   * These two write to the real memory store, the same way the web scenarios
   * make real requests. What they leave behind is one obviously synthetic line
   * that the Memory panel lists and can delete.
   */
  {
    id: 'memory-save',
    category: 'memory',
    prompt: 'Remember that I prefer metric units.',
    expectTool: 'memory',
    acceptCall: (calls) => {
      const call = calls.find((entry) => entry.name === 'memory')
      const saved = ['save', 'remember', 'add', 'store', 'create', 'set', 'write']
      return (
        saved.includes(memoryCommand(calls) ?? '') &&
        String(call?.arguments.text ?? '')
          .toLowerCase()
          .includes('metric')
      )
    },
    accept: matches(/noted|remember|got it|will do|metric|okay|ok\b|sure/i),
  },
  {
    id: 'memory-list',
    category: 'memory',
    prompt: 'What do you know about me?',
    expectTool: 'memory',
    // Reading is the easy half — the failure to catch is the model answering
    // from the conversation it can see, which scores as no tool call at all.
    acceptCall: (calls) =>
      ['list', 'recall', 'search', 'get', 'read', 'show', 'view'].includes(memoryCommand(calls) ?? ''),
    accept: (answer) => answer.trim().length > 10,
  },
  {
    id: 'no-tool-capital',
    category: 'no-tool',
    prompt: 'What is the capital of France?',
    expectTool: null,
    accept: matches(/paris/i),
  },
  {
    id: 'no-tool-haiku',
    category: 'no-tool',
    prompt: 'Write a two-line rhyme about rain.',
    expectTool: null,
    // Only that it wrote something rather than reaching for a tool.
    accept: (answer) => answer.trim().length > 10,
  },
  {
    id: 'web-current-event',
    category: 'web',
    prompt: 'Who is the current secretary-general of the United Nations?',
    expectTool: 'web_search',
    accept: matches(/guterres/i),
    // The hardest of these under the default provider: Wikipedia's lead extract
    // describes the office and never names the incumbent, so passing needs a
    // follow-up `read_page` — the article does name him — or a keyed provider.
    online: true,
  },
  {
    id: 'lookup-digit-name',
    category: 'lookup',
    prompt: 'What is 1inch?',
    expectTool: 'web_search',
    acceptCall: keepsTermIntact('1inch'),
    accept: matches(/aggregat|dex|decentrali[sz]|exchange|defi|protocol|swap/i),
    online: true,
  },
  {
    id: 'lookup-mixed-name',
    category: 'lookup',
    prompt: 'What is 3Blue1Brown?',
    expectTool: 'web_search',
    acceptCall: keepsTermIntact('3blue1brown'),
    accept: matches(/math|youtube|channel|animat|video/i),
    online: true,
  },
  {
    id: 'lookup-plain-name',
    category: 'lookup',
    prompt: 'What is Stripe?',
    expectTool: 'web_search',
    // A single word is a name, not a description: nothing should be added to it.
    acceptCall: (calls) => searchQuery(calls)?.trim().toLowerCase() === 'stripe',
    accept: matches(/payment|checkout|billing|fintech/i),
    online: true,
  },
  {
    id: 'weather-current-conditions',
    category: 'weather',
    prompt: 'What is the weather in Berlin right now?',
    expectTool: 'web_search',
    acceptCall: searchesFor('Berlin'),
    // Today's figures cannot be pinned down here, so this asks only that the
    // answer carries a reading rather than a hedge about not knowing.
    accept: matches(
      /-?\d+\s*(°|degrees|celsius|fahrenheit)|\b(rain|snow|cloud|sunny|clear|wind|humid|fog|storm)/i,
    ),
    // Wikipedia has an article on Berlin's climate and nothing on this morning,
    // so this needs a keyed provider rather than merely a network.
    online: true,
  },
  {
    id: 'weather-forecast',
    category: 'weather',
    prompt: 'Will it rain in Lisbon tomorrow?',
    expectTool: 'web_search',
    acceptCall: searchesFor('Lisbon'),
    accept: matches(/\b(yes|no|rain|shower|dry|cloud|sun|storm)/i),
    online: true,
  },
]

export function selectScenarios(options: { categories?: Category[]; includeOnline?: boolean }): Scenario[] {
  return SCENARIOS.filter((scenario) => {
    if (!options.includeOnline && scenario.online) return false
    if (options.categories && !options.categories.includes(scenario.category)) return false
    return true
  })
}
