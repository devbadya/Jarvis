import { deleteEvents, readEvents, writeEvents } from './db'
import {
  MAX_EVENTS,
  MAX_LOCATION_CHARS,
  MAX_NOTES_CHARS,
  MAX_TITLE_CHARS,
  PRUNE_AFTER_DAYS,
  type CalendarEvent,
} from './types'
import { formatWhen, whenWords } from './when'

export interface EventInput {
  title: string
  start: string
  end?: string
  location?: string
  notes?: string
  source: CalendarEvent['source']
}

function generateId(taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = Math.random().toString(36).slice(2, 8)
    if (id.length === 6 && !taken.has(id)) return id
  }
  return `${Date.now().toString(36)}`
}

function clamp(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function todayStamp(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function cutoffStamp(now: Date): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - PRUNE_AFTER_DAYS)
  return todayStamp(date)
}

/** What a list row and a search both look at. */
export function describeEvent(event: CalendarEvent): string {
  const where = event.location ? ` at ${event.location}` : ''
  const note = event.notes ? ` (${event.notes})` : ''
  return `[${event.id}] ${formatWhen(event.start, event.end)} — ${event.title}${where}${note}`
}

export function eventMatches(event: CalendarEvent, query: string): boolean {
  const hay =
    `${event.title} ${event.location ?? ''} ${event.notes ?? ''} ${formatWhen(event.start, event.end)} ${whenWords(event.start)}`.toLowerCase()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return words.every((word) => hay.includes(word))
}

export function upcomingEvents(events: CalendarEvent[], now = new Date()): CalendarEvent[] {
  const today = todayStamp(now)
  return events.filter((event) => event.start.slice(0, 10) >= today)
}

function assertOrder(start: string, end?: string): void {
  if (end && end <= start) throw new Error('the end has to be after the start')
}

export async function addEvent(
  input: EventInput,
  now = new Date(),
): Promise<{ event: CalendarEvent; duplicate: boolean }> {
  const title = clamp(input.title, MAX_TITLE_CHARS)
  if (!title) throw new Error('add needs a title')
  assertOrder(input.start, input.end)

  const records = await readEvents()
  const duplicate = records.find(
    (event) => event.title.toLowerCase() === title.toLowerCase() && event.start === input.start,
  )
  if (duplicate) return { event: duplicate, duplicate: true }

  const cutoff = cutoffStamp(now)
  const kept = records.filter((event) => event.start.slice(0, 10) >= cutoff)
  const dropped = records.filter((event) => event.start.slice(0, 10) < cutoff).map((event) => event.id)
  if (kept.length >= MAX_EVENTS) {
    throw new Error(`The calendar already has ${MAX_EVENTS} events. Delete one before adding another.`)
  }

  const stamp = now.getTime()
  const event: CalendarEvent = {
    id: generateId(new Set(records.map((entry) => entry.id))),
    title,
    start: input.start,
    ...(input.end ? { end: input.end } : {}),
    ...(input.location ? { location: clamp(input.location, MAX_LOCATION_CHARS) } : {}),
    ...(input.notes ? { notes: clamp(input.notes, MAX_NOTES_CHARS) } : {}),
    source: input.source,
    createdAt: stamp,
    updatedAt: stamp,
  }

  await writeEvents([event])
  if (dropped.length > 0) await deleteEvents(dropped)
  return { event, duplicate: false }
}

export async function updateEvent(
  id: string,
  patch: Partial<Omit<EventInput, 'source'>>,
  now = new Date(),
): Promise<CalendarEvent> {
  const records = await readEvents()
  const existing = records.find((event) => event.id === id)
  if (!existing) throw new Error(`no event has id ${id}`)

  const start = patch.start ?? existing.start
  const end = patch.end === undefined ? existing.end : patch.end || undefined
  assertOrder(start, end)

  const next: CalendarEvent = {
    ...existing,
    title: patch.title ? clamp(patch.title, MAX_TITLE_CHARS) : existing.title,
    start,
    updatedAt: now.getTime(),
  }
  if (end) next.end = end
  else delete next.end
  if (patch.location) next.location = clamp(patch.location, MAX_LOCATION_CHARS)
  if (patch.notes) next.notes = clamp(patch.notes, MAX_NOTES_CHARS)

  await writeEvents([next])
  return next
}

export async function removeEvent(id: string): Promise<CalendarEvent> {
  const records = await readEvents()
  const existing = records.find((event) => event.id === id)
  if (!existing) throw new Error(`no event has id ${id}`)
  await deleteEvents([id])
  return existing
}
