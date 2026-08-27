import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveClock } from './LiveClock'

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveClock', () => {
  it('ticks the local minute when a minute has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T20:40:19.483Z'))

    render(<LiveClock timeZone="Europe/Berlin" />)

    expect(screen.getByLabelText('Live time in Europe/Berlin')).toHaveTextContent('22:40:19 CEST')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(screen.getByLabelText('Live time in Europe/Berlin')).toHaveTextContent('22:41:19 CEST')
  })

  it('can render the full reading the tool would return now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T20:40:19.483Z'))

    render(<LiveClock full place="Germany" timeZone="Europe/Berlin" />)

    expect(screen.getByLabelText('Live time in Europe/Berlin')).toHaveTextContent(
      'Germany — 22:40:19 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026',
    )
  })
})
