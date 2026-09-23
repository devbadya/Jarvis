import { describe, expect, it } from 'vitest'
import { clockAdjustment, formatWhen, resolveWhen } from './when'

/** Wednesday 23 September 2026, 12:00 local. */
const now = new Date(2026, 8, 23, 12, 0, 0)

describe('resolveWhen', () => {
  it.each([
    ['2026-09-25T15:00', { start: '2026-09-25T15:00' }],
    ['2026-09-25 15:00-16:30', { start: '2026-09-25T15:00', end: '2026-09-25T16:30' }],
    ['2026-09-25', { start: '2026-09-25' }],
    ['25.09.2026 15:00', { start: '2026-09-25T15:00' }],
    ['Friday 15:00', { start: '2026-09-25T15:00' }],
    ['Freitag um 15 Uhr', { start: '2026-09-25T15:00' }],
    ['tomorrow at 3pm', { start: '2026-09-24T15:00' }],
    ['morgen 15:00-16:00', { start: '2026-09-24T15:00', end: '2026-09-24T16:00' }],
    ['heute', { start: '2026-09-23' }],
    ['übermorgen 9:00', { start: '2026-09-25T09:00' }],
    ['15:00', { start: '2026-09-23T15:00' }],
    ['09:00', { start: '2026-09-24T09:00' }],
    ['in 2 hours', { start: '2026-09-23T14:00' }],
    ['in einer Stunde', { start: '2026-09-23T13:00' }],
    ['in einer halben Stunde', { start: '2026-09-23T12:30' }],
    ['Friday morning', { start: '2026-09-25T09:00' }],
    ['heute morgen', { start: '2026-09-23T09:00' }],
    ['Friday to Sunday', { start: '2026-09-25', end: '2026-09-27' }],
  ])('reads %j', (input, expected) => {
    expect(resolveWhen(input, now)).toEqual(expected)
  })

  it('refuses a phrase with no day and no clock', () => {
    expect(() => resolveWhen('banana', now)).toThrow(/Could not read/)
  })

  it('refuses a date that does not exist', () => {
    expect(() => resolveWhen('31.02.2026', now)).toThrow(/not a date/)
  })
})

describe('clockAdjustment', () => {
  it('keeps a bare clock for a move, and leaves a named day alone', () => {
    expect(clockAdjustment('16:00')).toEqual({ start: { hours: 16, minutes: 0 } })
    expect(clockAdjustment('um 16 Uhr')).toEqual({ start: { hours: 16, minutes: 0 } })
    expect(clockAdjustment('Friday 16:00')).toBeNull()
  })
})

describe('formatWhen', () => {
  it('prints a stable line the model can quote', () => {
    expect(formatWhen('2026-09-25T15:00', '2026-09-25T16:00')).toBe('Fri 25 Sep 2026, 15:00–16:00')
    expect(formatWhen('2026-09-25')).toBe('Fri 25 Sep 2026 (all day)')
  })
})
