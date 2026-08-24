import { describe, expect, it } from 'vitest'
import { loadCatalog } from './load'
import { isFollowUp, MAX_CARRIED_TURNS, route, type SkillMemory } from './route'

const catalog = loadCatalog()

function routed(message: string, memory: SkillMemory | null = null): string | null {
  return route(message, catalog, memory).route?.entry.name ?? null
}

function reason(message: string, memory: SkillMemory | null = null): string | null {
  return route(message, catalog, memory).route?.reason ?? null
}

describe('routing by trigger', () => {
  it.each([
    ['What is 98765 * 4321?', 'arithmetic'],
    ['How much is 18 percent of 2450?', 'arithmetic'],
    ['What year is it right now?', 'current-date'],
    ['Summarise https://example.com/post', 'summarize-url'],
    ['Who is the current secretary-general of the UN?', 'research-question'],
    // The reported failure: a bare project name the model read as a measurement.
    ['What is 1inch?', 'lookup-term'],
    ['what is 1inch', 'lookup-term'],
    ['What is 1inch used for?', 'lookup-term'],
    ['What is Stripe?', 'lookup-term'],
    ["What's Notion?", 'lookup-term'],
    ["What's the weather in Berlin?", 'weather'],
    ['How hot is it in Dubai?', 'weather'],
    ['Is it raining in London?', 'weather'],
    ['Will it rain tomorrow?', 'weather'],
    ['What is the temperature in Oslo?', 'weather'],
  ])('routes %j to %s', (message, expected) => {
    expect(routed(message)).toBe(expected)
    expect(reason(message)).toBe('trigger')
  })

  it.each([
    // Every one of these also reads as a question about the date, which owns
    // the same words at a lower priority.
    ["What's the weather in Tokyo today?", 'weather'],
    ['Is it snowing in Oslo right now?', 'weather'],
    ["What's the forecast for Lisbon this week?", 'weather'],
  ])('routes %j to %s rather than to the clock', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })

  it.each([
    ['Wie ist das Wetter in Berlin?', 'weather'],
    ['Wettervorhersage für morgen?', 'weather'],
    ['Kommt heute ein Unwetter?', 'weather'],
    ['Regnet es gerade in Hamburg?', 'weather'],
    ['Wie warm ist es in München?', 'weather'],
    ['Was ist die Temperatur in Wien heute?', 'weather'],
  ])('routes the German %j to %s', (message, expected) => {
    // The weather skill has German triggers of its own: the compounds a German
    // question uses would not survive a word boundary, so they were worth
    // writing out rather than leaving to the keyword index.
    expect(routed(message)).toBe(expected)
    expect(reason(message)).toBe('trigger')
  })

  it('leaves a linked weather site to summarize-url', () => {
    // `weather` and `forecast` both appear in the URL, and a search would
    // answer about somewhere else entirely.
    expect(routed('Summarise https://weather.com/forecast')).toBe('summarize-url')
  })

  it.each([
    // A digit-bearing token is lookup-term's strongest signal, so these are the
    // prompts most at risk of being stolen from the skill that should own them.
    ['What is 2 to the power of 20?', 'arithmetic'],
    ['What is 98765 * 4321?', 'arithmetic'],
    ['What is the date today?', 'current-date'],
  ])('does not let lookup-term steal %j from %s', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })
})

describe('routing by search', () => {
  it.each([
    // German, mostly: the system prompt tells the model to answer in the language
    // it was asked in, and every trigger outside the weather skill is English.
    ['Berechne 18 Prozent von 2450', 'arithmetic'],
    ['Welches Jahr ist gerade?', 'current-date'],
    ['Fasse mir die Seite zusammen', 'summarize-url'],
    ['Zusammenfassung bitte', 'summarize-url'],
    ['Kannst du das im Netz nachschauen? Suche im Netz nach den Zahlen', 'research-question'],
    ['Wie warm wird es morgen in Rom?', 'weather'],
    ['Von der Firma habe ich noch nie gehört', 'lookup-term'],
  ])('finds %j for %s where no trigger fires', (message, expected) => {
    expect(routed(message)).toBe(expected)
    expect(reason(message)).toBe('search')
  })

  it('says which keyword found the skill', () => {
    expect(route('Berechne 18 Prozent von 2450', catalog).route?.matched).toContain('berechne')
  })
})

describe('routing nothing at all', () => {
  it.each([
    'Write a two-line rhyme about rain.',
    'What is the capital of France?',
    'What is my favourite colour?',
    // Physics, not this afternoon: the word alone must not pull in the weather.
    'What temperature does water boil at?',
    'Erzähl mir einen Witz',
  ])('leaves %j to the model', (message) => {
    // Firing a tool-shaped skill on plain conversation is the failure mode that
    // makes a small model reach for tools it does not need.
    expect(routed(message)).toBeNull()
  })
})

describe('keeping a skill across a follow-up', () => {
  const resident: SkillMemory = { name: 'weather', carried: 0 }

  it('remembers the skill a matched turn used', () => {
    expect(route("What's the weather in Berlin?", catalog).memory).toEqual({ name: 'weather', carried: 0 })
  })

  it.each(['and in Lisbon?', 'And Lisbon?', 'Und in Lissabon?', 'What about tomorrow?', 'tomorrow?'])(
    'carries the skill into %j, which matches nothing by itself',
    (message) => {
      expect(routed(message, resident)).toBe('weather')
      expect(reason(message, resident)).toBe('carried-over')
    },
  )

  it('counts how long it has been carried', () => {
    expect(route('and in Lisbon?', catalog, resident).memory).toEqual({ name: 'weather', carried: 1 })
  })

  it('drops it once the follow-ups run out', () => {
    const stale: SkillMemory = { name: 'weather', carried: MAX_CARRIED_TURNS }

    // Past this a skill has stopped being a continuation and become a default.
    expect(routed('and in Lisbon?', stale)).toBeNull()
    expect(route('and in Lisbon?', catalog, stale).memory).toBeNull()
  })

  it.each([
    'What is the capital of France?',
    'Write me a haiku about trains',
    'thanks!',
    'Danke, das war alles',
  ])('evicts it when %j asks something of its own', (message) => {
    expect(routed(message, resident)).toBeNull()
    expect(route(message, catalog, resident).memory).toBeNull()
  })

  it('replaces it when another skill matches outright', () => {
    const routing = route('What is 6748 * 9?', catalog, resident)

    expect(routing.route?.entry.name).toBe('arithmetic')
    expect(routing.memory).toEqual({ name: 'arithmetic', carried: 0 })
  })

  it('forgets a skill that is no longer installed', () => {
    expect(routed('and in Lisbon?', { name: 'removed-skill', carried: 0 })).toBeNull()
  })
})

describe('isFollowUp', () => {
  it.each(['and in Lisbon?', 'und morgen?', 'What about Rome?', 'Lisbon?', 'the day after?'])(
    'reads %j as a continuation',
    (message) => {
      expect(isFollowUp(message)).toBe(true)
    },
  )

  it.each([
    // Six words, and answering it with another skill's exemplars resident would
    // send the model searching for a fact it already knows.
    'What is the capital of France?',
    'Who wrote Dune?',
    'thanks',
    'ok cool',
    'Write a poem about the sea and the rain',
  ])('does not read %j as a continuation', (message) => {
    expect(isFollowUp(message)).toBe(false)
  })
})
