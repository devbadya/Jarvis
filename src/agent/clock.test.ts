import { describe, expect, it } from 'vitest'
import { currentTime } from '@/tools/builtins'
import { clockReply, clockSeed, settleClock } from './clock'
import { groundingFor } from './ground'

const worldClock = { skill: { name: 'world-clock' }, tools: [currentTime] }
const currentDate = { skill: { name: 'current-date' }, tools: [currentTime] }

// Friday 25 September 2026, 20:53 UTC.
const now = new Date('2026-09-25T20:53:00Z')
const newYork = 'New York, United States — 16:53 EDT (UTC-4, America/New_York), Fri 25 Sep 2026'
const tokyo = 'Tokyo, Japan — 05:53 GMT+9 (UTC+9, Asia/Tokyo), Sat 26 Sep 2026'
const local = '22:53 CEST (UTC+2, Europe/Berlin), Fri 25 Sep 2026'

describe('clockSeed', () => {
  it('reads the place out of a world-clock question', () => {
    expect(clockSeed(worldClock, 'Wie viel Uhr ist es in New York?')).toEqual({
      name: 'current_time',
      arguments: { place: 'New York' },
    })
    expect(clockSeed(worldClock, 'What time is it in Tokyo right now?')).toEqual({
      name: 'current_time',
      arguments: { place: 'Tokyo' },
    })
  })

  it('reads the user’s own clock for a date question that names nowhere', () => {
    expect(clockSeed(currentDate, 'Welcher Tag ist heute?')).toEqual({ name: 'current_time', arguments: {} })
    expect(clockSeed(currentDate, 'und in Deutschland?')).toEqual({
      name: 'current_time',
      arguments: { place: 'Deutschland' },
    })
  })

  it('answers both clock skills in code', () => {
    expect(groundingFor(worldClock, 'Uhrzeit in Rom').groundClock).toBe(true)
    expect(groundingFor(currentDate, 'Wie spät ist es?').groundClock).toBe(true)
  })
})

describe('clockReply', () => {
  it.each([
    [newYork, 'Wie viel Uhr ist es in New York?', 'de', 'In New York ist es gerade 16:53 Uhr (EDT).'],
    [newYork, 'What time is it in New York?', 'en', 'In New York it is 16:53 EDT right now.'],
    [tokyo, 'Welches Datum ist in Tokio?', 'de', 'In Tokio ist heute Samstag, der 26. September 2026.'],
    [local, 'Wie spät ist es?', 'de', 'Es ist 22:53 Uhr.'],
    [local, 'What time is it?', 'en', 'It is 22:53.'],
    [local, 'Welcher Tag ist heute?', 'de', 'Heute ist Freitag, der 25. September 2026.'],
    [local, 'What day is it?', 'en', 'Today is Friday 25 September 2026.'],
    [local, 'Welches Jahr haben wir?', 'de', 'Wir haben das Jahr 2026.'],
    [local, 'Ist heute Montag?', 'de', 'Nein, heute ist Freitag, der 25. September 2026.'],
    [local, 'Is it Friday?', 'en', 'Yes, today is Friday 25 September 2026.'],
    [local, 'Uhrzeit und Datum bitte', 'de', 'Es ist 22:53 Uhr, am Freitag, dem 25. September 2026.'],
  ] as const)('reads %j for %j', (result, question, language, expected) => {
    expect(clockReply(result, question, language, now)).toBe(expected)
  })
})

describe('settleClock', () => {
  it('asks which place was meant when the geocoder found none', () => {
    const error = 'No place called "Atlantis" was found. Ask which town or city was meant.'
    expect(settleClock({ toolResults: [], knownUrls: [] }, 'Wie spät ist es in Atlantis?', error)).toBe(
      'Einen Ort namens „Atlantis“ habe ich nicht gefunden. Welche Stadt meinst du?',
    )
  })
})
