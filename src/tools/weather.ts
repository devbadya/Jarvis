/**
 * Weather from several sources at once, reconciled before the model sees it.
 *
 * A forecast is not one number. Open-Meteo will serve DWD's ICON, NOAA's GFS and
 * ECMWF's IFS for the same point and they routinely disagree by a couple of
 * degrees, and an independent observation from wttr.in disagrees with all three.
 *
 * The comparison therefore happens here rather than in the conversation. Asking
 * a 0.8B model to open several forecast pages and weigh them up would spend the
 * whole context on the largest thing in it, and function-calling accuracy falls
 * by between 7% and 91% as tool output grows (arXiv:2505.10570). What reaches the
 * model instead is one short reading that already knows how far the sources are
 * apart, so the answer can hedge exactly when hedging is warranted.
 *
 * Every endpoint here is keyless and answers with `Access-Control-Allow-Origin: *`
 * on the real request from the deployed origin — the check that Tavily and Exa
 * failed. Nothing is proxied, because there is no server to proxy through.
 */

import { requestJson } from './web'

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const WTTR_ENDPOINT = 'https://wttr.in/'

/**
 * Named models rather than Open-Meteo's `best_match` blend, so the outlook is a
 * median of three national weather services and the spread between them is a
 * number this module can report instead of a detail it never saw.
 */
const MODELS = ['icon_seamless', 'gfs_seamless', 'ecmwf_ifs025'] as const
const MODEL_LABELS = 'ICON, GFS, ECMWF'
const FORECAST_DAYS = 3

/** Past this the sources are saying materially different things and the answer should say so. */
const DISAGREEMENT_LIMIT_C = 2

/**
 * How old a reading may be and still be quoted as the weather now.
 *
 * The two sources do not observe at the same rate. Open-Meteo publishes
 * `current` on a quarter-hourly grid — it returns `interval: 900` — while
 * wttr.in refreshes every half hour or so and serves it with
 * `Cache-Control: max-age=600`, which the browser will honour. Measured
 * together they are routinely 30 to 40 minutes apart in *age*, and that showed
 * up as a spread in temperature that read like forecast uncertainty: Hamburg
 * came back "2.4 °C apart, so it is approximate" from two sources that did not
 * disagree about any single moment. A reading older than this is therefore left
 * out of the current conditions rather than averaged into them, and only used
 * when it is all that answered.
 */
const STALE_LIMIT_MIN = 45

const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
].join(',')

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
].join(',')

/** WMO 4677 as Open-Meteo emits it. Left as prose because that is what the answer needs. */
const CONDITIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'freezing drizzle',
  57: 'heavy freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'violent showers',
  85: 'light snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Place {
  label: string
  latitude: number
  longitude: number
}

/** Current conditions, from whichever source supplied each field. */
interface Conditions {
  temperatureC: number | null
  feelsLikeC: number | null
  summary: string | null
  windKmph: number | null
  windFrom: string | null
  humidity: number | null
  precipitationMm: number | null
  localTime: string | null
  timezone: string | null
  /** When the source says it observed this, as an instant. Null when it does not say. */
  observedAt: number | null
}

interface DayOutlook {
  date: string
  minC: number | null
  maxC: number | null
  precipitationMm: number | null
  chancePercent: number | null
  summary: string | null
}

interface Reading {
  label: string
  conditions: Conditions
  days: DayOutlook[]
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** wttr.in returns every measurement as a string, including the ones that are numbers. */
function parsed(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return finite(Number(value))
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? null
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function spread(values: number[]): number | null {
  return values.length < 2 ? null : Math.max(...values) - Math.min(...values)
}

/** The condition most of the models agree on, which is more use than any one of them. */
function commonest(values: number[]): number | null {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let winner: number | null = null
  let best = 0
  for (const [value, count] of counts) {
    if (count > best) {
      winner = value
      best = count
    }
  }
  return winner
}

/** One decimal at most, and no trailing `.0` to read as false precision. */
function round(value: number, decimals = 1): string {
  return String(Number(value.toFixed(decimals)))
}

/** Formatted from the parts rather than through `toLocaleDateString`, which follows the host locale. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

function compass(degrees: number | null): string | null {
  if (degrees === null) return null
  return COMPASS[Math.round(degrees / 45) % 8] ?? null
}

/**
 * How long ago an observation was taken, in whole minutes.
 *
 * Clamped at zero: a quarter-hourly grid and a clock that is a minute out can
 * put a reading marginally in the future, and "measured -1 min ago" is worse
 * than treating it as current, which it is.
 */
function ageMinutes(observedAt: number | null, now: number): number | null {
  if (observedAt === null) return null
  return Math.max(0, Math.round((now - observedAt) / 60_000))
}

/**
 * `timezone=auto` makes Open-Meteo's `current.time` a local wall clock carrying
 * no offset, so it is only an instant alongside `utc_offset_seconds` from the
 * same response.
 */
function forecastObservedAt(time: string | undefined, offsetSeconds: number | null): number | null {
  if (!time) return null
  const asUtc = Date.parse(`${time}Z`)
  return Number.isNaN(asUtc) ? null : asUtc - (offsetSeconds ?? 0) * 1000
}

/** wttr.in stamps its observation in UTC and as a bare clock: `08:22 PM`, no date. */
const WTTR_CLOCK = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i

/**
 * The date has to be supplied from our own clock, and the observation can only
 * be behind it — so a time that lands ahead belongs to yesterday, which is what
 * an observation made at 23:50 UTC and read at 00:10 UTC looks like here.
 */
function wttrObservedAt(raw: string | undefined, now: number): number | null {
  const match = WTTR_CLOCK.exec(raw?.trim() ?? '')
  const hour12 = Number(match?.[1])
  const minute = Number(match?.[2])
  if (!match || !Number.isFinite(hour12) || !Number.isFinite(minute)) return null

  const meridiem = match[3]?.toUpperCase()
  const hour = (hour12 % 12) + (meridiem === 'PM' ? 12 : 0)

  const stamped = new Date(now)
  stamped.setUTCHours(hour, minute, 0, 0)
  const observedAt = stamped.getTime()
  return observedAt > now ? observedAt - 86_400_000 : observedAt
}

interface GeocodeResponse {
  results?: { name?: string; country?: string; latitude?: number; longitude?: number }[]
}

/** Where a place name starts in a question that has one: *weather in Berlin*, *Wetter für Rom*. */
const AFTER_PREPOSITION = /\b(?:in|at|for|near|around|f(?:ü|ue)r|um)\s+(.+)$/i

/** When the question was asked, which the geocoder reads as part of the name. */
const WHEN =
  /\b(?:today|tonight|tomorrow|now|right now|currently|at the moment|this (?:week|weekend|morning|afternoon|evening)|heute|morgen|jetzt|gerade|aktuell|abend|nachmittag|diese woche|am wochenende)\b/gi

/** What the question was about, which is never part of the place either. */
const SUBJECT =
  /\b(?:the\s+)?(?:weather|forecast|temperature|climate|conditions|rain|snow|wetter|vorhersage|wettervorhersage|temperatur|regen|schnee|unwetter)\b/gi

/**
 * The argument as the model passed it, then progressively less of it.
 *
 * The skill asks for the place as the user wrote it, and what a 0.8B model
 * hears in *Wie ist das Wetter in Berlin?* is often the whole phrase. The
 * geocoder matches names, so `Wetter in Berlin` and `Hamburg heute` find
 * nothing and the tool failed outright — the reported "weather does not work".
 *
 * The raw argument is always tried first, and that ordering is the safeguard:
 * In Salah and Rio de Janeiro are places, and stripping them down would answer
 * about somewhere else. Only a name the geocoder has already rejected is
 * narrowed.
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
      // Question marks and the punctuation left behind by the words removed above.
      .replace(/[?!.,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (stripped) candidates.push(stripped)
  }

  return [...new Set(candidates)].filter(Boolean)
}

async function lookUp(name: string): Promise<Place | null> {
  const params = new URLSearchParams({ name, count: '1', language: 'en', format: 'json' })
  const payload = await requestJson<GeocodeResponse>(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
    label: 'The place lookup',
  })

  const first = payload.results?.[0]
  const latitude = finite(first?.latitude)
  const longitude = finite(first?.longitude)
  if (!first || latitude === null || longitude === null) return null

  return {
    label: [first.name, first.country].filter(Boolean).join(', ') || name,
    latitude,
    longitude,
  }
}

async function geocode(place: string): Promise<Place> {
  for (const candidate of placeCandidates(place)) {
    const found = await lookUp(candidate)
    if (found) return found
  }

  // Named so the model can ask rather than call again with the same phrase: it
  // has no other way to tell a place that does not exist from one it never
  // isolated.
  throw new Error(`No place called "${place.trim()}" was found. Ask which town or city was meant.`)
}

interface ForecastResponse {
  timezone?: string
  utc_offset_seconds?: number
  current?: {
    time?: string
    temperature_2m?: number
    apparent_temperature?: number
    relative_humidity_2m?: number
    precipitation?: number
    weather_code?: number
    wind_speed_10m?: number
    wind_direction_10m?: number
  }
  /** Keys carry a `_<model>` suffix once `models` is set, so they are read by name. */
  daily?: Record<string, unknown>
}

function series(daily: Record<string, unknown>, field: string, model: string): unknown[] {
  const value = daily[`${field}_${model}`]
  return Array.isArray(value) ? value : []
}

/** Every model's value for one day, with the ones a model did not supply dropped. */
function acrossModels(daily: Record<string, unknown>, field: string, index: number): number[] {
  return MODELS.map((model) => finite(series(daily, field, model)[index])).filter(
    (value): value is number => value !== null,
  )
}

/**
 * One outlook from three models, taken as the median rather than as a favourite.
 *
 * The models disagree by two or three degrees on a normal day. The middle of
 * three national services is a better number than any one of them, and it costs
 * the model nothing to read.
 */
function dailyOutlook(daily: Record<string, unknown>): DayOutlook[] {
  const dates = Array.isArray(daily.time) ? daily.time : []

  return dates.flatMap((date, index): DayOutlook[] => {
    if (typeof date !== 'string') return []

    const maxima = acrossModels(daily, 'temperature_2m_max', index)
    const minima = acrossModels(daily, 'temperature_2m_min', index)
    if (maxima.length === 0 && minima.length === 0) return []

    const code = commonest(acrossModels(daily, 'weather_code', index))
    return [
      {
        date,
        minC: median(minima),
        maxC: median(maxima),
        precipitationMm: median(acrossModels(daily, 'precipitation_sum', index)),
        chancePercent: median(acrossModels(daily, 'precipitation_probability_max', index)),
        summary: code === null ? null : (CONDITIONS[code] ?? null),
      },
    ]
  })
}

async function fetchOpenMeteo(place: Place): Promise<Reading> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: CURRENT_FIELDS,
    daily: DAILY_FIELDS,
    models: MODELS.join(','),
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto',
  })

  const payload = await requestJson<ForecastResponse>(
    `${FORECAST_ENDPOINT}?${params.toString()}`,
    { label: 'Open-Meteo' },
    // The question is what the weather is doing now, so a reply out of the HTTP
    // cache is the one answer this tool must not give.
    { cache: 'no-store' },
  )

  const current = payload.current ?? {}
  const code = finite(current.weather_code)

  return {
    label: `Open-Meteo (${MODEL_LABELS})`,
    conditions: {
      temperatureC: finite(current.temperature_2m),
      feelsLikeC: finite(current.apparent_temperature),
      summary: code === null ? null : (CONDITIONS[code] ?? null),
      windKmph: finite(current.wind_speed_10m),
      windFrom: compass(finite(current.wind_direction_10m)),
      humidity: finite(current.relative_humidity_2m),
      precipitationMm: finite(current.precipitation),
      // `timezone=auto` makes this the clock at the place asked about, which is
      // the only one that tells the user whether the reading is fresh.
      localTime: current.time?.slice(11, 16) ?? null,
      timezone: payload.timezone ?? null,
      observedAt: forecastObservedAt(current.time, finite(payload.utc_offset_seconds)),
    },
    days: dailyOutlook(payload.daily ?? {}),
  }
}

interface WttrResponse {
  current_condition?: {
    /** UTC, and a clock rather than a timestamp: `08:22 PM`. */
    observation_time?: string
    temp_C?: string
    FeelsLikeC?: string
    humidity?: string
    windspeedKmph?: string
    winddir16Point?: string
    precipMM?: string
    weatherDesc?: { value?: string }[]
  }[]
  weather?: {
    date?: string
    maxtempC?: string
    mintempC?: string
    hourly?: { chanceofrain?: string }[]
  }[]
}

/**
 * A second opinion from an unrelated pipeline, asked by coordinate rather than by
 * name so it cannot answer about a different Springfield than the one geocoded.
 */
async function fetchWttr(place: Place): Promise<Reading> {
  const point = `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`
  const payload = await requestJson<WttrResponse>(
    `${WTTR_ENDPOINT}${point}?format=j1`,
    { label: 'wttr.in' },
    // `Cache-Control: max-age=600` on this endpoint, which would otherwise add
    // ten minutes to an observation that is already the older of the two.
    { cache: 'no-store' },
  )

  const current = payload.current_condition?.[0] ?? {}
  const days = (payload.weather ?? []).slice(0, FORECAST_DAYS).flatMap((day): DayOutlook[] => {
    if (typeof day.date !== 'string') return []
    const chances = (day.hourly ?? [])
      .map((hour) => parsed(hour.chanceofrain))
      .filter((value): value is number => value !== null)
    return [
      {
        date: day.date,
        minC: parsed(day.mintempC),
        maxC: parsed(day.maxtempC),
        precipitationMm: null,
        chancePercent: chances.length === 0 ? null : Math.max(...chances),
        summary: null,
      },
    ]
  })

  return {
    label: 'wttr.in',
    conditions: {
      temperatureC: parsed(current.temp_C),
      feelsLikeC: parsed(current.FeelsLikeC),
      summary: current.weatherDesc?.[0]?.value?.trim().toLowerCase() ?? null,
      windKmph: parsed(current.windspeedKmph),
      windFrom: current.winddir16Point ?? null,
      humidity: parsed(current.humidity),
      precipitationMm: parsed(current.precipMM),
      localTime: null,
      timezone: null,
      observedAt: wttrObservedAt(current.observation_time, Date.now()),
    },
    days,
  }
}

/** Whichever source answered first in the order it was handed, field by field. */
function merge<T>(readings: Reading[], pick: (conditions: Conditions) => T | null): T | null {
  for (const reading of readings) {
    const value = pick(reading.conditions)
    if (value !== null && value !== '') return value
  }
  return null
}

/**
 * How far apart the independent sources are on the temperature right now.
 *
 * Deliberately not mixed with the spread between forecast models: that spread is
 * ordinary forecast uncertainty and is already absorbed by taking the median,
 * whereas two providers three degrees apart on the current temperature is a fact
 * about the answer's confidence.
 */
function disagreement(readings: Reading[]): number | null {
  return spread(
    readings
      .map((reading) => reading.conditions.temperatureC)
      .filter((value): value is number => value !== null),
  )
}

function conditionsLine(conditions: Conditions, now: number): string {
  const parts: string[] = []
  if (conditions.temperatureC !== null) parts.push(`${round(conditions.temperatureC)} °C`)
  if (conditions.feelsLikeC !== null) parts.push(`feels ${round(conditions.feelsLikeC)} °C`)
  if (conditions.summary) parts.push(conditions.summary)
  if (conditions.windKmph !== null) {
    const from = conditions.windFrom ? ` from ${conditions.windFrom}` : ''
    parts.push(`wind ${round(conditions.windKmph, 0)} km/h${from}`)
  }
  if (conditions.humidity !== null) parts.push(`humidity ${round(conditions.humidity, 0)}%`)
  // Zeroes are dropped throughout: "rain 0 mm/h" invites the model to mention
  // rain in an answer about a clear afternoon.
  if (conditions.precipitationMm) parts.push(`rain ${round(conditions.precipitationMm)} mm/h`)
  if (parts.length === 0) return 'Now: no reading available'
  return `Now${freshness(conditions.observedAt, now)}: ${parts.join(', ')}`
}

/**
 * How old the quoted reading is, said in the reading itself.
 *
 * The clock beside the place name is the observation's, not the user's, so on a
 * quarter-hourly grid it is normally a few minutes behind the question — which
 * reads as a stale answer unless the reading says how far behind it is.
 */
function freshness(observedAt: number | null, now: number): string {
  const age = ageMinutes(observedAt, now)
  if (age === null) return ''
  return age < 2 ? ' (measured just now)' : ` (measured ${age} min ago)`
}

function dayLine(day: DayOutlook, isToday: boolean): string {
  const parts: string[] = []
  if (day.minC !== null && day.maxC !== null) parts.push(`${round(day.minC)} to ${round(day.maxC)} °C`)
  else if (day.maxC !== null) parts.push(`up to ${round(day.maxC)} °C`)
  if (day.summary) parts.push(day.summary)
  if (day.precipitationMm) parts.push(`${round(day.precipitationMm)} mm rain`)
  if (day.chancePercent !== null) parts.push(`${round(day.chancePercent, 0)}% chance of rain`)

  const label = isToday ? `Today ${shortDate(day.date)}` : shortDate(day.date)
  return `${label}: ${parts.join(', ')}`
}

/**
 * States the disagreement in words as well as in degrees.
 *
 * A 0.8B model comparing a number against a threshold is a coin toss, so the
 * threshold is applied here and the sentence says outright whether the reading
 * can be quoted or should be hedged.
 *
 * A source held back for its age is named too, with the age that disqualified
 * it: the answer is then one source down, and a reply that says so is worth more
 * than one that quietly looks better cross-checked than it is.
 */
function sourcesLine(used: Reading[], stale: Reading[], gap: number | null, now: number): string {
  const labels = used.map((reading) => reading.label).join(' and ')
  const held = stale
    .map(
      (reading) =>
        ` ${reading.label} answered but was ${ageMinutes(reading.conditions.observedAt, now)} min old, so it was left out.`,
    )
    .join('')

  if (gap === null) return `Sources: ${labels} only, with no second reading to check it against.${held}`
  if (gap > DISAGREEMENT_LIMIT_C) {
    return `Sources: ${labels}, ${round(gap)} °C apart on the temperature now, so it is approximate.${held}`
  }
  return `Sources: ${labels}, agreeing within ${round(gap)} °C on the temperature now.${held}`
}

/**
 * Which readings may speak for the present moment, freshest first.
 *
 * Two things happen here. Ordering by observation puts the newest measurement in
 * front of `merge`, so the quoted temperature is the most recent one available
 * rather than whichever provider this module happens to ask first. And a reading
 * past `STALE_LIMIT_MIN` is set aside — unless every reading is, in which case
 * an old measurement is still the only answer there is and `freshness` says how
 * old it is.
 */
function byFreshness(readings: Reading[], now: number): { used: Reading[]; stale: Reading[] } {
  const ordered = [...readings].sort(
    (a, b) => (b.conditions.observedAt ?? 0) - (a.conditions.observedAt ?? 0),
  )
  const current = ordered.filter((reading) => {
    const age = ageMinutes(reading.conditions.observedAt, now)
    return age === null || age <= STALE_LIMIT_MIN
  })

  if (current.length === 0) return { used: ordered, stale: [] }
  return { used: current, stale: ordered.filter((reading) => !current.includes(reading)) }
}

function formatReading(place: Place, readings: Reading[], now: number): string {
  const { used, stale } = byFreshness(readings, now)

  const conditions: Conditions = {
    temperatureC: merge(used, (entry) => entry.temperatureC),
    feelsLikeC: merge(used, (entry) => entry.feelsLikeC),
    summary: merge(used, (entry) => entry.summary),
    windKmph: merge(used, (entry) => entry.windKmph),
    windFrom: merge(used, (entry) => entry.windFrom),
    humidity: merge(used, (entry) => entry.humidity),
    precipitationMm: merge(used, (entry) => entry.precipitationMm),
    localTime: merge(used, (entry) => entry.localTime),
    timezone: merge(used, (entry) => entry.timezone),
    observedAt: merge(used, (entry) => entry.observedAt),
  }

  const clock =
    conditions.localTime === null
      ? ''
      : ` — ${conditions.localTime} local${conditions.timezone ? ` (${conditions.timezone})` : ''}`

  // The outlook is unaffected by staleness: a day's maximum does not go off in
  // half an hour, and only Open-Meteo has three models behind it.
  const days = readings.find((reading) => reading.days.length > 0)?.days ?? []

  return [
    `${place.label}${clock}`,
    conditionsLine(conditions, now),
    ...days.map((day, index) => dayLine(day, index === 0)),
    sourcesLine(used, stale, disagreement(used), now),
  ].join('\n')
}

/**
 * The whole reading in one call.
 *
 * A turn is capped at `MAX_TOOL_ROUNDS` rounds, and a tool that needs the model
 * to chain three calls to be useful is the wrong shape — so the geocode and both
 * providers happen here, and a provider that fails is dropped rather than
 * allowed to take the answer down with it.
 */
export async function weatherReport(place: string): Promise<string> {
  const located = await geocode(place)

  const settled = await Promise.allSettled([fetchOpenMeteo(located), fetchWttr(located)])
  const readings = settled
    .filter((result): result is PromiseFulfilledResult<Reading> => result.status === 'fulfilled')
    .map((result) => result.value)

  if (readings.length === 0) {
    const reasons = settled.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [],
    )
    throw new Error(`No weather source answered for ${located.label}: ${reasons.join('; ')}`)
  }

  // Read once, after both requests, so every age in the reading is measured
  // against the same instant.
  return formatReading(located, readings, Date.now())
}
