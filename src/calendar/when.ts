/**
 * Turns the way people name a moment into a local wall-clock stamp.
 *
 * The model is asked to pass the words the user used — `Friday 15:00`,
 * `morgen 15 Uhr` — rather than an ISO string it would have to invent. A wrong
 * date here is a wrong appointment, so anything this cannot read is refused
 * instead of guessed at.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sonntag: 0,
  monday: 1,
  montag: 1,
  tuesday: 2,
  dienstag: 2,
  wednesday: 3,
  mittwoch: 3,
  thursday: 4,
  donnerstag: 4,
  friday: 5,
  freitag: 5,
  saturday: 6,
  samstag: 6,
}

const PARTS: Record<string, Clock> = {
  morning: { hours: 9, minutes: 0 },
  morgens: { hours: 9, minutes: 0 },
  vormittag: { hours: 9, minutes: 0 },
  afternoon: { hours: 14, minutes: 0 },
  nachmittag: { hours: 14, minutes: 0 },
  evening: { hours: 19, minutes: 0 },
  abend: { hours: 19, minutes: 0 },
  abends: { hours: 19, minutes: 0 },
  night: { hours: 21, minutes: 0 },
  nacht: { hours: 21, minutes: 0 },
}

const FILLER = new Set([
  'at',
  'um',
  'am',
  'on',
  'the',
  'den',
  'der',
  'die',
  'das',
  'zum',
  'zur',
  'fuer',
  'for',
  'gegen',
  'about',
  'around',
  'circa',
  'ca',
  'this',
  'diesen',
  'diese',
  'dieser',
])

const NEXT = new Set(['next', 'naechsten', 'naechste', 'naechster', 'kommenden', 'kommende'])

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const LONG_DAY_DE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']

interface Clock {
  hours: number
  minutes: number
}

export interface WhenSpan {
  start: string
  end?: string
}

function fold(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/\s+/g, ' ')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function unreadable(input: string): Error {
  return new Error(
    `Could not read "${input.trim()}" as a time. Say a day and a clock, for example "Friday 15:00" or "morgen 15 Uhr".`,
  )
}

function clock(hours: number, minutes: number, suffix?: string): Clock {
  let normalized = hours
  if (suffix === 'pm') {
    if (hours > 12) throw new Error(`${hours}pm is not a time`)
    if (hours < 12) normalized += 12
  }
  if (suffix === 'am') {
    if (hours > 12) throw new Error(`${hours}am is not a time`)
    if (hours === 12) normalized = 0
  }
  if (normalized > 23 || minutes > 59 || normalized < 0 || minutes < 0) {
    throw new Error(`${hours}:${pad(minutes)} is not a time`)
  }
  return { hours: normalized, minutes }
}

function stamp(date: Date, time?: Clock): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (!time) return day
  return `${day}T${pad(time.hours)}:${pad(time.minutes)}`
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

interface Split {
  year: number
  month: number
  day: number
  time?: string
}

function splitStamp(value: string): Split {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value)
  if (!match) throw new Error(`bad stamp ${value}`)
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    ...(match[4] ? { time: `${match[4]}:${match[5]}` } : {}),
  }
}

function weekdayOf(parts: Split): number {
  return new Date(parts.year, parts.month - 1, parts.day).getDay()
}

/** The words a search can match this moment by, in English and German. */
export function whenWords(start: string): string {
  const parts = splitStamp(start)
  const day = weekdayOf(parts)
  return `${LONG_DAY[day]} ${LONG_DAY_DE[day]}`
}

export function formatWhen(start: string, end?: string): string {
  const opening = splitStamp(start)
  const closing = end ? splitStamp(end) : undefined
  const head = `${SHORT_DAY[weekdayOf(opening)]} ${opening.day} ${MONTH[opening.month - 1]} ${opening.year}`
  if (!opening.time && !closing) return `${head} (all day)`
  if (opening.time && !closing) return `${head}, ${opening.time}`
  if (!closing) return head

  const sameDay =
    closing.year === opening.year && closing.month === opening.month && closing.day === opening.day
  if (opening.time && closing.time && sameDay) return `${head}, ${opening.time}–${closing.time}`

  const tail = `${SHORT_DAY[weekdayOf(closing)]} ${closing.day} ${MONTH[closing.month - 1]} ${closing.year}`
  if (!opening.time && !closing.time) return `${head} – ${tail} (all day)`
  const open = opening.time ? `${head}, ${opening.time}` : head
  const close = closing.time ? `${tail}, ${closing.time}` : tail
  return `${open} – ${close}`
}

function endOnOrAfter(start: string, endClock: Clock): string {
  const parts = splitStamp(start)
  const date = new Date(parts.year, parts.month - 1, parts.day)
  let end = stamp(date, endClock)
  if (end <= start) {
    date.setDate(date.getDate() + 1)
    end = stamp(date, endClock)
  }
  if (end === start) throw new Error('the end has to be after the start')
  return end
}

/** Adds minutes to a timed stamp. An all-day stamp has no clock to move. */
export function addMinutes(value: string, minutes: number): string {
  const parts = splitStamp(value)
  if (!parts.time) throw new Error('an all-day event has no clock to move')
  const [hours, mins] = parts.time.split(':').map(Number)
  const date = new Date(parts.year, parts.month - 1, parts.day, hours, mins)
  date.setMinutes(date.getMinutes() + minutes)
  return stamp(date, { hours: date.getHours(), minutes: date.getMinutes() })
}

export function minutesBetween(start: string, end: string): number | null {
  const opening = splitStamp(start)
  const closing = splitStamp(end)
  if (!opening.time || !closing.time) return null
  const [fromH, fromM] = opening.time.split(':').map(Number)
  const [toH, toM] = closing.time.split(':').map(Number)
  const from = new Date(opening.year, opening.month - 1, opening.day, fromH, fromM).getTime()
  const to = new Date(closing.year, closing.month - 1, closing.day, toH, toM).getTime()
  return Math.round((to - from) / 60_000)
}

interface Taken {
  start?: Clock
  end?: Clock
  rest: string
}

const RANGE =
  /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|bis)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*uhr)?\b/

const SINGLE = /\b(\d{1,2}):(\d{2})\s*(am|pm|uhr)?\b|\b(\d{1,2})\s*(am|pm|uhr)\b/

function takeClocks(folded: string): Taken {
  const range = RANGE.exec(folded)
  if (range) {
    const suffix = range[3] || range[6] || undefined
    return {
      start: clock(Number(range[1]), Number(range[2] ?? 0), range[3] || suffix),
      end: clock(Number(range[4]), Number(range[5] ?? 0), range[6] || suffix),
      rest: `${folded.slice(0, range.index)} ${folded.slice(range.index + range[0].length)}`
        .replace(/\s+/g, ' ')
        .trim(),
    }
  }

  const single = SINGLE.exec(folded)
  if (!single) return { rest: folded }
  const hours = Number(single[1] ?? single[4])
  const minutes = Number(single[2] ?? 0)
  const suffix = single[3] || single[5] || undefined
  return {
    start: clock(hours, minutes, suffix === 'uhr' ? undefined : suffix),
    rest: `${folded.slice(0, single.index)} ${folded.slice(single.index + single[0].length)}`
      .replace(/\s+/g, ' ')
      .trim(),
  }
}

function relative(folded: string, now: Date): WhenSpan | null {
  const match =
    /^in\s+(?:(\d+)|(einer|eine|ein|an|one|a))(?:\s+(halben))?\s+(hours?|stunden?|minutes?|minuten|min)$/.exec(
      folded,
    )
  if (!match) return null
  const amount = match[3] ? 0.5 : match[1] ? Number(match[1]) : 1
  const unit = match[4] ?? ''
  const ms = unit.startsWith('min') ? amount * 60_000 : amount * 3_600_000
  const at = new Date(now.getTime() + ms)
  return { start: stamp(at, { hours: at.getHours(), minutes: at.getMinutes() }) }
}

function timeOnlyDate(now: Date, time: Clock): Date {
  const date = new Date(now)
  date.setHours(time.hours, time.minutes, 0, 0)
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1)
  return date
}

function weekdayDate(now: Date, weekday: number, strict: boolean, time?: Clock): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let delta = (weekday - date.getDay() + 7) % 7
  if (delta === 0 && strict) delta = 7
  if (delta === 0 && time) {
    const candidate = new Date(date)
    candidate.setHours(time.hours, time.minutes, 0, 0)
    if (candidate.getTime() <= now.getTime()) delta = 7
  }
  date.setDate(date.getDate() + delta)
  return date
}

interface DayRead {
  date?: Date
  endDate?: Date
}

function readDay(words: string[], now: Date, time?: Clock): DayRead | null {
  let cursor = 0
  let strict = false
  let chosen: DayRead | undefined = undefined

  const takeWeekday = (index: number): number | null => {
    const name = words[index]
    return name ? (WEEKDAYS[name] ?? null) : null
  }

  while (cursor < words.length) {
    const word = words[cursor] ?? ''
    if (FILLER.has(word) || PARTS[word]) {
      cursor += 1
      continue
    }
    if (NEXT.has(word)) {
      strict = true
      cursor += 1
      continue
    }
    if (word === 'day' && words[cursor + 1] === 'after' && words[cursor + 2] === 'tomorrow') {
      if (chosen) throw new Error('name one day, not several')
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)
      chosen = { date }
      cursor += 3
      continue
    }
    if (word === 'today' || word === 'heute') {
      if (chosen) throw new Error('name one day, not several')
      chosen = { date: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
      cursor += 1
      continue
    }
    if (word === 'uebermorgen') {
      if (chosen) throw new Error('name one day, not several')
      chosen = { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2) }
      cursor += 1
      continue
    }
    if (word === 'tomorrow' || word === 'morgen') {
      // "heute morgen" is this morning, not a second day.
      if (chosen) {
        cursor += 1
        continue
      }
      chosen = { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) }
      cursor += 1
      continue
    }

    const weekday = takeWeekday(cursor)
    if (weekday !== null) {
      const joiner = words[cursor + 1]
      const other = joiner === 'to' || joiner === 'bis' ? takeWeekday(cursor + 2) : null
      if (other !== null) {
        if (chosen) throw new Error('name one day, not several')
        const date = weekdayDate(now, weekday, strict, time)
        const endDate = weekdayDate(date, other, false)
        chosen = endDate.getTime() === date.getTime() ? { date } : { date, endDate }
        cursor += 3
        strict = false
        continue
      }
      if (chosen) throw new Error('name one day, not several')
      chosen = { date: weekdayDate(now, weekday, strict, time) }
      strict = false
      cursor += 1
      continue
    }

    return null
  }

  if (strict) return null
  return chosen ?? {}
}

function partOfDay(words: string[]): Clock | undefined {
  for (const word of words) {
    const part = PARTS[word]
    if (part) return part
  }
  return undefined
}

/** "heute morgen" names this morning once the day has already been read as today. */
function impliedMorning(words: string[], day: Date | undefined, now: Date): Clock | undefined {
  if (!day || !words.includes('morgen')) return undefined
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return day.getTime() === today.getTime() ? PARTS.morning : undefined
}

function fromDate(year: number, month: number, day: number, rest: string, original: string): WhenSpan {
  if (!validDate(year, month, day)) throw new Error(`${day}.${month}.${year} is not a date`)
  const taken = takeClocks(fold(rest))
  const words = taken.rest.split(' ').filter(Boolean)
  if (words.some((word) => !FILLER.has(word) && !PARTS[word])) throw unreadable(original)
  const time = taken.start ?? partOfDay(words)
  const date = new Date(year, month - 1, day)
  const start = stamp(date, time)
  return taken.end ? { start, end: endOnOrAfter(start, taken.end) } : { start }
}

/**
 * A bare clock, for moving an event that already has a day.
 *
 * `16:00` keeps Friday and changes the hour. `Friday 16:00` is a different
 * instruction and comes back as null so the caller resolves it afresh.
 */
export function clockAdjustment(input: string): { start: Clock; end?: Clock } | null {
  const folded = fold(input)
  if (!folded || relative(folded, new Date())) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(folded) || /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(input.trim())) return null
  const taken = takeClocks(folded)
  if (!taken.start) return null
  const words = taken.rest.split(' ').filter(Boolean)
  if (words.some((word) => !FILLER.has(word))) return null
  return { start: taken.start, ...(taken.end ? { end: taken.end } : {}) }
}

/** Puts a clock on a day an event already has. */
export function placeClock(day: string, clocks: { start: Clock; end?: Clock }): WhenSpan {
  const parts = splitStamp(day.slice(0, 10))
  const date = new Date(parts.year, parts.month - 1, parts.day)
  const start = stamp(date, clocks.start)
  return clocks.end ? { start, end: endOnOrAfter(start, clocks.end) } : { start }
}

export function resolveWhen(input: string, now = new Date()): WhenSpan {
  const raw = input
    .trim()
    .replace(/[?.!]+$/g, '')
    .trim()
  if (!raw) throw new Error('when must not be empty')

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[t\s](\d{1,2}):(\d{2}))?(?:\s*(?:-|–|to|bis)\s*(\d{1,2}):(\d{2}))?$/i.exec(
      raw,
    )
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    if (!validDate(year, month, day)) throw new Error(`${raw} is not a date`)
    const date = new Date(year, month - 1, day)
    const time = iso[4] ? clock(Number(iso[4]), Number(iso[5])) : undefined
    const start = stamp(date, time)
    return iso[6] && time
      ? { start, end: endOnOrAfter(start, clock(Number(iso[6]), Number(iso[7]))) }
      : { start }
  }

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(.+))?$/.exec(raw)
  if (dotted) {
    return fromDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]), dotted[4] ?? '', raw)
  }

  const folded = fold(raw)
  const relativeSpan = relative(folded, now)
  if (relativeSpan) return relativeSpan

  const taken = takeClocks(folded)
  const words = taken.rest.split(' ').filter(Boolean)
  let day: DayRead | null
  try {
    day = readDay(words, now, taken.start)
  } catch (error) {
    if (error instanceof Error && error.message === 'name one day, not several') throw unreadable(raw)
    throw error
  }
  if (day === null) throw unreadable(raw)

  const time = taken.start ?? partOfDay(words) ?? impliedMorning(words, day.date, now)
  if (!day.date) {
    if (!time) throw unreadable(raw)
    const start = stamp(timeOnlyDate(now, time), time)
    return taken.end ? { start, end: endOnOrAfter(start, taken.end) } : { start }
  }

  const start = stamp(day.date, time)
  if (taken.end) return { start, end: endOnOrAfter(start, taken.end) }
  if (day.endDate && !time) return { start, end: stamp(day.endDate) }
  return { start }
}
