import type { TopicTurn } from '@/memory/topic'
import type { Tool } from '@/tools/types'
import { capitalize, formatDecimal, replyLanguageFor, wordPattern, type ReplyLanguage } from './language'
import { placeAsked, placeForTurn } from './places'
import type { ParsedToolCall } from './parse'
import type { ReviewEvidence } from './review'

/**
 * Weather answered in code from the reading, not retold by the model.
 *
 * Asked *Wie ist das Wetter in Berlin?*, the model skipped the tool and copied
 * the skill's own example — 19.6 °C and 59% humidity, presented as live — and
 * when it did call the tool its German came out as *Beige Wolken, leicht
 * nördlich vom Norden*. The reading is already reconciled across sources, so
 * all that is left is to say it in a sentence, and that is a job for code.
 */
export const WEATHER_SKILL = 'weather'

interface SkillTools {
  skill: { name: string }
  tools: Tool[]
}

/** The forced `weather` call, or null when this turn is not that skill or names no place. */
export function weatherSeed(
  activation: SkillTools | null,
  message: string,
  prior: readonly TopicTurn[] = [],
): ParsedToolCall | null {
  if (activation?.skill.name !== WEATHER_SKILL) return null
  if (!activation.tools.some((tool) => tool.schema.function.name === 'weather')) return null
  const place = placeForTurn(message, prior)
  if (!place) return null
  return { name: 'weather', arguments: { place: place.query } }
}

interface Now {
  temperature?: number
  feelsLike?: number
  summary?: string
  windKmph?: number
  windFrom?: string
  humidity?: number
  rainMmPerHour?: number
  ageMinutes?: number
}

interface Day {
  isToday: boolean
  weekday: string
  day: number
  month: string
  min?: number
  max?: number
  summary?: string
  rainMm?: number
  chance?: number
}

interface Reading {
  place: string
  now: Now | null
  days: Day[]
  sources: string | null
  /** Degrees the sources are apart, when that makes the reading approximate. */
  approximateBy: number | null
}

const NUMBER = '(-?\\d+(?:\\.\\d+)?)'

function parseNow(line: string): Now | null {
  const match = /^Now(?: \((?:measured just now|measured (\d+) min ago)\))?: (.+)$/.exec(line)
  if (!match?.[2] || match[2] === 'no reading available') return null
  const now: Now = {}
  if (match[1]) now.ageMinutes = Number(match[1])
  for (const part of match[2].split(', ')) {
    let found: RegExpExecArray | null
    if ((found = new RegExp(`^${NUMBER} °C$`).exec(part))) now.temperature = Number(found[1])
    else if ((found = new RegExp(`^feels ${NUMBER} °C$`).exec(part))) now.feelsLike = Number(found[1])
    else if ((found = new RegExp(`^wind ${NUMBER} km/h(?: from (\\w+))?$`).exec(part))) {
      now.windKmph = Number(found[1])
      if (found[2]) now.windFrom = found[2]
    } else if ((found = new RegExp(`^humidity ${NUMBER}%$`).exec(part))) now.humidity = Number(found[1])
    else if ((found = new RegExp(`^rain ${NUMBER} mm/h$`).exec(part))) now.rainMmPerHour = Number(found[1])
    else now.summary = part
  }
  return now
}

function parseDay(line: string): Day | null {
  const match = /^(Today )?(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2}) (\w{3}): (.*)$/.exec(line)
  if (!match?.[2] || !match[3] || !match[4]) return null
  const day: Day = { isToday: Boolean(match[1]), weekday: match[2], day: Number(match[3]), month: match[4] }
  for (const part of (match[5] ?? '').split(', ').filter(Boolean)) {
    let found: RegExpExecArray | null
    if ((found = new RegExp(`^${NUMBER} to ${NUMBER} °C$`).exec(part))) {
      day.min = Number(found[1])
      day.max = Number(found[2])
    } else if ((found = new RegExp(`^up to ${NUMBER} °C$`).exec(part))) day.max = Number(found[1])
    else if ((found = new RegExp(`^${NUMBER} mm rain$`).exec(part))) day.rainMm = Number(found[1])
    else if ((found = new RegExp(`^${NUMBER}% chance of rain$`).exec(part))) day.chance = Number(found[1])
    else day.summary = part
  }
  return day
}

/** The reading `weatherReport` wrote, read back line by line. Null when it is not one. */
export function parseWeatherReading(result: string): Reading | null {
  const lines = result.split('\n').map((line) => line.trim())
  const head = lines[0] ?? ''
  const nowLine = lines.find((line) => line.startsWith('Now'))
  if (!head || !nowLine) return null

  const sourcesLine = lines.find((line) => line.startsWith('Sources: ')) ?? ''
  const sources =
    /^Sources: (.+?)(?:, agreeing| only|, -?\d+(?:\.\d+)? °C apart)/.exec(sourcesLine)?.[1] ?? null
  const apart = new RegExp(`${NUMBER} °C apart on the temperature now, so it is approximate`).exec(
    sourcesLine,
  )

  return {
    place: head.split('—')[0]?.split(',')[0]?.trim() ?? head,
    now: parseNow(nowLine),
    days: lines.map(parseDay).filter((day): day is Day => day !== null),
    sources,
    approximateBy: apart?.[1] ? Number(apart[1]) : null,
  }
}

const GERMAN_CONDITIONS: Record<string, string> = {
  'clear sky': 'klarer Himmel',
  clear: 'klar',
  sunny: 'sonnig',
  'mainly clear': 'überwiegend klar',
  'partly cloudy': 'teilweise bewölkt',
  cloudy: 'bewölkt',
  overcast: 'bedeckt',
  mist: 'Dunst',
  haze: 'Dunst',
  fog: 'Nebel',
  'freezing fog': 'gefrierender Nebel',
  'light drizzle': 'leichter Nieselregen',
  'patchy light drizzle': 'stellenweise leichter Nieselregen',
  drizzle: 'Nieselregen',
  'heavy drizzle': 'starker Nieselregen',
  'freezing drizzle': 'gefrierender Nieselregen',
  'heavy freezing drizzle': 'starker gefrierender Nieselregen',
  'light rain': 'leichter Regen',
  'patchy light rain': 'stellenweise leichter Regen',
  'patchy rain nearby': 'vereinzelt Regen in der Nähe',
  'patchy rain possible': 'vereinzelt Regen möglich',
  'light rain shower': 'leichter Regenschauer',
  'moderate rain': 'mäßiger Regen',
  'moderate or heavy rain shower': 'mäßige bis starke Regenschauer',
  rain: 'Regen',
  'heavy rain': 'starker Regen',
  'freezing rain': 'gefrierender Regen',
  'heavy freezing rain': 'starker gefrierender Regen',
  'light snow': 'leichter Schneefall',
  'patchy light snow': 'stellenweise leichter Schneefall',
  snow: 'Schneefall',
  'moderate snow': 'mäßiger Schneefall',
  'heavy snow': 'starker Schneefall',
  'snow grains': 'Schneegriesel',
  'light showers': 'leichte Schauer',
  showers: 'Schauer',
  'violent showers': 'heftige Schauer',
  'light snow showers': 'leichte Schneeschauer',
  'snow showers': 'Schneeschauer',
  thunderstorm: 'Gewitter',
  'thundery outbreaks possible': 'Gewitter möglich',
  'thundery outbreaks in nearby': 'Gewitter in der Nähe',
  'thunderstorm with hail': 'Gewitter mit Hagel',
  'thunderstorm with heavy hail': 'Gewitter mit starkem Hagel',
}

/** A condition in the reply language, or nothing rather than an English phrase in a German reply. */
function condition(summary: string | undefined, language: ReplyLanguage): string | null {
  if (!summary) return null
  if (language === 'en') return summary
  return GERMAN_CONDITIONS[summary.toLowerCase()] ?? null
}

const COMPASS_WORDS = {
  de: { N: 'nord', E: 'ost', S: 'süd', W: 'west' },
  en: { N: 'north', E: 'east', S: 'south', W: 'west' },
} as const

/** `NW` as *Nordwest* or *the north-west*, `NNE` as *Nordnordost* or *the north-north-east*. */
function compassName(point: string, language: ReplyLanguage): string | null {
  const letters = point.toUpperCase().split('')
  if (letters.length === 0 || !letters.every((letter) => letter in COMPASS_WORDS.en)) return null
  const words = letters.map((letter) => COMPASS_WORDS[language][letter as keyof (typeof COMPASS_WORDS)['en']])
  return language === 'de' ? capitalize(words.join('')) : words.join('-')
}

const WEEKDAYS = {
  Sun: ['Sonntag', 'Sunday'],
  Mon: ['Montag', 'Monday'],
  Tue: ['Dienstag', 'Tuesday'],
  Wed: ['Mittwoch', 'Wednesday'],
  Thu: ['Donnerstag', 'Thursday'],
  Fri: ['Freitag', 'Friday'],
  Sat: ['Samstag', 'Saturday'],
} as const

const MONTHS: Record<string, [string, string]> = {
  Jan: ['Januar', 'January'],
  Feb: ['Februar', 'February'],
  Mar: ['März', 'March'],
  Apr: ['April', 'April'],
  May: ['Mai', 'May'],
  Jun: ['Juni', 'June'],
  Jul: ['Juli', 'July'],
  Aug: ['August', 'August'],
  Sep: ['September', 'September'],
  Oct: ['Oktober', 'October'],
  Nov: ['November', 'November'],
  Dec: ['Dezember', 'December'],
}

function dateLabel(day: Day, language: ReplyLanguage): string {
  const index = language === 'de' ? 0 : 1
  const weekday = WEEKDAYS[day.weekday as keyof typeof WEEKDAYS]?.[index] ?? day.weekday
  const month = MONTHS[day.month]?.[index] ?? day.month
  return language === 'de' ? `${weekday}, ${day.day}. ${month}` : `${weekday} ${day.day} ${month}`
}

const WEEKDAY_ASKED: [RegExp, keyof typeof WEEKDAYS][] = [
  [wordPattern('sonntag|sunday'), 'Sun'],
  [wordPattern('montag|monday'), 'Mon'],
  [wordPattern('dienstag|tuesday'), 'Tue'],
  [wordPattern('mittwoch|wednesday'), 'Wed'],
  [wordPattern('donnerstag|thursday'), 'Thu'],
  [wordPattern('freitag|friday'), 'Fri'],
  [wordPattern('samstag|sonnabend|saturday'), 'Sat'],
]

const DAY_AFTER_TOMORROW = wordPattern('übermorgen|uebermorgen|day after tomorrow')
const TOMORROW = wordPattern('morgen|tomorrow')
/** *heute Morgen* is this morning, not tomorrow. */
const THIS_MORNING = wordPattern('(?:heute|this)\\s+morgen')

/** Which day of the outlook the question is about; null for the weather right now. */
function dayAsked(question: string, days: Day[]): Day | null {
  if (DAY_AFTER_TOMORROW.test(question)) return days[2] ?? null
  if (TOMORROW.test(question) && !THIS_MORNING.test(question)) return days[1] ?? null
  for (const [pattern, weekday] of WEEKDAY_ASKED) {
    if (pattern.test(question)) return days.find((day) => day.weekday === weekday) ?? null
  }
  return null
}

const ASKS_RAIN = wordPattern('regnen|regnet|regen|schirm|regenschirm|rain|raining|umbrella|nass|wet')

function rainVerdict(chance: number, language: ReplyLanguage): string {
  if (language === 'de')
    return chance >= 60 ? 'Ja, wahrscheinlich.' : chance >= 30 ? 'Vielleicht.' : 'Eher nicht.'
  return chance >= 60 ? 'Yes, probably.' : chance >= 30 ? 'Possibly.' : 'Probably not.'
}

function degrees(value: number, language: ReplyLanguage): string {
  return `${formatDecimal(value, language)} °C`
}

function percent(value: number, language: ReplyLanguage): string {
  return language === 'de'
    ? `${formatDecimal(value, language, 0)} %`
    : `${formatDecimal(value, language, 0)}%`
}

function dayDetails(day: Day, language: ReplyLanguage): string[] {
  const parts: string[] = []
  const de = language === 'de'
  if (day.min !== undefined && day.max !== undefined) {
    parts.push(
      de
        ? `${formatDecimal(day.min, language)} bis ${degrees(day.max, language)}`
        : `${formatDecimal(day.min, language)} to ${degrees(day.max, language)}`,
    )
  } else if (day.max !== undefined) {
    parts.push(de ? `bis ${degrees(day.max, language)}` : `up to ${degrees(day.max, language)}`)
  }
  const sky = condition(day.summary, language)
  if (sky) parts.push(sky)
  if (day.chance !== undefined) {
    parts.push(
      de
        ? `Regenwahrscheinlichkeit ${percent(day.chance, language)}`
        : `${percent(day.chance, language)} chance of rain`,
    )
  }
  if (day.rainMm) {
    parts.push(
      de
        ? `etwa ${formatDecimal(day.rainMm, language)} mm Regen`
        : `about ${formatDecimal(day.rainMm, language)} mm of rain`,
    )
  }
  return parts
}

function nowSentence(place: string, now: Now, language: ReplyLanguage): string {
  const de = language === 'de'
  const details: string[] = []
  const sky = condition(now.summary, language)
  if (sky) details.push(sky)
  if (now.windKmph !== undefined) {
    const from = now.windFrom ? compassName(now.windFrom, language) : null
    const speed = `${formatDecimal(now.windKmph, language, 0)} km/h`
    details.push(
      de ? `Wind ${speed}${from ? ` aus ${from}` : ''}` : `wind ${speed}${from ? ` from the ${from}` : ''}`,
    )
  }
  if (now.humidity !== undefined) {
    details.push(
      de
        ? `Luftfeuchtigkeit ${percent(now.humidity, language)}`
        : `humidity ${percent(now.humidity, language)}`,
    )
  }
  if (now.rainMmPerHour) {
    details.push(
      de
        ? `Niederschlag ${formatDecimal(now.rainMmPerHour, language)} mm pro Stunde`
        : `rain ${formatDecimal(now.rainMmPerHour, language)} mm an hour`,
    )
  }

  let lead: string
  if (now.temperature !== undefined) {
    const feels =
      now.feelsLike !== undefined && Math.abs(now.feelsLike - now.temperature) >= 1
        ? de
          ? ` (gefühlt ${degrees(now.feelsLike, language)})`
          : ` (feels like ${degrees(now.feelsLike, language)})`
        : ''
    lead = de
      ? `In ${place} sind es gerade ${degrees(now.temperature, language)}${feels}`
      : `In ${place} it is ${degrees(now.temperature, language)} right now${feels}`
  } else {
    lead = de ? `Das Wetter in ${place} gerade` : `The weather in ${place} right now`
  }
  return details.length > 0 ? `${lead} – ${details.join(', ')}.` : `${lead}.`
}

function sourcesNote(reading: Reading, language: ReplyLanguage): string[] {
  const lines: string[] = []
  if (reading.approximateBy !== null) {
    lines.push(
      language === 'de'
        ? `Die Quellen liegen bei der aktuellen Temperatur ${degrees(reading.approximateBy, language)} auseinander, der Wert ist also nur ungefähr.`
        : `The sources are ${degrees(reading.approximateBy, language)} apart on the current temperature, so treat it as approximate.`,
    )
  }
  if (reading.sources) {
    lines.push(
      language === 'de'
        ? `Quellen: ${reading.sources.replace(/ and /g, ' und ')}`
        : `Sources: ${reading.sources}`,
    )
  }
  return lines
}

/** The weather in a sentence or two, in the reply language, from the reading alone. */
export function weatherReply(result: string, question: string, language: ReplyLanguage): string | null {
  const reading = parseWeatherReading(result)
  if (!reading) return null
  const de = language === 'de'
  const place = placeAsked(question)?.display ?? reading.place
  const asked = dayAsked(question, reading.days)
  const today = reading.days.find((day) => day.isToday) ?? reading.days[0] ?? null
  const rain = ASKS_RAIN.test(question)
  const paragraphs: string[] = []

  if (asked && !asked.isToday) {
    const label = dateLabel(asked, language)
    const when = DAY_AFTER_TOMORROW.test(question)
      ? de
        ? 'Übermorgen'
        : 'The day after tomorrow'
      : TOMORROW.test(question)
        ? de
          ? 'Morgen'
          : 'Tomorrow'
        : null
    const heading = when ? `${when} (${label})` : de ? `Am ${label}` : `On ${label}`
    const verdict = rain && asked.chance !== undefined ? `${rainVerdict(asked.chance, language)} ` : ''
    paragraphs.push(`${verdict}${heading} in ${place}: ${dayDetails(asked, language).join(', ')}.`)
  } else {
    const verdict = rain && today?.chance !== undefined ? `${rainVerdict(today.chance, language)} ` : ''
    const lines: string[] = []
    if (reading.now) lines.push(nowSentence(place, reading.now, language))
    if (today) {
      const details = dayDetails(today, language)
      if (details.length > 0) lines.push(`${de ? 'Heute' : 'Today'}: ${details.join(', ')}.`)
    }
    if (lines.length === 0) return null
    paragraphs.push(`${verdict}${lines.join(' ')}`)
    if (reading.now?.ageMinutes !== undefined && reading.now.ageMinutes > 60) {
      paragraphs.push(
        de
          ? `Die Messung ist ${reading.now.ageMinutes} Minuten alt.`
          : `The reading is ${reading.now.ageMinutes} minutes old.`,
      )
    }
  }

  paragraphs.push(...sourcesNote(reading, language))
  return paragraphs.join('\n\n')
}

const NO_PLACE = /^No place called "(.+)" was found/

/**
 * What the user sees after a forced weather lookup, without another generation.
 *
 * No place at all is a question back rather than a guess: the skill's own
 * example city is exactly what the model used to report instead.
 */
export function settleWeather(
  evidence: ReviewEvidence,
  question: string,
  error?: string,
  chosen?: string,
): string {
  const language = replyLanguageFor(question, chosen)
  for (const { tool, result } of [...evidence.toolResults].reverse()) {
    if (tool !== 'weather') continue
    const reply = weatherReply(result, question, language)
    if (reply) return reply
  }

  const de = language === 'de'
  const missing = error ? NO_PLACE.exec(error)?.[1] : undefined
  if (missing) {
    return de
      ? `Einen Ort namens „${missing}“ habe ich nicht gefunden. Welche Stadt meinst du?`
      : `I could not find a place called "${missing}". Which town or city do you mean?`
  }
  if (error) {
    return de
      ? `Das Wetter konnte ich gerade nicht abrufen: ${error}`
      : `I could not get the weather just now: ${error}`
  }
  return de ? 'Für welchen Ort möchtest du das Wetter wissen?' : 'Which place would you like the weather for?'
}
