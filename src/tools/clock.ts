/**
 * A live clock for a named place, or for the user when none is given.
 *
 * The reading is always `new Date()` at call time — the model's training data
 * does not contain "now", and answering a second city from an earlier reading
 * is how a 0.8B model invents a timezone. Conversion is `Intl` plus an IANA
 * zone, so daylight saving is the engine's problem rather than the model's.
 *
 * Named places are resolved through the same Open-Meteo geocoder the weather
 * tool already uses (`Access-Control-Allow-Origin: *` on the real request from
 * the deployed origin). The first hit is not good enough: English ranking for
 * *Deutschland* is a town in Austria, and for *Tokio* a town in Illinois, so
 * English and German results are scored together and countries and capitals
 * beat similarly named villages.
 */

import { requestJson } from './web'

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const GEOCODE_LANGUAGES = ['en', 'de'] as const
const GEOCODE_COUNT = 5

/** German names the English index ranks as a different, smaller place. */
const ALIASES: Record<string, string> = {
  deutschland: 'Germany',
  tokio: 'Tokyo',
  wien: 'Vienna',
  mailand: 'Milan',
  rom: 'Rome',
  brüssel: 'Brussels',
  bruessel: 'Brussels',
  moskau: 'Moscow',
  peking: 'Beijing',
}

const AFTER_PREPOSITION = /\b(?:in|at|for|near|around|f(?:ü|ue)r|um)\s+(.+)$/i

const WHEN =
  /\b(?:today|tonight|now|right now|currently|at the moment|this (?:week|weekend|morning|afternoon|evening)|heute|morgen|jetzt|gerade|aktuell|abend|nachmittag)\b/gi

const SUBJECT =
  /\b(?:the\s+)?(?:time|date|clock|hour|timezone|time zone|world clock|uhrzeit|uhr|datum|weltuhr|zeitzone|zeit)\b/gi

const LOCAL_PLACE = /^(here|local|me|my (clock|timezone)|hier|lokal)$/i

/** Leftover from *wie viel uhr es in deutschland ist* after the place is cut out. */
const TRAILING_COPULA = /\b(?:ist|is|are|was|war|sein)\s*$/i

const WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)\b/i

/** A local reading now leads with HH:MM, not the weekday. */
const TIME_HEAD = /^\d{1,2}:\d{2}\b/

interface GeocodeHit {
  id?: number
  name?: string
  country?: string
  timezone?: string
  feature_code?: string
  population?: number
}

interface GeocodeResponse {
  results?: GeocodeHit[]
}

export interface Place {
  label: string
  timeZone: string
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The argument as the model passed it, then progressively less of it.
 *
 * A 0.8B model often hands over the whole question. The geocoder matches names,
 * so `time in Berlin` and `Wie spät ist es in Deutschland?` have to be narrowed
 * the same way the weather tool narrows `Wetter in Berlin`.
 */
export function placeCandidates(raw: string): string[] {
  const trimmed = raw.trim()
  const candidates = [trimmed]

  const after = AFTER_PREPOSITION.exec(trimmed)?.[1]
  if (after) candidates.push(after)

  for (const candidate of [...candidates]) {
    const stripped = candidate
      .replace(WHEN, ' ')
      .replace(SUBJECT, ' ')
      .replace(TRAILING_COPULA, ' ')
      .replace(/[?!.,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (stripped) candidates.push(stripped)
  }

  for (const candidate of [...candidates]) {
    const alias = ALIASES[candidate.trim().toLowerCase()]
    if (alias) candidates.push(alias)
  }

  return [...new Set(candidates)].filter(Boolean)
}

/** IANA names (`Europe/Berlin`, `UTC`) skip the geocoder. */
export function isTimeZone(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes(' ')) return false
  try {
    Intl.DateTimeFormat('en', { timeZone: trimmed })
    return true
  } catch {
    return false
  }
}

function scoreHit(hit: GeocodeHit, query: string): number {
  const asked = query.trim().toLowerCase()
  const name = (hit.name ?? '').toLowerCase()
  let score = 0
  if (name === asked) score += 100
  else if (name.startsWith(asked) || asked.startsWith(name)) score += 20

  const feature = hit.feature_code ?? ''
  if (feature === 'PCLI') score += 80
  else if (feature === 'PPLC') score += 60
  else if (feature.startsWith('PPLA')) score += 30
  else if (feature === 'PPL') score += 10

  const population = finite(hit.population) ?? 0
  score += Math.log10(population + 1)
  return score
}

function placeLabel(hit: GeocodeHit, fallback: string): string {
  const name = hit.name?.trim()
  const country = hit.country?.trim()
  if (name && country && name !== country) return `${name}, ${country}`
  return name || country || fallback
}

async function fetchHits(name: string, language: string): Promise<GeocodeHit[]> {
  const params = new URLSearchParams({
    name,
    count: String(GEOCODE_COUNT),
    language,
    format: 'json',
  })
  const payload = await requestJson<GeocodeResponse>(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
    label: 'The place lookup',
  })
  return payload.results ?? []
}

async function lookUp(name: string): Promise<Place | null> {
  const settled = await Promise.all(
    GEOCODE_LANGUAGES.map((language) => fetchHits(name, language).catch(() => [] as GeocodeHit[])),
  )
  const hits = settled.flat().filter((hit) => typeof hit.timezone === 'string' && hit.timezone.trim())
  if (hits.length === 0) return null

  hits.sort((left, right) => scoreHit(right, name) - scoreHit(left, name))
  const winner = hits[0]
  if (!winner?.timezone) return null
  return { label: placeLabel(winner, name), timeZone: winner.timezone }
}

async function geocode(place: string): Promise<Place> {
  for (const candidate of placeCandidates(place)) {
    if (isTimeZone(candidate)) return { label: candidate, timeZone: candidate }
    const found = await lookUp(candidate)
    if (found) return found
  }

  throw new Error(`No place called "${place.trim()}" was found. Ask which town or city was meant.`)
}

function pad(value: string | number | undefined): string {
  return String(value ?? '').padStart(2, '0')
}

function clockParts(
  now: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, ...options })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

/**
 * Minutes east of UTC at this instant, from the zone's own calendar.
 *
 * The wall clock is then `UTC + this`, so the hour the model sees is not the
 * `hour` field Intl happened to emit (hourCycle has disagreed with the offset
 * on some engines) and is never the `Z` hour of `toISOString()`.
 */
export function zoneOffsetMinutes(now: Date, timeZone: string): number {
  const parts = clockParts(now, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return Math.round((asUtc - now.getTime()) / 60_000)
}

export function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(totalMinutes)
  const hours = Math.trunc(absolute / 60)
  const minutes = absolute % 60
  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad(minutes)}`
}

export interface LocalClock {
  hour: number
  minute: number
  second: number
  weekday: string
  day: string
  month: string
  year: string
  zoneName: string
  timeZone: string
  offsetLabel: string
}

/** The wall clock in `timeZone` at `now`, hour taken from UTC plus the offset. */
export function localClock(now: Date, timeZone: string): LocalClock {
  const offsetMinutes = zoneOffsetMinutes(now, timeZone)
  const wall = new Date(now.getTime() + offsetMinutes * 60_000)
  const names = clockParts(now, timeZone, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZoneName: 'short',
  })

  return {
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    weekday: names.weekday ?? '',
    day: names.day ?? '',
    month: names.month ?? '',
    year: names.year ?? '',
    zoneName: names.timeZoneName ?? timeZone,
    timeZone,
    offsetLabel: formatOffset(offsetMinutes),
  }
}

/**
 * Local hour first, no UTC instant.
 *
 * A 0.8B model copies the first HH:MM it sees. Putting `toISOString()` on the
 * same line taught it to answer 20:40 for Germany when the wall clock was 22:40
 * CEST — the minutes matched and the hour was UTC.
 */
export function formatClock(now: Date, timeZone: string, place?: string): string {
  const clock = localClock(now, timeZone)
  const time = `${pad(clock.hour)}:${pad(clock.minute)}`
  const reading = `${time} ${clock.zoneName} (${clock.offsetLabel}, ${clock.timeZone}), ${clock.weekday} ${clock.day} ${clock.month} ${clock.year}`
  return place ? `${place} — ${reading}` : reading
}

/** The local HH:MM a clock result put first, or null when the line is not one. */
export function localClockInResult(result: string): { hour: number; minute: number } | null {
  const head = result.split('\n')[0] ?? ''
  const match = /(?:^|—)\s*(\d{1,2}):(\d{2})\b/.exec(head)
  if (!match?.[1] || !match[2]) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export interface ClockView {
  place: string | null
  timeZone: string
}

/**
 * The IANA zone a clock result named, so the card can keep ticking after the
 * snapshot the model read has gone stale.
 *
 * The line ends `(UTC+2, Europe/Berlin)`; the second group is the zone. A
 * failed call, or a result from another tool, has none.
 */
export function clockViewFromResult(result: string): ClockView | null {
  const head = result.split('\n')[0] ?? ''
  const match = /\(UTC[+-][\d:]+,\s*([^)]+)\)/.exec(head)
  const timeZone = match?.[1]?.trim()
  if (!timeZone || !isTimeZone(timeZone)) return null
  return { place: placeFromClockResult(head), timeZone }
}

/**
 * The compact face the card keeps live: seconds included, so a minute that
 * has moved is visible without opening anything.
 */
export function formatClockFace(now: Date, timeZone: string): string {
  const clock = localClock(now, timeZone)
  return `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)} ${clock.zoneName}`
}

/** Same shape as `formatClock`, with seconds, for the ticking card. */
export function formatLiveClock(now: Date, timeZone: string, place?: string): string {
  const clock = localClock(now, timeZone)
  const time = `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
  const reading = `${time} ${clock.zoneName} (${clock.offsetLabel}, ${clock.timeZone}), ${clock.weekday} ${clock.day} ${clock.month} ${clock.year}`
  return place ? `${place} — ${reading}` : reading
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * The city a clock reading actually resolved, or null for a local one.
 *
 * Local readings lead with HH:MM; world readings lead with the geocoded
 * label. `topic.ts` uses the same split as the weather header.
 */
export function placeFromClockResult(result: string): string | null {
  const head = result.split('\n')[0] ?? ''
  const beforeDash = head.split('—')[0]?.trim() ?? ''
  const city = beforeDash.split(',')[0]?.trim()
  if (!city || WEEKDAY.test(city) || TIME_HEAD.test(city)) return null
  return city
}

/**
 * One compact reading, taken now.
 *
 * An empty place is the user's own clock and needs no network. A named place
 * is geocoded, then formatted in that zone, so a second call a minute later
 * cannot reuse the first.
 */
export async function clockReading(place = '', now = new Date()): Promise<string> {
  const trimmed = place.trim()
  if (!trimmed || LOCAL_PLACE.test(trimmed)) {
    return formatClock(now, localZone())
  }
  if (isTimeZone(trimmed)) {
    return formatClock(now, trimmed, trimmed)
  }

  const located = await geocode(trimmed)
  return formatClock(now, located.timeZone, located.label)
}
