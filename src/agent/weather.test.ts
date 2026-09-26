import { describe, expect, it } from 'vitest'
import { weather } from '@/tools/builtins'
import type { TopicTurn } from '@/memory/topic'
import { groundingFor } from './ground'
import { settleWeather, weatherReply, weatherSeed } from './weather'

const skill = { skill: { name: 'weather' }, tools: [weather] }

const berlin = [
  'Berlin, Germany — 15:45 local (Europe/Berlin)',
  'Now (measured 7 min ago): 19.6 °C, feels 19.5 °C, partly cloudy, wind 4 km/h from NW, humidity 59%',
  'Today Mon 24 Aug: 11.4 to 20.2 °C, overcast, 3% chance of rain',
  'Tue 25 Aug: 13.4 to 23.6 °C, overcast, 0% chance of rain',
  'Wed 26 Aug: 14 to 25.1 °C, light showers, 4 mm rain, 89% chance of rain',
  'Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in, 3.4 °C apart on the temperature now, so it is approximate.',
].join('\n')

const evidence = (result: string) => ({ toolResults: [{ tool: 'weather', result }], knownUrls: [] })

describe('weatherSeed', () => {
  it.each([
    ['Wie ist das Wetter in Berlin?', 'Berlin'],
    ['Wird es morgen in Lissabon regnen?', 'Lissabon'],
    ['Wie ist das Wetter in der Schweiz?', 'Schweiz'],
    ["What's the weather like in New York today?", 'New York'],
    ['Wetter Hamburg', 'Hamburg'],
    ['Wetter in Frankfurt am Main morgen', 'Frankfurt am Main'],
    ['Brauche ich heute einen Regenschirm in Köln?', 'Köln'],
  ])('looks %j up for %j', (message, place) => {
    expect(weatherSeed(skill, message)).toEqual({ name: 'weather', arguments: { place } })
  })

  it('keeps the place the conversation already settled when the follow-up names none', () => {
    const prior: TopicTurn[] = [
      { role: 'user', content: 'Wie ist das Wetter in Frankfurt?' },
      {
        role: 'assistant',
        content: 'In Frankfurt sind es gerade 18 °C.',
        toolCalls: [
          {
            name: 'weather',
            arguments: { place: 'Frankfurt' },
            status: 'done',
            result: 'Frankfurt am Main, Germany — 10:00 local\nNow: 18 °C',
          },
        ],
      },
    ]
    expect(weatherSeed(skill, 'Und morgen?', prior)).toEqual({
      name: 'weather',
      arguments: { place: 'Frankfurt am Main' },
    })
  })

  it('does not look up a place nobody named', () => {
    expect(weatherSeed(skill, 'Wie ist das Wetter?')).toBeNull()
    expect(weatherSeed(skill, 'Regnet es?')).toBeNull()
    expect(weatherSeed(skill, "How's the weather looking?")).toBeNull()
  })

  it('answers every weather turn in code, and asks when there is no place', () => {
    const grounding = groundingFor(skill, 'Wie ist das Wetter?')
    expect(grounding.groundWeather).toBe(true)
    expect(grounding.seed).toBeUndefined()
    expect(settleWeather({ toolResults: [], knownUrls: [] }, 'Wie ist das Wetter?')).toBe(
      'Für welchen Ort möchtest du das Wetter wissen?',
    )
  })
})

describe('weatherReply', () => {
  it('says the weather now in German, with a decimal comma and no English left in it', () => {
    expect(weatherReply(berlin, 'Wie ist das Wetter in Berlin?', 'de')).toBe(
      [
        'In Berlin sind es gerade 19,6 °C – teilweise bewölkt, Wind 4 km/h aus Nordwest, Luftfeuchtigkeit 59 %. Heute: 11,4 bis 20,2 °C, bedeckt, Regenwahrscheinlichkeit 3 %.',
        'Die Quellen liegen bei der aktuellen Temperatur 3,4 °C auseinander, der Wert ist also nur ungefähr.',
        'Quellen: Open-Meteo (ICON, GFS, ECMWF) und wttr.in',
      ].join('\n\n'),
    )
  })

  it('says it in English for an English question', () => {
    expect(weatherReply(berlin, "What's the weather in Berlin?", 'en')).toBe(
      [
        'In Berlin it is 19.6 °C right now – partly cloudy, wind 4 km/h from the north-west, humidity 59%. Today: 11.4 to 20.2 °C, overcast, 3% chance of rain.',
        'The sources are 3.4 °C apart on the current temperature, so treat it as approximate.',
        'Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in',
      ].join('\n\n'),
    )
  })

  it('answers about tomorrow from tomorrow’s line', () => {
    expect(weatherReply(berlin, 'Wie wird das Wetter morgen in Berlin?', 'de')).toMatch(
      /^Morgen \(Dienstag, 25\. August\) in Berlin: 13,4 bis 23,6 °C, bedeckt, Regenwahrscheinlichkeit 0 %\./,
    )
    expect(weatherReply(berlin, 'Weather in Berlin the day after tomorrow?', 'en')).toMatch(
      /^The day after tomorrow \(Wednesday 26 August\) in Berlin: 14 to 25\.1 °C, light showers, 89% chance of rain, about 4 mm of rain\./,
    )
  })

  it('does not hedge a day ahead with the spread in today’s temperature', () => {
    expect(weatherReply(berlin, 'Und morgen in Berlin?', 'de')).not.toMatch(/auseinander/)
    expect(weatherReply(berlin, 'Wetter in Berlin', 'de')).toMatch(/auseinander/)
  })

  it('leads a rain question with the answer', () => {
    expect(weatherReply(berlin, 'Regnet es übermorgen in Berlin?', 'de')).toMatch(
      /^Ja, wahrscheinlich\. Übermorgen/,
    )
    expect(weatherReply(berlin, 'Brauche ich morgen in Berlin einen Schirm?', 'de')).toMatch(
      /^Eher nicht\. Morgen/,
    )
  })

  it('keeps the article the user wrote the place with', () => {
    const swiss = berlin.replace('Berlin, Germany', 'Switzerland')
    expect(weatherReply(swiss, 'Wie ist das Wetter in der Schweiz?', 'de')).toMatch(
      /^In der Schweiz sind es gerade/,
    )
  })

  it('drops a condition it has no German for rather than mixing in English', () => {
    const odd = berlin.replace('partly cloudy', 'blowing widgets')
    expect(weatherReply(odd, 'Wetter in Berlin', 'de')).toMatch(
      /^In Berlin sind es gerade 19,6 °C – Wind 4 km\/h/,
    )
  })
})

describe('settleWeather', () => {
  it('answers from the reading and follows the chosen language', () => {
    expect(settleWeather(evidence(berlin), 'Weather in Berlin?', undefined, 'de')).toMatch(
      /^In Berlin sind es gerade/,
    )
  })

  it('asks which place was meant when the geocoder found none', () => {
    const error = 'No place called "Atlantis" was found. Ask which town or city was meant.'
    expect(settleWeather({ toolResults: [], knownUrls: [] }, 'Wetter in Atlantis?', error)).toBe(
      'Einen Ort namens „Atlantis“ habe ich nicht gefunden. Welche Stadt meinst du?',
    )
  })
})
