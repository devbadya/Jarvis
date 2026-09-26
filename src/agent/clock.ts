import type { TopicTurn } from '@/memory/topic'
import { clockViewFromResult, localClockInResult, placeFromClockResult } from '@/tools/clock'
import type { Tool } from '@/tools/types'
import { replyLanguageFor, wordPattern, type ReplyLanguage } from './language'
import { placeAsked, placeForTurn } from './places'
import type { ParsedToolCall } from './parse'
import type { ReviewEvidence } from './review'

/**
 * The time and the date answered in code from the clock reading.
 *
 * The reading is exact and the model's retelling was not: *Neu York – heute
 * wird es ca. 20:15 GMT UTC+10 (UTC-4, Europe/New-York)* came back for a
 * New York question whose tool call had been right.
 */
export const WORLD_CLOCK_SKILL = 'world-clock'
export const CURRENT_DATE_SKILL = 'current-date'

interface SkillTools {
  skill: { name: string }
  tools: Tool[]
}

/**
 * The forced `current_time` call, or null when this turn is not a clock skill.
 *
 * `current-date` is the user's own clock unless the message names somewhere
 * else — *und in Deutschland?* after *Wie spät ist es?*. `world-clock` needs a
 * place, and falls back to the one this conversation already settled.
 */
export function clockSeed(
  activation: SkillTools | null,
  message: string,
  prior: readonly TopicTurn[] = [],
): ParsedToolCall | null {
  const name = activation?.skill.name
  if (name !== WORLD_CLOCK_SKILL && name !== CURRENT_DATE_SKILL) return null
  if (!activation?.tools.some((tool) => tool.schema.function.name === 'current_time')) return null

  if (name === CURRENT_DATE_SKILL) {
    const place = placeAsked(message)
    return { name: 'current_time', arguments: place ? { place: place.query } : {} }
  }
  const place = placeForTurn(message, prior)
  return place ? { name: 'current_time', arguments: { place: place.query } } : null
}

type Asked = 'year' | 'month' | 'date' | 'time' | 'weekday-check' | 'both'

const ASKS_YEAR = wordPattern('year|jahr|welches jahr')
const ASKS_MONTH = wordPattern('month|monat')
const ASKS_DATE = wordPattern('date|datum|day|tag|wochentag')
const ASKS_TIME = wordPattern('time|uhr|uhrzeit|spät|spaet|clock|hour|stunde')
const WEEKDAY_CHECK = wordPattern(
  'is (?:it|today) (?:mon|tues|wednes|thurs|fri|satur|sun)day|ist (?:heute|es) (?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)',
)

function whatIsAsked(question: string): Asked {
  if (WEEKDAY_CHECK.test(question)) return 'weekday-check'
  const time = ASKS_TIME.test(question)
  const date = ASKS_DATE.test(question)
  if (time) return date ? 'both' : 'time'
  if (ASKS_YEAR.test(question)) return 'year'
  if (ASKS_MONTH.test(question) && !date) return 'month'
  return date ? 'date' : 'both'
}

interface DateParts {
  weekday: string
  day: string
  month: string
  year: string
}

function dateParts(now: Date, timeZone: string, language: ReplyLanguage): DateParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return {
    weekday: parts.weekday ?? '',
    day: parts.day ?? '',
    month: parts.month ?? '',
    year: parts.year ?? '',
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The zone abbreviation the reading printed after the time, `CEST` or `GMT-4`. */
function zoneName(result: string): string | null {
  const head = result.split('\n')[0] ?? ''
  return /\d{1,2}:\d{2} (\S+) \(UTC/.exec(head)?.[1] ?? null
}

const WEEKDAY_NAMES: [RegExp, string][] = [
  [wordPattern('montag|monday'), '1'],
  [wordPattern('dienstag|tuesday'), '2'],
  [wordPattern('mittwoch|wednesday'), '3'],
  [wordPattern('donnerstag|thursday'), '4'],
  [wordPattern('freitag|friday'), '5'],
  [wordPattern('samstag|saturday'), '6'],
  [wordPattern('sonntag|sunday'), '0'],
]

function weekdayNumber(now: Date, timeZone: string): string {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  return String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short))
}

/** A clock reading in a sentence, in the reply language. */
export function clockReply(
  result: string,
  question: string,
  language: ReplyLanguage,
  now: Date = new Date(),
): string | null {
  const clock = localClockInResult(result)
  const view = clockViewFromResult(result)
  if (!clock || !view) return null

  const de = language === 'de'
  const time = `${pad(clock.hour)}:${pad(clock.minute)}`
  const zone = zoneName(result)
  const date = dateParts(now, view.timeZone, language)
  const place = placeFromClockResult(result) ? (placeAsked(question)?.display ?? view.place) : null

  const nominative = de
    ? `${date.weekday}, der ${date.day}. ${date.month} ${date.year}`
    : `${date.weekday} ${date.day} ${date.month} ${date.year}`
  const dative = de ? `am ${date.weekday}, dem ${date.day}. ${date.month} ${date.year}` : `on ${nominative}`
  const clockText = de
    ? `${time} Uhr${zone && place ? ` (${zone})` : ''}`
    : `${time}${zone && place ? ` ${zone}` : ''}`

  switch (whatIsAsked(question)) {
    case 'year':
      if (place)
        return de ? `In ${place} haben wir das Jahr ${date.year}.` : `In ${place} it is ${date.year}.`
      return de ? `Wir haben das Jahr ${date.year}.` : `It is ${date.year}.`
    case 'month':
      return de ? `Wir haben ${date.month} ${date.year}.` : `It is ${date.month} ${date.year}.`
    case 'date':
      if (place) return de ? `In ${place} ist heute ${nominative}.` : `In ${place} it is ${nominative}.`
      return de ? `Heute ist ${nominative}.` : `Today is ${nominative}.`
    case 'weekday-check': {
      const today = weekdayNumber(now, view.timeZone)
      const named = WEEKDAY_NAMES.find(([pattern]) => pattern.test(question))?.[1]
      const yes = named === today
      return de
        ? `${yes ? 'Ja' : 'Nein'}, heute ist ${nominative}.`
        : `${yes ? 'Yes' : 'No'}, today is ${nominative}.`
    }
    case 'time':
      if (place)
        return de ? `In ${place} ist es gerade ${clockText}.` : `In ${place} it is ${clockText} right now.`
      return de ? `Es ist ${clockText}.` : `It is ${clockText}.`
    case 'both':
      if (place) {
        return de
          ? `In ${place} ist es gerade ${clockText}, ${dative}.`
          : `In ${place} it is ${clockText} right now, ${dative}.`
      }
      return de ? `Es ist ${clockText}, ${dative}.` : `It is ${clockText}, ${dative}.`
  }
}

const NO_PLACE = /^No place called "(.+)" was found/

/** What the user sees after a forced clock reading, without another generation. */
export function settleClock(
  evidence: ReviewEvidence,
  question: string,
  error?: string,
  chosen?: string,
): string {
  const language = replyLanguageFor(question, chosen)
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'current_time') continue
    const reply = clockReply(result, question, language)
    if (reply) return reply
  }

  const de = language === 'de'
  const missing = error ? NO_PLACE.exec(error)?.[1] : undefined
  if (missing) {
    return de
      ? `Einen Ort namens „${missing}“ habe ich nicht gefunden. Welche Stadt meinst du?`
      : `I could not find a place called "${missing}". Which town or city do you mean?`
  }
  if (error)
    return de
      ? `Die Uhrzeit konnte ich gerade nicht abrufen: ${error}`
      : `I could not read the clock just now: ${error}`
  return de ? 'Für welchen Ort möchtest du die Uhrzeit wissen?' : 'Which place would you like the time for?'
}
