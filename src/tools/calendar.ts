import {
  addEvent,
  describeEvent,
  eventMatches,
  removeEvent,
  upcomingEvents,
  updateEvent,
} from '@/calendar/manage'
import { readEvents } from '@/calendar/db'
import type { CalendarEvent } from '@/calendar/types'
import {
  addMinutes,
  clockAdjustment,
  minutesBetween,
  placeClock,
  resolveWhen,
  type WhenSpan,
} from '@/calendar/when'
import { defineTool, type Tool } from './types'

/**
 * One tool with a command, the same shape as `memory`.
 *
 * `add`, `list`, `update` and `delete` as four tools would lengthen every
 * prompt that has nothing to do with a calendar, and tool-calling accuracy
 * falls as that list grows.
 */

const MAX_LIST_ENTRIES = 20
const MAX_LIST_CHARS = 1200

const ALIASES: Record<string, string> = {
  book: 'add',
  create: 'add',
  new: 'add',
  put: 'add',
  schedule: 'add',
  agenda: 'list',
  get: 'list',
  read: 'list',
  show: 'list',
  change: 'update',
  edit: 'update',
  move: 'update',
  reschedule: 'update',
  cancel: 'delete',
  drop: 'delete',
  remove: 'delete',
}

const COMMANDS = ['add', 'list', 'update', 'delete'] as const

function renderList(events: CalendarEvent[]): string {
  const lines: string[] = []
  let used = 0
  for (const event of events.slice(0, MAX_LIST_ENTRIES)) {
    const line = describeEvent(event)
    if (used + line.length > MAX_LIST_CHARS) break
    lines.push(line)
    used += line.length
  }
  const hidden = events.length - lines.length
  return [
    `${events.length} ${events.length === 1 ? 'event' : 'events'}:`,
    ...lines,
    ...(hidden > 0 ? [`…and ${hidden} more.`] : []),
  ].join('\n')
}

function resolve(events: CalendarEvent[], id: string, query: string, command: string): CalendarEvent {
  if (id) {
    const found = events.find((event) => event.id === id)
    if (!found) throw new Error(`no event has id ${id} — call calendar with command=list to see the ids`)
    return found
  }
  if (!query) throw new Error(`${command} needs an id, or a query naming the event`)
  const matches = events.filter((event) => eventMatches(event, query))
  if (matches.length === 0) throw new Error(`no event matches "${query}"`)
  if (matches.length > 1) {
    throw new Error(
      `"${query}" matches ${matches.length} events — repeat with the id of the one you mean:\n${matches
        .map(describeEvent)
        .join('\n')}`,
    )
  }
  return matches[0] as CalendarEvent
}

function spanOf(when: string, existing?: CalendarEvent): WhenSpan {
  const clocks = existing ? clockAdjustment(when) : null
  if (clocks && existing) {
    const placed = placeClock(existing.start, clocks)
    if (placed.end || !existing.end) return placed
    const minutes = minutesBetween(existing.start, existing.end)
    if (!minutes || minutes <= 0) return placed
    return { start: placed.start, end: addMinutes(placed.start, minutes) }
  }
  return resolveWhen(when)
}

function onSpan(event: CalendarEvent, span: WhenSpan): boolean {
  const day = event.start.slice(0, 10)
  const from = span.start.slice(0, 10)
  const to = (span.end ?? span.start).slice(0, 10)
  return day >= from && day <= to
}

export const calendar: Tool = defineTool(
  'calendar',
  'Add, list, move or cancel events on the calendar kept in this browser. Use when the user asks what is scheduled, or to book, change or drop an appointment.',
  {
    type: 'object',
    properties: {
      command: { type: 'string', description: `One of: ${COMMANDS.join(', ')}` },
      title: { type: 'string', description: 'For add and update: what the event is called' },
      when: {
        type: 'string',
        description:
          "When it starts, in the user's words. For example: Friday 15:00, morgen 15 Uhr, 2026-09-25 15:00",
      },
      end: { type: 'string', description: 'When it ends, if they named an end. A clock keeps the start day' },
      location: { type: 'string', description: 'Where it is, if they said' },
      notes: { type: 'string', description: 'Anything else they asked to keep on the event' },
      query: { type: 'string', description: 'Words from the title, to find an event without an id' },
      id: { type: 'string', description: 'The id shown in brackets by list' },
    },
    required: ['command'],
  },
  async (args) => {
    const title = String(args.title ?? '').trim()
    const when = String(args.when ?? '').trim()
    const end = String(args.end ?? '').trim()
    const location = String(args.location ?? '').trim()
    const notes = String(args.notes ?? '').trim()
    const query = String(args.query ?? '').trim()
    const id = String(args.id ?? '').trim()
    const raw = String(args.command ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    const command = ALIASES[raw] ?? raw

    if (!command && title && when) return await create(title, when, end, location, notes)
    if (!(COMMANDS as readonly string[]).includes(command)) {
      throw new Error(`unknown command "${raw}". Use one of: ${COMMANDS.join(', ')}`)
    }

    if (command === 'add') return await create(title, when, end, location, notes)

    const records = await readEvents()

    if (command === 'list') {
      let matching = query ? records.filter((event) => eventMatches(event, query)) : upcomingEvents(records)
      if (when) {
        const span = resolveWhen(when)
        matching = matching.filter((event) => onSpan(event, span))
      }
      if (matching.length === 0) {
        return query ? `Nothing on the calendar matches "${query}".` : 'Nothing on the calendar yet.'
      }
      return renderList(matching)
    }

    const target = resolve(records, id, query || title, command)

    if (command === 'delete') return `Deleted ${describeEvent(await removeEvent(target.id))}`

    if (!when && !end && !title && !location && !notes) {
      throw new Error('update needs a new title, when, end, location or notes')
    }
    const span = when
      ? spanOf(when, target)
      : { start: target.start, ...(target.end ? { end: target.end } : {}) }
    let nextEnd = span.end
    if (end) {
      const clocks = clockAdjustment(end)
      nextEnd = clocks ? placeClock(span.start, { start: clocks.start }).start : resolveWhen(end).start
      if (nextEnd <= span.start) nextEnd = addMinutes(nextEnd, 24 * 60)
    }
    const updated = await updateEvent(target.id, {
      ...(title ? { title } : {}),
      ...(when ? { start: span.start } : {}),
      ...(when || end ? { end: nextEnd ?? '' } : {}),
      ...(location ? { location } : {}),
      ...(notes ? { notes } : {}),
    })
    return `Updated ${describeEvent(updated)}`
  },
)

async function create(
  title: string,
  when: string,
  end: string,
  location: string,
  notes: string,
): Promise<string> {
  if (!when) throw new Error('add needs when, in the user\'s words, for example "Friday 15:00"')
  const span = resolveWhen(when)
  let closing = span.end
  if (end) {
    const clocks = clockAdjustment(end)
    closing = clocks ? placeClock(span.start, { start: clocks.start }).start : resolveWhen(end).start
    if (closing <= span.start) closing = addMinutes(closing, 24 * 60)
  }
  const outcome = await addEvent({
    title,
    start: span.start,
    ...(closing ? { end: closing } : {}),
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
    source: 'model',
  })
  return outcome.duplicate
    ? `Already on the calendar ${describeEvent(outcome.event)}`
    : `Added ${describeEvent(outcome.event)}`
}
