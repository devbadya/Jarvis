import { beforeEach, describe, expect, it } from 'vitest'
import { deleteEvents, readEvents } from '@/calendar/db'
import { minutesBetween } from '@/calendar/when'
import { calendar } from './calendar'

beforeEach(async () => {
  const events = await readEvents()
  await deleteEvents(events.map((event) => event.id))
})

describe('the calendar tool', () => {
  it('adds an event from the words the user used', async () => {
    const result = await calendar.execute({
      command: 'add',
      title: 'Dentist',
      when: 'Friday 15:00',
      location: 'Klinik',
    })

    expect(result).toMatch(/^Added \[\w{6}\] Fri \d+ \w+ \d{4}, 15:00 — Dentist at Klinik$/)
    expect(await readEvents()).toHaveLength(1)
  })

  it('accepts the verb the user used', async () => {
    await calendar.execute({ command: 'schedule', title: 'Standup', when: 'tomorrow 9:00' })
    expect(await calendar.execute({ command: 'agenda' })).toContain('Standup')
  })

  it('says when the calendar is empty', async () => {
    expect(await calendar.execute({ command: 'list' })).toBe('Nothing on the calendar yet.')
  })

  it('moves the clock and keeps the length of the appointment', async () => {
    await calendar.execute({ command: 'add', title: 'Dentist', when: '2026-09-25T15:00', end: '16:00' })

    await calendar.execute({ command: 'move', query: 'dentist', when: '17:00' })

    const saved = (await readEvents())[0]
    expect(saved?.start).toBe('2026-09-25T17:00')
    expect(minutesBetween(saved?.start ?? '', saved?.end ?? '')).toBe(60)
  })

  it('does not book the same appointment twice', async () => {
    await calendar.execute({ command: 'add', title: 'Dentist', when: '2026-09-25T15:00' })
    const again = await calendar.execute({ command: 'add', title: 'Dentist', when: '2026-09-25T15:00' })

    expect(again).toMatch(/^Already on the calendar/)
    expect(await readEvents()).toHaveLength(1)
  })

  it('refuses to guess when two events match', async () => {
    await calendar.execute({ command: 'add', title: 'Dentist uptown', when: '2026-09-25T15:00' })
    await calendar.execute({ command: 'add', title: 'Dentist downtown', when: '2026-09-26T15:00' })

    await expect(calendar.execute({ command: 'delete', query: 'dentist' })).rejects.toThrow(
      /matches 2 events/,
    )
    expect(await readEvents()).toHaveLength(2)
  })

  it('cancels the one event a query names', async () => {
    await calendar.execute({ command: 'add', title: 'Dentist', when: '2026-09-25T15:00' })

    expect(await calendar.execute({ command: 'cancel', query: 'dentist' })).toMatch(/^Deleted/)
    expect(await readEvents()).toEqual([])
  })

  it('reads a German day', async () => {
    const result = await calendar.execute({ command: 'add', title: 'Zahnarzt', when: 'Freitag um 15 Uhr' })
    expect(result).toContain('Zahnarzt')
    expect(result).toContain('15:00')
  })
})
