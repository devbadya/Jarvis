import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '@/agent/parse'
import { renderToolCall } from '@/agent/render'
import { SCENARIOS } from '@/eval/scenarios'
import { SYSTEM_PROMPT } from '@/llm/config'
import { builtinTools } from '@/tools/builtins'
import { activate, composeTurns } from './activate'
import { loadCatalog } from './load'
import { isFollowUp, route } from './route'

const catalog = loadCatalog()

function routed(message: string): string | null {
  return route(message, catalog).route?.entry.name ?? null
}

function reason(message: string): string | null {
  return route(message, catalog).route?.reason ?? null
}

/**
 * Every shipped skill, exercised the way a user actually asks — every trigger
 * family, every keyword, the collisions between skills, and the near-misses that
 * must stay with the model. A skill that only works on the handful of prompts
 * in `route.test.ts` is not finished.
 */
describe('the shipped library', () => {
  it('is the eight skills the README names, highest priority first', () => {
    expect(catalog.map((entry) => [entry.name, entry.priority, entry.tools])).toEqual([
      // An empty list, not an absent one: small talk wants no tools at all.
      ['small-talk', 40, []],
      ['memory', 35, ['memory']],
      ['arithmetic', 30, ['calculator']],
      ['weather', 28, ['weather']],
      ['current-date', 25, ['current_time']],
      ['summarize-url', 20, ['read_page']],
      ['lookup-term', 15, ['web_search', 'read_page']],
      ['research-question', 10, ['web_search', 'read_page']],
    ])
  })

  it('has at least one eval scenario whose prompt routes to each skill', () => {
    const hit = new Set(
      SCENARIOS.map((scenario) => route(scenario.prompt, catalog).route?.entry.name).filter(
        (name): name is string => Boolean(name),
      ),
    )

    expect([...hit].sort()).toEqual(catalog.map((entry) => entry.name).sort())
  })
})

describe('arithmetic', () => {
  it.each([
    ['What is 5 + 3?', 'trigger'],
    ['12 * 4', 'trigger'],
    ['100 / 5', 'trigger'],
    ['2^10', 'trigger'],
    ['17 % 5', 'trigger'],
    ['12-4', 'trigger'],
    ['How much is 18 percent of 2450?', 'trigger'],
    ['20 per cent off 80', 'trigger'],
    ['12% of 50', 'trigger'],
    ['7 times 8', 'trigger'],
    ['100 divided by 4', 'trigger'],
    ['5 plus 3', 'trigger'],
    ['10 minus 2', 'trigger'],
    ['multiplied by 3 gives', 'trigger'],
    ['square root of 16', 'trigger'],
    ['sqrt 9', 'trigger'],
    ['2 to the power of 8', 'trigger'],
    ['5 squared', 'trigger'],
    ['2 cubed', 'trigger'],
    ['Calculate the total', 'trigger'],
    ['Work out (17 * 23) / 4 exactly.', 'trigger'],
    ['Compute 3-1', 'trigger'],
    ['Wie viel ist 7 mal 8?', 'trigger'],
    ['12 geteilt durch 3', 'trigger'],
    ['2 hoch 10', 'trigger'],
    ['18 prozent von 50', 'trigger'],
    ['18% von 50', 'trigger'],
    ['Wurzel aus 144', 'trigger'],
    ['Rechne 5 plus 3 aus', 'trigger'],
    ['Berechne 18 Prozent von 2450', 'trigger'],
    ['Quadratwurzel von 144', 'search'],
    ['percent of the bill', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('arithmetic')
    expect(reason(message)).toBe(how)
  })
})

describe('weather', () => {
  it.each([
    ["What's the weather in Berlin?", 'trigger'],
    ['forecast for Rome', 'trigger'],
    ['How hot is it in Dubai?', 'trigger'],
    ['How cold is it outside?', 'trigger'],
    ['How warm is it in Madrid?', 'trigger'],
    ['Is it raining in London?', 'trigger'],
    ['Is it snowing in Oslo?', 'trigger'],
    ['Is it sunny in Lisbon?', 'trigger'],
    ['Is it windy in Chicago?', 'trigger'],
    ['Is it humid in Singapore?', 'trigger'],
    ['What is the temperature in Oslo?', 'trigger'],
    ['temperature outside right now', 'trigger'],
    ['temperature here', 'trigger'],
    ['temperature today', 'trigger'],
    ['temperature tonight', 'trigger'],
    ['Will it rain tomorrow?', 'trigger'],
    ['Is it going to snow?', 'trigger'],
    ['Wie ist das Wetter in Berlin?', 'trigger'],
    ['Wettervorhersage für morgen?', 'trigger'],
    ['Kommt heute ein Unwetter?', 'trigger'],
    ['Regnet es gerade in Hamburg?', 'trigger'],
    ['Schneit es in Innsbruck?', 'trigger'],
    ['Wie warm ist es in München?', 'trigger'],
    ['Wie kalt ist es?', 'trigger'],
    ['Wie heiß ist es?', 'trigger'],
    ['Wie heiss ist es?', 'trigger'],
    ['Was ist die Temperatur in Wien heute?', 'trigger'],
    ['Temperatur draußen', 'trigger'],
    ['Temperatur draussen', 'trigger'],
    ['how warm will it be', 'search'],
    ['how cold does it get', 'search'],
    ['chance of rain later', 'search'],
    ['Wie warm wird es morgen in Rom?', 'search'],
    ['wie kalt wird die Nacht', 'search'],
    ['Wie hoch ist die Regenwahrscheinlichkeit?', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('weather')
    expect(reason(message)).toBe(how)
  })
})

describe('current-date', () => {
  it.each([
    ['What is the date?', 'trigger'],
    ["What's the time?", 'trigger'],
    ['What is the day?', 'trigger'],
    ['What year is it?', 'trigger'],
    ['What year is it right now?', 'trigger'],
    ['What time is it?', 'trigger'],
    ['What day is it?', 'trigger'],
    ['What month is it?', 'trigger'],
    ['What week is it?', 'trigger'],
    ['What is the date today?', 'trigger'],
    ['current date', 'trigger'],
    ["today's date", 'trigger'],
    ['current year', 'trigger'],
    ["today's year", 'trigger'],
    ['day of the week', 'trigger'],
    ['Is it Monday?', 'trigger'],
    ['Is today Tuesday?', 'trigger'],
    ['Is it Wednesday?', 'trigger'],
    ['Is it Sunday?', 'trigger'],
    ['Wie spät ist es?', 'trigger'],
    ['Wie spaet ist es?', 'trigger'],
    ['Wie viel Uhr ist es?', 'trigger'],
    ['Ist heute Montag?', 'trigger'],
    ['Ist es Dienstag?', 'trigger'],
    ['Ist heute Freitag?', 'trigger'],
    ['Welches Jahr ist gerade?', 'search'],
    ['Welches Datum haben wir?', 'search'],
    ['Welcher Tag ist heute?', 'search'],
    ['what day is it tomorrow', 'trigger'],
    ['time right now please', 'search'],
    ['Kannst du die Uhrzeit sagen?', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('current-date')
    expect(reason(message)).toBe(how)
  })
})

describe('summarize-url', () => {
  it.each([
    ['https://example.com/pricing', 'trigger'],
    ['http://example.com', 'trigger'],
    ['Summarise https://example.com/post', 'trigger'],
    ['What does https://example.com/pricing say?', 'trigger'],
    ['summarise this for me', 'trigger'],
    ['Please summarize the findings', 'trigger'],
    ['tl;dr', 'trigger'],
    ['tldr', 'trigger'],
    ['What does this page say?', 'trigger'],
    ['What does the article say?', 'trigger'],
    ['What does that link say?', 'trigger'],
    ['Fasse mir die Seite zusammen', 'search'],
    ['Zusammenfassung bitte', 'search'],
    ['Kannst du das zusammenfassen?', 'search'],
    ['read this page when you can', 'search'],
    ['Was steht auf der Seite?', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('summarize-url')
    expect(reason(message)).toBe(how)
  })
})

describe('lookup-term', () => {
  it.each([
    ['What is Stripe?', 'trigger'],
    ["What's Notion?", 'trigger'],
    ['Who is Obama?', 'trigger'],
    ['What are AirPods?', 'trigger'],
    ['What is 1inch?', 'trigger'],
    ['what is 1inch', 'trigger'],
    ['What is 1inch used for?', 'trigger'],
    ['What is 3Blue1Brown?', 'trigger'],
    ['What is 1Password?', 'trigger'],
    ['Was ist Stripe?', 'trigger'],
    ['Wer ist Stripe?', 'trigger'],
    ['Was ist 1inch?', 'trigger'],
    ['Was ist 1Password?', 'trigger'],
    ['Was ist 3Blue1Brown?', 'trigger'],
    ['I have never heard of this', 'search'],
    ['what kind of company is that', 'search'],
    ['what kind of product is it', 'search'],
    ['Was ist das für eine Firma?', 'search'],
    ['Von der Firma habe ich noch nie gehört', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('lookup-term')
    expect(reason(message)).toBe(how)
  })
})

describe('research-question', () => {
  it.each([
    ['Who is the current secretary-general of the UN?', 'trigger'],
    ["What's today's news?", 'trigger'],
    ['What is happening right now in France?', 'trigger'],
    ["What's going on in Berlin?", 'trigger'],
    ['the latest results', 'trigger'],
    ['any recent updates', 'trigger'],
    ['Who was Ada Lovelace?', 'trigger'],
    ['Who are the founders of Stripe?', 'trigger'],
    ['Who won the election?', 'trigger'],
    ['What happened in 2024?', 'trigger'],
    ['When did the 2026 World Cup start?', 'trigger'],
    ['Look up the melting point of tungsten', 'trigger'],
    ['Search for the capital of Mongolia', 'trigger'],
    ['Can you find out who wrote Dune?', 'trigger'],
    ['Google the ISBN of Dune', 'trigger'],
    ['How much does an iPhone cost?', 'trigger'],
    ['How much is a Big Mac in Japan?', 'trigger'],
    ['How much are the tickets?', 'trigger'],
    ['Wer ist Elon Musk?', 'trigger'],
    ['Wer war Ada Lovelace?', 'trigger'],
    ['Wer hat gewonnen?', 'trigger'],
    ['Was kostet ein iPhone?', 'trigger'],
    ['Wie viel kostet das Abo?', 'trigger'],
    ['Was ist gerade los?', 'trigger'],
    ['Was ist los in Frankreich?', 'trigger'],
    ['Was passiert heute?', 'trigger'],
    ['Was ist aktuell in Berlin?', 'trigger'],
    ['look it up for me', 'search'],
    ['please find out', 'trigger'],
    ['search the web for that', 'search'],
    ['who won yesterday', 'trigger'],
    ['Kannst du das im Netz nachschauen? Suche im Netz nach den Zahlen', 'search'],
    ['Schau nach, was daraus geworden ist', 'search'],
    ['Finde heraus, wer das geschrieben hat', 'search'],
    ['aktuelle Nachrichten bitte', 'search'],
    // A life is looked up, not recalled. Only `wer war X` used to route, so
    // every other way of asking about a person reached no skill at all and was
    // answered out of the model's memory — which is where an invented age or
    // date comes from, and it is the failure this family exists to stop.
    ['How old is Elon Musk?', 'trigger'],
    ['How old was Ada Lovelace?', 'trigger'],
    ['Wie alt ist Elon Musk?', 'trigger'],
    ['Wie alt wurde Ada Lovelace?', 'trigger'],
    ['Wie alt war Kennedy?', 'trigger'],
    ['When did Ada Lovelace die?', 'trigger'],
    ['When was Ada Lovelace born?', 'trigger'],
    ['Wann starb Ada Lovelace?', 'trigger'],
    ['Wann wurde Ada Lovelace geboren?', 'trigger'],
    ['Wann ist Ada Lovelace gestorben?', 'trigger'],
    ['Tell me about Ada Lovelace', 'trigger'],
    ['Erzähl mir über Ada Lovelace', 'trigger'],
    ['Erzähle mir etwas über Ada Lovelace', 'trigger'],
    ['Erzähl mir von Ada Lovelace', 'trigger'],
    ['Was hat Ada Lovelace gemacht?', 'trigger'],
    ['Was haben die Römer erreicht?', 'trigger'],
    ['biography of Ada Lovelace', 'search'],
    ['Biografie von Ada Lovelace', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('research-question')
    expect(reason(message)).toBe(how)
  })
})

describe('small-talk', () => {
  it.each([
    ['hallo', 'trigger'],
    ['Hallo!', 'trigger'],
    ['halloo', 'trigger'],
    ['hi', 'trigger'],
    ['Hi there', 'trigger'],
    ['hey', 'trigger'],
    ['moin', 'trigger'],
    ['moin moin', 'trigger'],
    ['servus', 'trigger'],
    ['hello', 'trigger'],
    ['Guten Morgen', 'trigger'],
    ['Guten Abend!', 'trigger'],
    ['Wie geht es dir?', 'trigger'],
    ["wie geht's", 'trigger'],
    ['How are you?', 'trigger'],
    ['how are you doing', 'trigger'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('small-talk')
    expect(reason(message)).toBe(how)
  })

  it('offers the model no tools at all', () => {
    // Not a narrowed list: none. The chat template then renders no tool block,
    // so there is no call format in front of a 0.8B model to imitate — which is
    // what stops a greeting being answered with a web search and two citations.
    const { activation } = activate('hallo', catalog, builtinTools)

    expect(activation?.skill.name).toBe('small-talk')
    expect(activation?.tools).toEqual([])
  })

  it.each([
    ['Hallo, was ist Stripe?', 'lookup-term'],
    ['Hi, wie alt wurde Ada Lovelace?', 'research-question'],
    ['Guten Morgen, wie ist das Wetter in Berlin?', 'weather'],
    ['Hallo! Was ist 6748 * 9?', 'arithmetic'],
    ['Hi, what is Notion?', 'lookup-term'],
  ])('gives the real question in %j to %s', (message, expected) => {
    // Every shape `lookup-term` matches is anchored to the start of the message,
    // which a greeting had taken — so these reached no skill at all. The greeting
    // is taken off and the rest offered up, but only after the message as
    // written has been tried, or a bare `hallo` would stop reaching small talk.
    expect(routed(message)).toBe(expected)
  })

  it('does not read a greeting that runs into its own sentence as a question', () => {
    // No punctuation, so nothing is stripped: `hi there` is not about *there*.
    expect(routed('hi there')).toBe('small-talk')
  })

  it.each(['hallo', 'hi', 'moin', 'Guten Morgen'])(
    'drops a resident research skill rather than letting %j inherit it',
    (message) => {
      // The reported failure: `hallo` is short enough to read as a fragment, so
      // it carried over the previous turn's skill, was handed only the search
      // tools, and dutifully searched for the word it had been greeted with.
      const carried = { name: 'research-question', carried: 0 }

      expect(route(message, catalog, carried).route?.entry.name).toBe('small-talk')
      expect(isFollowUp(message)).toBe(false)
    },
  )
})

describe('memory', () => {
  it.each([
    ['Remember that I prefer metric units.', 'trigger'],
    ['remember I take my coffee black', 'trigger'],
    ['Please remember that my flat has no lift.', 'trigger'],
    ['Memorise this: I cycle to work.', 'trigger'],
    ['Memorize the wifi password is written down', 'trigger'],
    ['Note that I work Tuesdays.', 'trigger'],
    ['Keep in mind that my dog is called Nala.', 'trigger'],
    ['Keep in mind that we eat at six.', 'trigger'],
    ['Forget that I live in Berlin.', 'trigger'],
    ['Forget about the Lisbon address.', 'trigger'],
    ['Forget what I said about tea.', 'trigger'],
    ['Forget my old number.', 'trigger'],
    ['Forget everything you know about me.', 'trigger'],
    ['Forget all of that.', 'trigger'],
    ['please forget the last thing', 'trigger'],
    ['Stop remembering my location.', 'trigger'],
    ['What do you know about me?', 'trigger'],
    ['What do you remember about my flat?', 'trigger'],
    ['Clear your memory.', 'trigger'],
    ['Show me my memories.', 'trigger'],
    ['Remember that I live in Munich now, not Lisbon.', 'trigger'],
    ['Merk dir bitte, dass ich Tee mag', 'search'],
    ['Vergiss was ich über Berlin gesagt habe', 'search'],
    ['Vergiss dass ich in Lissabon wohne', 'search'],
    ['Erinnere dich daran, dass ich vegan esse', 'search'],
    ['Was weißt du über mich?', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('memory')
    expect(reason(message)).toBe(how)
  })
})

describe('priority and near misses', () => {
  it.each([
    ['Remember that 20% of my income goes to rent.', 'memory'],
    ['Remember that I am in Lisbon today.', 'memory'],
    ["What's the weather in Tokyo today?", 'weather'],
    ['Is it snowing in Oslo right now?', 'weather'],
    ["What's the forecast for Lisbon this week?", 'weather'],
    ["What's today's news?", 'research-question'],
    ['What is happening right now in France?', 'research-question'],
    ['How much is a Big Mac in Japan?', 'research-question'],
    ['What is 2 to the power of 20?', 'arithmetic'],
    ['What is 98765 * 4321?', 'arithmetic'],
    ['What is the date today?', 'current-date'],
    ['What is the current year?', 'current-date'],
    ['Who is Obama?', 'lookup-term'],
    ['Who is Elon Musk?', 'research-question'],
    ['Wer ist Stripe?', 'lookup-term'],
    ['Wer ist Elon Musk?', 'research-question'],
    ['Summarise https://weather.com/forecast', 'summarize-url'],
    ['https://example.com/weather', 'summarize-url'],
  ])('gives %j to %s', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })

  it.each([
    'Write a two-line rhyme about rain.',
    'What is the capital of France?',
    'What is my favourite colour?',
    'What temperature does water boil at?',
    "I can't remember the capital of Peru.",
    // A joke is not a lookup, which is why the German shape needs the
    // preposition that turns the rest of the sentence into a subject.
    'Erzähl mir einen Witz',
    'Erzähl mir eine Geschichte',
    // Second person: this is about the conversation, not about a subject.
    'Was haben wir gemacht?',
    'Was hast du gemacht?',
    'I was born in 2024',
    'I currently live in Berlin',
    'Was machst du heute?',
    'What is 32 fahrenheit in celsius',
    'What time is it in Tokyo?',
    'Wie spät ist es in Tokio?',
    'Wie spät ist es in Berlin?',
    'What is that?',
    'What is this?',
    'What is it?',
    'What is these?',
    'Was ist das?',
    'Was ist dies?',
    'Was ist es?',
    'Was ist los?',
    // Pronouns, not names: lookup already excludes them, and research must too.
    'Who is that?',
    'Who is this?',
    'Who is it?',
    'Who are they?',
    'Wer ist das?',
    'Wer ist es?',
    'Hello there',
    'ok thanks',
  ])('leaves %j to the model', (message) => {
    expect(routed(message)).toBeNull()
  })
})

describe('activating each shipped skill', () => {
  const cases: [string, string, string[]][] = [
    ['hallo', 'small-talk', []],
    ['Remember that I prefer metric units.', 'memory', ['memory']],
    ['What is 6748 * 9?', 'arithmetic', ['calculator']],
    ["What's the weather in Berlin?", 'weather', ['weather']],
    ['What year is it?', 'current-date', ['current_time']],
    ['What does https://example.com/pricing say?', 'summarize-url', ['read_page']],
    ['What is Stripe?', 'lookup-term', ['web_search', 'read_page']],
    ['Who is the current secretary-general of the UN?', 'research-question', ['web_search', 'read_page']],
  ]

  it.each(cases)('materialises %s for %j with only its tools', (message, name, tools) => {
    const { activation } = activate(message, catalog, builtinTools)

    expect(activation?.skill.name).toBe(name)
    expect(activation?.tools.map((tool) => tool.schema.function.name)).toEqual(tools)
    expect(activation?.exemplars.length).toBeGreaterThan(0)
  })

  it.each(cases)('puts %s guidance and a parseable exemplar in front of %j', (message, name) => {
    const { activation } = activate(message, catalog, builtinTools)
    const turns = composeTurns([{ role: 'user', content: message }], activation)
    const skill = activation?.skill

    expect(skill?.name).toBe(name)
    expect(turns[0]?.content).toBe(`${SYSTEM_PROMPT}\n\n${skill?.guidance}`)
    expect(turns.at(-1)?.content).toBe(message)

    const first = skill?.exemplars[0]
    expect(first).toBeDefined()
    for (const step of first?.steps ?? []) {
      const markup = renderToolCall(step.tool, step.arguments)
      expect(turns.some((turn) => turn.role === 'assistant' && turn.content === markup)).toBe(true)
      expect(parseModelOutput(markup).toolCalls).toEqual([{ name: step.tool, arguments: step.arguments }])
    }
  })

  it('teaches summarize-url to ask for a link when none was given', () => {
    const { activation } = activate('Fasse mir die Seite zusammen', catalog, builtinTools)
    const turns = composeTurns([{ role: 'user', content: 'Fasse mir die Seite zusammen' }], activation)
    const bare = activation?.skill.exemplars.find((exemplar) => exemplar.steps.length === 0)

    expect(activation?.skill.name).toBe('summarize-url')
    expect(bare?.answer).toMatch(/link/i)
    expect(turns).toContainEqual({ role: 'user', content: bare?.user })
    expect(turns).toContainEqual({ role: 'assistant', content: bare?.answer })
    expect(turns.filter((turn) => turn.role === 'tool')).toHaveLength(
      activation?.skill.exemplars.reduce((total, exemplar) => total + exemplar.steps.length, 0) ?? 0,
    )
  })
})
