import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { CalendarPanel } from './CalendarPanel'
import { deleteEvents, readEvents } from '@/calendar/db'
import { addEvent } from '@/calendar/manage'

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
    await addEvent({ title: 'Dentist', start: '2026-09-25T15:00', source: 'model' })
    await openPanel()

    expect(await screen.findByText('Dentist')).toBeInTheDocument()
    expect(screen.getByText(/added by Jarvis/)).toBeInTheDocument()
    expect(screen.getByText(/Fri 25 Sep 2026, 15:00/)).toBeInTheDocument()
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
