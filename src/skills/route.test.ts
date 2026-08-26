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
    ['Remember that I prefer metric units.', 'memory'],
    ['remember I take my coffee black', 'memory'],
    ['Please remember that my flat has no lift.', 'memory'],
    ['Note that I work Tuesdays.', 'memory'],
    ['Forget that I live in Berlin.', 'memory'],
    ['Forget everything you know about me.', 'memory'],
    ['What do you know about me?', 'memory'],
    ['What do you remember about my flat?', 'memory'],
    ['Clear your memory.', 'memory'],
  ])('routes %j to %s', (message, expected) => {
    expect(routed(message)).toBe(expected)
    expect(reason(message)).toBe('trigger')
  })

  it.each([
    // Both also read as arithmetic, or as a question about today, which own the
    // same words at a lower priority.
    ['Remember that 20% of my income goes to rent.', 'memory'],
    ['Remember that I am in Lisbon today.', 'memory'],
  ])('routes %j to %s rather than to the tool its numbers suggest', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })

  it.each([
    // `today`, `right now` and `this week` were all current-date triggers, so
    // each of these was a priority collision the weather skill had to win. It no
    // longer claims those words at all, and none of them may reach the clock.
    ["What's the weather in Tokyo today?", 'weather'],
    ['Is it snowing in Oslo right now?', 'weather'],
    ["What's the forecast for Lisbon this week?", 'weather'],
  ])('routes %j to %s rather than to the clock', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })

  it.each([
    // Each of these was taken by a skill that had no business with it, on the
    // strength of one word.
    //
    // `today` and `right now` were current-date triggers, so a question about
    // the news was answered with the date.
    ["What's today's news?", 'research-question'],
    ['What is happening right now in France?', 'research-question'],
    // A price is looked up, never worked out, and `how much is` was an
    // arithmetic keyword.
    ['How much is a Big Mac in Japan?', 'research-question'],
  ])('routes %j to %s rather than to the skill that used to take it', (message, expected) => {
    expect(routed(message)).toBe(expected)
  })

  it.each([
    // German reached `weather` by trigger and everything else through the
    // keyword index, which meant the commonest question of all — *what is this
    // thing* — was caught by nothing whatsoever.
    ['Was ist Stripe?', 'lookup-term'],
    ['Was ist 1inch?', 'lookup-term'],
    // Two tokens, so it is a person rather than a bare name: research, not lookup.
    ['Wer ist Elon Musk?', 'research-question'],
    ['Wer ist der Bundeskanzler?', 'research-question'],
    ['Was ist los in Frankreich?', 'research-question'],
    ['Was kostet ein iPhone?', 'research-question'],
    ['Wie spät ist es?', 'current-date'],
    ['Ist heute Montag?', 'current-date'],
    ['Wie viel ist 7 mal 8?', 'arithmetic'],
    ['Wurzel aus 144', 'arithmetic'],
    ['Berechne 18 Prozent von 2450', 'arithmetic'],
    // German asks the memory skill in inflected forms a keyword cannot follow,
    // so these are triggers now rather than index hits.
    ['Merk dir bitte, dass ich Tee mag', 'memory'],
    ['Merke dir, dass ich vegan bin', 'memory'],
    ['Vergiss was ich über Berlin gesagt habe', 'memory'],
    ['Vergiss das bitte', 'memory'],
    ['Erkläre mir OpenAI', 'lookup-term'],
    ['Aktueller Bundeskanzler', 'research-question'],
    ['Wer hat Dune geschrieben?', 'research-question'],
    ['Wird es morgen in Berlin regnen?', 'weather'],
  ])('routes the German %j to %s by trigger', (message, expected) => {
    expect(routed(message)).toBe(expected)
    expect(reason(message)).toBe('trigger')
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
    ['Quadratwurzel von 144', 'arithmetic'],
    ['Welches Jahr ist gerade?', 'current-date'],
    ['Welches Datum haben wir?', 'current-date'],
    ['Fasse mir die Seite zusammen', 'summarize-url'],
    ['Zusammenfassung bitte', 'summarize-url'],
    ['Kannst du das im Netz nachschauen? Suche im Netz nach den Zahlen', 'research-question'],
    ['Wie warm wird es morgen in Rom?', 'weather'],
    ['Von der Firma habe ich noch nie gehört', 'lookup-term'],
    ['Erinnere dich daran, dass ich vegan esse', 'memory'],
    ['Welchen Wochentag haben wir?', 'current-date'],
    ['Fasse das zusammen', 'summarize-url'],
    ['Lies mir die Seite vor', 'summarize-url'],
  ])('finds %j for %s where no trigger fires', (message, expected) => {
    expect(routed(message)).toBe(expected)
    expect(reason(message)).toBe('search')
  })

  it('says which keyword found the skill', () => {
    expect(route('Quadratwurzel von 144', catalog).route?.matched).toContain('quadratwurzel')
  })
})

describe('routing nothing at all', () => {
  it.each([
    'Write a two-line rhyme about rain.',
    'What is the capital of France?',
    // Answered from what recall put in the prompt, with no tool round spent.
    'What is my favourite colour?',
    // Physics, not this afternoon: the word alone must not pull in the weather.
    'What temperature does water boil at?',
    // The user's own recall, not the app's: neither asks for anything stored.
    "I can't remember the capital of Peru.",
    'Erzähl mir einen Witz',
    // A year in a sentence about the user is not a question about that year.
    'I was born in 2024',
    'I currently live in Berlin',
    // `heute` was a current-date keyword, which turned every mention of today
    // into a question about the date.
    'Was machst du heute?',
    // A conversion, not a name: the digit-bearing token lookup-term matches has
    // to carry letters too, or `1inch` and `32` are the same shape to it.
    'What is 32 fahrenheit in celsius',
    // `current_time` reads the user's own clock and no other, so a question
    // about somewhere else must not reach it and answer with the wrong hour.
    'What time is it in Tokyo?',
    'Wie spät ist es in Tokio?',
    // Shaped exactly like a bare name, and not one.
    'What is that?',
    'Was ist das?',
    // The same pronouns after *who* / *wer*: research-question's `who is`
    // shape used to send these to a search engine.
    'Who is that?',
    'Who is it?',
    'Who are they?',
    'Wer ist das?',
    'Wer ist es?',
    'Was ist los?',
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
