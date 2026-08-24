import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryPanel } from './MemoryPanel'
import { deleteRecords, readAllRecords } from '@/memory/db'
import { saveMemory } from '@/memory/manage'
import { useChatStore } from '@/store/chat'

beforeEach(async () => {
  const records = await readAllRecords()
  await deleteRecords(records.map((record) => record.id))
  localStorage.clear()
  useChatStore.getState().setMemoryEnabled(true)
  await useChatStore.getState().refreshMemories()
})

/** The panel is a drawer, so everything in it is behind the header trigger. */
async function openPanel(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<MemoryPanel />)
  await user.click(screen.getByRole('button', { name: 'Memory' }))
  return user
}

describe('MemoryPanel', () => {
  it('says when there is nothing stored', async () => {
    await openPanel()
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument()
  })

  it('lists what is in the database, and who put it there', async () => {
    await saveMemory({ text: 'Lives in Lisbon', kind: 'fact', source: 'model' })
    await openPanel()

    expect(await screen.findByText('Lives in Lisbon')).toBeInTheDocument()
    expect(screen.getByText(/saved by Jarvis/)).toBeInTheDocument()
  })

  it('adds one the user types', async () => {
    const user = await openPanel()

    await user.type(screen.getByLabelText('New memory'), 'Prefers metric units')
    await user.click(screen.getByRole('button', { name: 'Add memory' }))

    expect(await screen.findByText('Prefers metric units')).toBeInTheDocument()
    await waitFor(() => expect(useChatStore.getState().memories).toHaveLength(1))
  })

  it('corrects one in place', async () => {
    await saveMemory({ text: 'Lives in Berlin', source: 'model' })
    const user = await openPanel()

    await user.click(await screen.findByRole('button', { name: 'Edit memory: Lives in Berlin' }))
    await user.clear(screen.getByLabelText('Memory: Lives in Berlin'))
    await user.type(screen.getByLabelText('Memory: Lives in Berlin'), 'Lives in Lisbon')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Lives in Lisbon')).toBeInTheDocument()
    expect(screen.queryByText('Lives in Berlin')).not.toBeInTheDocument()
  })

  it('offers a deleted memory back rather than losing it', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'model' })
    const user = await openPanel()

    await user.click(await screen.findByRole('button', { name: 'Delete memory: Lives in Lisbon' }))

    expect(await screen.findByText(/Recently deleted \(1\)/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore memory: Lives in Lisbon' }))

    await waitFor(() => expect(useChatStore.getState().memories).toHaveLength(1))
    expect(screen.queryByText(/Recently deleted/)).not.toBeInTheDocument()
  })

  it('takes the memory tool away when memory is switched off', async () => {
    const user = await openPanel()
    const named = (): string[] => useChatStore.getState().tools.map((tool) => tool.schema.function.name)

    expect(named()).toContain('memory')

    await user.click(screen.getByRole('switch', { name: 'Remember across chats' }))

    expect(named()).not.toContain('memory')
    expect(useChatStore.getState().memoryEnabled).toBe(false)
  })

  it('keeps what is stored when memory is switched off', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'model' })
    const user = await openPanel()

    await user.click(screen.getByRole('switch', { name: 'Remember across chats' }))

    expect(await screen.findByText('Lives in Lisbon')).toBeInTheDocument()
  })
})
