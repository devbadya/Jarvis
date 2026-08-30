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

import type { MemoryKind } from '@/memory/types'

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
  /**
   * What the user is taken to have stored, recalled into the system prompt as a
   * real turn would do it.
   *
   * Recall is the half of memory the model never asks for, so without this the
   * harness could not see it at all — and it lengthens the system prompt, which
   * is the one thing this app has already measured hurting tool use.
   */
  memories?: { text: string; kind?: MemoryKind }[]
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
   * Requires a working network, and for the search scenarios a `web_search`
   * provider that can answer them. The default provider covers the live web
   * without a key, so these need only the network — unless Wikipedia is selected
   * under Tools → Web access, which cannot answer the current-events cases at
   * all. The weather tool needs no key either.
   */
  online?: boolean
}

function searchQuery(calls: Invocation[]): string | null {
  const search = calls.find((call) => call.name === 'web_search' || call.name === 'research')
  return search ? String(search.arguments.query ?? '') : null
}

/**
 * Passes when the place reached the weather tool.
 *
 * A reading for nowhere is answerable about nothing, so dropping the location, or
 * replacing it with a country or a paraphrase, is a failure the tool name cannot
 * see on its own.
 */
function asksAbout(place: string): (calls: Invocation[]) => boolean {
  return (calls) =>
    calls.some(
      (call) =>
        call.name === 'weather' &&
        String(call.arguments.place ?? '')
          .toLowerCase()
          .includes(place.toLowerCase()),
    )
}

/** Passes when the place reached the clock rather than the user's own timezone. */
function asksClockAbout(place: string): (calls: Invocation[]) => boolean {
  return (calls) =>
    calls.some(
      (call) =>
        call.name === 'current_time' &&
        String(call.arguments.place ?? '')
          .toLowerCase()
          .includes(place.toLowerCase()),
    )
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
  // German arithmetic used to reach the skill only through the keyword index.
  // Whether the model then *uses* the skill it was handed is the half the
  // router's own tests cannot measure.
  {
    id: 'arith-german',
    category: 'arithmetic',
    prompt: 'Berechne 18 Prozent von 2450',
    expectTool: 'calculator',
    accept: (answer) => hasNumber(answer, '441'),
  },
  {
    id: 'time-german',
    category: 'time',
    prompt: 'Welches Jahr ist gerade?',
    expectTool: 'current_time',
    accept: matches(new RegExp(String(new Date().getFullYear()))),
  },
  {
    id: 'time-german-clock',
    category: 'time',
    // Reaches the skill by trigger rather than by keyword, because a keyword
    // cannot say "unless a city follows" and *wie spät ist es in Tokio* must not
    // be answered with the user's own clock.
    prompt: 'Wie spät ist es?',
    expectTool: 'current_time',
    accept: matches(/\d{1,2}[:.]\d{2}|\buhr\b/i),
  },
  {
    id: 'time-in-germany',
    category: 'time',
    prompt: 'What time is it in Germany?',
    expectTool: 'current_time',
    acceptCall: asksClockAbout('german'),
    accept: matches(/\d{1,2}[:.]\d{2}|\b(cest|cet|mesz|mez|berlin)\b/i),
    online: true,
  },
  {
    id: 'time-in-berlin-german',
    category: 'time',
    prompt: 'Wie spät ist es in Berlin?',
    expectTool: 'current_time',
    acceptCall: asksClockAbout('berlin'),
    accept: matches(/\d{1,2}[:.]\d{2}|\buhr\b|\b(cest|cet|mesz|mez|berlin)\b/i),
    online: true,
  },
  {
    id: 'time-in-germany-wie-viel-uhr',
    category: 'time',
    // Reported phrasing: *ist* sits at the end, so `wie viel uhr ist es in`
    // never fired and the model quoted the UTC hour off the instant line.
    prompt: 'wie viel uhr es in deutschland ist',
    expectTool: 'current_time',
    acceptCall: asksClockAbout('deutsch'),
    accept: matches(/\d{1,2}[:.]\d{2}|\buhr\b|\b(cest|cet|mesz|mez|berlin)\b/i),
    online: true,
  },
  {
    id: 'time-follow-up-germany',
    category: 'time',
    // The reported failure: a local-clock turn, then *and in germany*, answered
    // from training data with the wrong timezone. Carry-over keeps the clock
    // skill; the follow-up exemplar is what teaches passing `place`.
    history: [
      { role: 'user', content: 'What time is it?' },
      { role: 'assistant', content: 'It is 15:00.' },
    ],
    prompt: 'and in germany',
    expectTool: 'current_time',
    acceptCall: asksClockAbout('german'),
    accept: matches(/\d{1,2}[:.]\d{2}|\b(cest|cet|mesz|mez|berlin)\b/i),
    online: true,
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
    id: 'memory-recalled-fact',
    category: 'memory',
    memories: [
      { text: 'Favourite colour is teal', kind: 'fact' },
      { text: 'Prefers short answers', kind: 'preference' },
    ],
    prompt: 'What is my favourite colour?',
    // The point of injecting recall is that this costs no tool call. Reaching
    // for `memory` to read what is already in the prompt fails on routing, and
    // that is the failure worth catching.
    expectTool: null,
    accept: matches(/teal/i),
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
    expectTool: 'research',
    accept: matches(/guterres/i),
    // Wikipedia's lead about the office often never names the incumbent; this
    // tool reads three pages, so the person page or a UN page can supply it.
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
    id: 'lookup-german-name',
    category: 'lookup',
    // *Was ist Stripe?* used to route to no skill at all: every shape lookup-term
    // matched was written in English.
    prompt: 'Was ist Stripe?',
    expectTool: 'web_search',
    acceptCall: (calls) => searchQuery(calls)?.trim().toLowerCase() === 'stripe',
    accept: matches(/payment|zahlung|checkout|billing|fintech|bezahl/i),
    online: true,
  },
  {
    id: 'lookup-explain-german',
    category: 'lookup',
    // *Erkläre mir X* is how the question is put in German, and it used to reach
    // no skill at all: every instruction shape lookup-term matched was a question.
    prompt: 'Erkläre mir Stripe',
    expectTool: 'web_search',
    acceptCall: (calls) => searchQuery(calls)?.trim().toLowerCase() === 'stripe',
    accept: matches(/payment|zahlung|checkout|billing|fintech|bezahl/i),
    online: true,
  },
  {
    id: 'web-who-wrote',
    category: 'web',
    // `who is` and `who won` were triggers and authorship was not, so the one
    // question a search engine answers best reached nothing.
    prompt: 'Who wrote Dune?',
    expectTool: 'web_search',
    accept: matches(/herbert/i),
    online: true,
  },
  {
    id: 'web-population',
    category: 'web',
    // A figure a 0.8B model will otherwise invent, confidently and to three
    // significant figures.
    prompt: "What's the population of Tokyo?",
    expectTool: 'web_search',
    accept: (answer) => /\d/.test(answer),
    online: true,
  },
  {
    id: 'web-price-not-arithmetic',
    category: 'web',
    // A price is looked up, never worked out. `how much is` was an arithmetic
    // keyword, so this reached the calculator with nothing to calculate.
    prompt: 'How much is a Big Mac in Japan?',
    expectTool: 'research',
    accept: (answer) => /\d/.test(answer),
    online: true,
  },
  {
    id: 'web-news-not-clock',
    category: 'web',
    // `today` was a current-date trigger, which answered this with the date.
    prompt: "What's today's news?",
    expectTool: 'research',
    accept: (answer) => answer.trim().length > 20,
    online: true,
  },
  {
    id: 'web-german-office',
    category: 'web',
    // A German office-holder question used to search English Wikipedia and
    // answer in English. The query has to keep the German word; translating it
    // to "chancellor of germany" is the 1inch failure in another language.
    prompt: 'Wer ist der Bundeskanzler?',
    expectTool: 'research',
    acceptCall: (calls) => /bundeskanzler/i.test(searchQuery(calls) ?? ''),
    accept: matches(/merz|scholz|kanzler/i),
    online: true,
  },
  {
    id: 'no-tool-page-without-url',
    category: 'no-tool',
    // `read_page` needs an address, and the skill has no way to invent one. The
    // failure worth catching is a summary of a page that was never read.
    prompt: 'Fasse mir die Seite zusammen',
    expectTool: null,
    accept: matches(/link|url|welche seite|which page|adresse|schick/i),
  },
  {
    id: 'summarize-linked-page',
    category: 'web',
    prompt: 'What does https://example.com say?',
    expectTool: 'read_page',
    acceptCall: (calls) =>
      calls.some(
        (call) => call.name === 'read_page' && String(call.arguments.url ?? '').includes('example.com'),
      ),
    accept: matches(/example|illustrative|domain/i),
    online: true,
  },
  {
    id: 'memory-update',
    category: 'memory',
    memories: [{ text: 'Lives in Lisbon', kind: 'fact' }],
    prompt: 'Remember that I live in Munich now, not Lisbon.',
    expectTool: 'memory',
    // The skill now shows `update`; saving a second, contradicting fact is the
    // failure this exists to catch.
    acceptCall: (calls) =>
      ['update', 'change', 'correct', 'edit', 'replace'].includes(memoryCommand(calls) ?? ''),
    accept: matches(/munich|updated|noted|got it|will do|okay|ok\b/i),
  },
  {
    id: 'weather-current-conditions',
    category: 'weather',
    prompt: 'What is the weather in Berlin right now?',
    expectTool: 'weather',
    acceptCall: asksAbout('Berlin'),
    // Today's figures cannot be pinned down here, so this asks only that the
    // answer carries a reading rather than a hedge about not knowing.
    // Metric only: the reading comes from the `weather` tool, not from a search.
    accept: matches(/-?\d+\s*(°|degrees|celsius)|\b(rain|snow|cloud|sunny|clear|wind|humid|fog|storm)/i),
    // Keyless, but still the network.
    online: true,
  },
  {
    id: 'weather-forecast',
    category: 'weather',
    // The reading holds a `Now` line and a line per day. Answering this from the
    // wrong line is the failure worth measuring.
    prompt: 'Will it rain in Lisbon tomorrow?',
    expectTool: 'weather',
    acceptCall: asksAbout('Lisbon'),
    accept: matches(/\b(yes|no|rain|shower|dry|cloud|sun|storm)/i),
    online: true,
  },
  {
    id: 'weather-german',
    category: 'weather',
    // German routing and a German answer, which is what the trigger set exists for.
    prompt: 'Wie ist das Wetter in Hamburg?',
    expectTool: 'weather',
    acceptCall: asksAbout('Hamburg'),
    accept: matches(/-?\d+\s*(°|grad)|\b(regen|regnet|sonn|wolk|bedeckt|wind|schnee|nebel)/i),
    online: true,
  },
  {
    id: 'weather-follow-up-place',
    category: 'weather',
    // The weather reading was right; the next turn forgot the city. Carry-over
    // keeps the skill, and the topic line pins Frankfurt so the tool is not
    // called for nowhere — or for the exemplar's Berlin.
    history: [
      { role: 'user', content: 'Wie ist das Wetter in Frankfurt?' },
      { role: 'assistant', content: 'Frankfurt is around 18 °C and cloudy, with little wind.' },
    ],
    prompt: 'Und morgen?',
    expectTool: 'weather',
    acceptCall: asksAbout('Frankfurt'),
    accept: matches(/-?\d+\s*(°|grad)|\b(rain|regen|regnet|shower|cloud|wolk|sun|sonn|storm)/i),
    online: true,
  },
  {
    id: 'weather-german-infinitive',
    category: 'weather',
    // *Wird es regnen* is the ordinary way to ask about tomorrow, and only the
    // third person *regnet* was a trigger, so this reached no skill.
    prompt: 'Wird es morgen in Berlin regnen?',
    expectTool: 'weather',
    acceptCall: asksAbout('Berlin'),
    accept: matches(/\b(ja|nein|regen|regnet|schauer|trocken|wolk|sonn|gewitter)/i),
    online: true,
  },
  {
    id: 'no-tool-summarize-pronoun',
    category: 'no-tool',
    // The object of *fasse … zusammen* is usually a pronoun, so the skill now
    // takes this — and the thing it must teach is still to ask for the link
    // rather than to summarise a page it never read.
    prompt: 'Fasse das zusammen',
    expectTool: null,
    accept: matches(/link|url|welche seite|which page|adresse|schick/i),
  },
]

export function selectScenarios(options: { categories?: Category[]; includeOnline?: boolean }): Scenario[] {
  return SCENARIOS.filter((scenario) => {
    if (!options.includeOnline && scenario.online) return false
    if (options.categories && !options.categories.includes(scenario.category)) return false
    return true
  })
}
