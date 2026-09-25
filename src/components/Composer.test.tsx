import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'
import { useLocale } from '@/i18n'
import { useChatStore } from '@/store/chat'

afterEach(() => useChatStore.setState({ busy: false, queued: [], messages: [], online: true }))

describe('Composer', () => {
  it('renders the input and disables sending while empty', () => {
    render(<Composer />)
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByText('Jarvis can make mistakes. Check important details.')).toBeInTheDocument()
  })

  it('enables sending once text is typed', async () => {
    const user = userEvent.setup()
    render(<Composer />)
    await user.type(screen.getByLabelText('Message'), 'Hello')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('trades sending for stopping while a reply is running', () => {
    useChatStore.setState({ busy: true })
    render(<Composer />)

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    // Typing is still allowed, so it has to say what will happen to what is typed.
    expect(screen.getByLabelText('Message')).toBeEnabled()
    expect(screen.getByText('Jarvis is replying')).toBeInTheDocument()
  })

  it('queues what is typed during a reply instead of dropping it', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', busy: true })
    render(<Composer />)

    await user.type(screen.getByLabelText('Message'), 'And in Lisbon?{Enter}')

    expect(useChatStore.getState().queued).toEqual(['And in Lisbon?'])
    // Shown, so the follow-up is not a promise the interface made in private.
    const waiting = screen.getByRole('list', { name: 'Waiting to be sent' })
    expect(waiting).toHaveTextContent('And in Lisbon?')
    // And the box is empty, ready for the next one.
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('offers the queue to a pointer as well as to Enter', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', busy: true })
    render(<Composer />)

    expect(screen.queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Later, then')
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    expect(useChatStore.getState().queued).toEqual(['Later, then'])
  })

  it('says why it will not send without a connection, and keeps the question', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', online: false })
    render(<Composer />)

    await user.type(screen.getByLabelText('Message'), 'What happened today?{Enter}')

    expect(screen.getByRole('status')).toHaveTextContent('No connection')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    // Clearing the box here would be the interface swallowing the question on
    // behalf of a refusal it has just announced.
    expect(screen.getByLabelText('Message')).toHaveValue('What happened today?')
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('shows why a dictation ended without words', async () => {
    class SilentRecognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult = null
      onend: (() => void) | null = null
      onerror: ((event: { error?: string }) => void) | null = null
      start() {
        this.onerror?.({ error: 'audio-capture' })
        this.onend?.()
      }
      stop() {}
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', SilentRecognition)
    const user = userEvent.setup()
    render(<Composer />)

    await user.click(screen.getByRole('button', { name: 'Dictate' }))

    expect(screen.getByRole('status')).toHaveTextContent('No microphone was found.')
    vi.unstubAllGlobals()
  })

  it('starts a conversation from the waveform and hides dictation while it listens', async () => {
    class Recognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult = null
      onend = null
      onerror = null
      start() {}
      stop() {}
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', Recognition)
    vi.stubGlobal('speechSynthesis', { cancel() {}, speak() {}, getVoices: () => [] })
    vi.stubGlobal('SpeechSynthesisUtterance', class Utterance {})
    const user = userEvent.setup()
    render(<Composer />)

    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Talk' }))

    expect(screen.getByRole('button', { name: 'End conversation' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Listening…')
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('speaks German once German is chosen', () => {
    useLocale.setState({ locale: 'de' })
    render(<Composer />)

    expect(screen.getByLabelText('Nachricht')).toHaveAttribute('placeholder', 'Frag etwas…')
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled()
    expect(screen.getByText('Jarvis kann Fehler machen. Prüfe wichtige Angaben.')).toBeInTheDocument()
    useLocale.setState({ locale: 'en' })
  })

  it('takes a queued message back out again', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', busy: true, queued: ['first', 'second'] })
    render(<Composer />)

    await user.click(screen.getByRole('button', { name: 'Remove “first” from the queue' }))

    expect(useChatStore.getState().queued).toEqual(['second'])
  })
})
