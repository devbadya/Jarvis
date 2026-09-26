import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { CalendarPanel } from './CalendarPanel'
import { deleteEvents, readEvents } from '@/calendar/db'
import { addEvent } from '@/calendar/manage'
import { formatWhen } from '@/calendar/when'

beforeEach(async () => {
  const events = await readEvents()
  await deleteEvents(events.map((event) => event.id))
})

/** A start that is still upcoming on whatever day the suite runs. */
function tomorrowAtThree(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}T15:00`
}

beforeEach(async () => {
  const events = await readEvents()
  await deleteEvents(events.map((event) => event.id))
})

async function openPanel(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<CalendarPanel />)
  await user.click(screen.getByRole('button', { name: 'Calendar' }))
  return user
}

describe('CalendarPanel', () => {
  it('says when nothing is coming up', async () => {
    await openPanel()
    expect(screen.getByText(/Nothing coming up/)).toBeInTheDocument()
  })

  it('lists an event Jarvis saved, and who put it there', async () => {
    const start = tomorrowAtThree()
    await addEvent({ title: 'Dentist', start, source: 'model' })
    await openPanel()

    expect(await screen.findByText('Dentist')).toBeInTheDocument()
    expect(screen.getByText(/added by Jarvis/)).toBeInTheDocument()
    expect(screen.getByText(formatWhen(start))).toBeInTheDocument()
  })

  it('adds one the user types and removes it again', async () => {
    const user = await openPanel()
    await user.type(screen.getByLabelText('Title'), 'Standup')
    await user.type(screen.getByLabelText('When'), 'tomorrow 9:00')
    await user.click(screen.getByRole('button', { name: 'Add event' }))

    expect(await screen.findByText('Standup')).toBeInTheDocument()
    expect(screen.getByText(/added by you/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete event: Standup' }))
    expect(await screen.findByText(/Nothing coming up/)).toBeInTheDocument()
    expect(await readEvents()).toEqual([])
  })

  it('says when the time cannot be read', async () => {
    const user = await openPanel()
    await user.type(screen.getByLabelText('Title'), 'Standup')
    await user.type(screen.getByLabelText('When'), 'banana')
    await user.click(screen.getByRole('button', { name: 'Add event' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not read/)
    expect(await readEvents()).toEqual([])
  })
})
