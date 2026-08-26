import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '@/agent/parse'
import { renderToolCall } from '@/agent/render'
import { SCENARIOS } from '@/eval/scenarios'
import { SYSTEM_PROMPT } from '@/llm/config'
import { builtinTools } from '@/tools/builtins'
import { activate, composeTurns } from './activate'
import { loadCatalog } from './load'
import { route } from './route'

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
      ['memory', 35, ['memory']],
      ['convert-units', 32, ['convert']],
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

describe('convert-units', () => {
  it.each([
    ['What is 32 fahrenheit in celsius?', 'trigger'],
    ['32 F to C', 'trigger'],
    ['5 miles in km', 'trigger'],
    ['Convert 200 grams to ounces', 'trigger'],
    ['convert 6 feet to meters', 'trigger'],
    ['80 kg in pounds', 'trigger'],
    ['100 km/h in mph', 'trigger'],
    ['2 hectares in acres', 'trigger'],
    ['What is 1 GB in MiB?', 'trigger'],
    ['90 minutes in hours', 'trigger'],
    ['How many ounces is 200 grams?', 'trigger'],
    ['Wie viel sind 5 Meilen in Kilometer?', 'trigger'],
    ['Wie viele Zentimeter sind 3 Zoll?', 'trigger'],
    ['Rechne 80 kg in Pfund um', 'trigger'],
    ['3 Zoll in cm', 'trigger'],
    ['200 Gramm in Unzen', 'trigger'],
    ['Was ist das in Celsius?', 'search'],
    ['30 Grad umgerechnet in Fahrenheit', 'search'],
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('convert-units')
    expect(reason(message)).toBe(how)
  })

  it.each([
    // A destination is not a unit, and the round spent finding that out is the
    // reason the target of a conversion has to be a unit this tool knows.
    '20 minutes to Berlin',
    'Wie komme ich von Berlin nach München?',
    '3 hours in Lisbon',
  ])('leaves %j alone', (message) => {
    expect(routed(message)).not.toBe('convert-units')
  })

  it.each([
    // Arithmetic is arithmetic even where it mentions a percentage or a power,
    // and it sits directly below this skill in priority.
    ['How much is 18 percent of 2450?', 'arithmetic'],
    ['What is 98765 * 4321?', 'arithmetic'],
    ['What is 2 to the power of 20?', 'arithmetic'],
    // A temperature question about the world, not about a scale.
    ['Wie warm ist es in München?', 'weather'],
  ])('does not take %j from %s', (message, expected) => {
    expect(routed(message)).toBe(expected)
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
    ['Wie warm wird es morgen in Rom?', 'search'],
    ['wie kalt wird die Nacht', 'search'],
    // Both were keywords until research-question grew a `how high is` shape.
    // A keyword cannot defend a question against a trigger, wherever the
    // trigger lives and however low its skill's priority is.
    ['chance of rain later', 'trigger'],
    ['Wie hoch ist die Regenwahrscheinlichkeit?', 'trigger'],
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
    // Now a trigger rather than an index hit, because a trigger anywhere in the
    // catalogue is matched before any keyword: research-question's `was ist
    // heute` was taking this whole shape of question off the clock.
    ['Welcher Tag ist heute?', 'trigger'],
    ['Was ist heute für ein Tag?', 'trigger'],
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
  ])('takes %j by %s', (message, how) => {
    expect(routed(message)).toBe('research-question')
    expect(reason(message)).toBe(how)
  })

  it.each([
    // A figure, a date or an attribution. All of these reached no skill at all,
    // which is the state in which a 0.8B model answers from memory and states a
    // number nobody can check.
    ['How many people live in Tokyo?', 'trigger'],
    ['How many countries are in Africa?', 'trigger'],
    ['How old is Angela Merkel?', 'trigger'],
    ['How tall is the Burj Khalifa?', 'trigger'],
    ['How fast is a cheetah?', 'trigger'],
    ['When was the Eiffel Tower built?', 'trigger'],
    ['When will the next election be?', 'trigger'],
    ['Who wrote Dune?', 'trigger'],
    ['Who invented the telephone?', 'trigger'],
    ['Who founded Stripe?', 'trigger'],
    ['Wie alt ist Angela Merkel?', 'trigger'],
    ['Wie viele Einwohner hat Deutschland?', 'trigger'],
    ['Wie hoch ist der Eiffelturm?', 'trigger'],
    ['Wie schwer ist ein Blauwal?', 'trigger'],
    ['Wann wurde die Mauer gebaut?', 'trigger'],
    ['Wer hat das Telefon erfunden?', 'trigger'],
    ['Wer hat Dune geschrieben?', 'trigger'],
    ['Wer hat die Bundestagswahl 2025 gewonnen?', 'trigger'],
    ['Was war 2024 das meistverkaufte Auto?', 'trigger'],
    ['Wie viele Einwohner hat Wien im Vergleich zu Graz?', 'trigger'],
  ])('takes the unsupported fact %j by %s', (message, how) => {
    expect(routed(message)).toBe('research-question')
    expect(reason(message)).toBe(how)
  })

  it.each([
    // The same shapes asked about the user or the assistant. Neither is on the
    // web, and searching for either is the wrong kind of answer.
    'How old are you?',
    'Wie alt bist du?',
    'When is my flight?',
    'Wann ist mein Termin?',
    'How many do I have?',
    'Wie viele Notizen habe ich?',
  ])('leaves %j alone', (message) => {
    expect(routed(message)).not.toBe('research-question')
  })

  it.each([
    // Every one of these is a question the new shapes above pass through: the
    // skill that owns it has a higher priority, or matches a longer shape.
    ['How many ounces is 200 grams?', 'convert-units'],
    ['Wie viele Zentimeter sind 3 Zoll?', 'convert-units'],
    ['How much is 18 percent of 2450?', 'arithmetic'],
    ['Wie viel Uhr ist es?', 'current-date'],
    ['How high is the chance of rain tomorrow?', 'weather'],
    ['Wie hoch ist die Regenwahrscheinlichkeit?', 'weather'],
    ['Wie warm ist es in München?', 'weather'],
  ])('does not take %j from %s', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })
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
    'Erzähl mir einen Witz',
    'I was born in 2024',
    'I currently live in Berlin',
    'Was machst du heute?',
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
