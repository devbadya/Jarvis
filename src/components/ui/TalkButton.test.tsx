import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TalkButton } from './TalkButton'
import { useLocale } from '@/i18n'
import {
  TURN_PAUSE_MS,
  resetSpokenClaims,
  type RecognitionLike,
  type RecognitionResultEvent,
} from '@/lib/speech'
import { useChatStore } from '@/store/chat'
import type { Message } from '@/types'

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = []
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((event: RecognitionResultEvent) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() {
    FakeRecognition.instances.push(this)
  }
}

class Utterance {
  text: string
  lang = ''
  voice: { name?: string } | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const german = { lang: 'de-DE', name: 'German Natural', localService: false }
const english = { lang: 'en-US', name: 'Samantha', localService: true, default: true }
const synthesis = {
  cancel: vi.fn(),
  speak: vi.fn(),
  paused: false,
  getVoices: () => [english, german],
}

function heard(text: string, isFinal: boolean): RecognitionResultEvent {
  return { resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }
}

function reply(id: string, content: string, extra: Partial<Message> = {}): Message {
  return { id, role: 'assistant', content, createdAt: 0, ...extra }
}

function stubSpeech(): void {
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
}

/** Recognition starts on a timeout, after dictation has released the microphone. */
async function openEar(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  synthesis.cancel.mockClear()
  synthesis.speak.mockClear()
  FakeRecognition.instances = []
  resetSpokenClaims()
  useLocale.setState({ locale: 'en' })
  useChatStore.setState({ busy: false, queued: [], messages: [], online: true, status: 'idle' })
})

describe('TalkButton', () => {
  it('stays on screen, and says why, where the browser cannot listen or speak', () => {
    const { rerender } = render(<TalkButton />)
    expect(screen.getByRole('button', { name: 'Talk' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Talk' })).toHaveTextContent('Talk')
    expect(screen.getByText('Live talk needs Chrome or Edge.')).toBeInTheDocument()

    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    rerender(<TalkButton />)
    expect(screen.getByRole('button', { name: 'Talk' })).toBeDisabled()
  })

  it('stays quiet while there is no connection', () => {
    stubSpeech()
    useChatStore.setState({ online: false })
    render(<TalkButton />)
    expect(screen.getByRole('button', { name: 'Talk' })).toBeDisabled()
  })

  it('listens in the chosen language and sends a phrase once you pause', async () => {
    stubSpeech()
    const user = userEvent.setup()
    const onActivity = vi.fn()
    useLocale.setState({ locale: 'de' })
    useChatStore.setState({ status: 'ready', online: true, busy: false })
    render(<TalkButton onActivity={onActivity} />)

    await user.click(screen.getByRole('button', { name: 'Sprechen' }))
    await openEar()
    const recognition = FakeRecognition.instances[0]
    expect(recognition?.lang).toBe('de-DE')
    expect(recognition?.continuous).toBe(true)
    expect(recognition?.start).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Gespräch beenden' })).toHaveAttribute('aria-pressed', 'true')

    // A reply is running by the time the phrase is ready, so it waits rather
    // than starting a second turn — and a test must not construct a worker.
    useChatStore.setState({ busy: true })
    act(() => recognition?.onresult?.(heard('in Berlin', false)))
    expect(onActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'listening', heard: 'in Berlin', failure: null }),
    )

    act(() => recognition?.onresult?.(heard('Wie spät ist es in Berlin', true)))
    expect(useChatStore.getState().queued).toEqual([])

    await waitFor(
      () => {
        expect(useChatStore.getState().queued).toEqual(['Wie spät ist es in Berlin'])
      },
      { timeout: TURN_PAUSE_MS + 500 },
    )
    expect(screen.getByRole('button', { name: 'Gespräch beenden' })).toBeInTheDocument()
  })

  it('does not send a phrase when the conversation is ended first', async () => {
    stubSpeech()
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', online: true })
    render(<TalkButton />)

    await user.click(screen.getByRole('button', { name: 'Talk' }))
    await openEar()
    const recognition = FakeRecognition.instances[0]
    act(() => recognition?.onresult?.(heard('hello', true)))
    await user.click(screen.getByRole('button', { name: 'End conversation' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TURN_PAUSE_MS))
    })

    expect(recognition?.abort).toHaveBeenCalled()
    expect(useChatStore.getState().queued).toEqual([])
    expect(useChatStore.getState().messages).toEqual([])
    expect(screen.getByRole('button', { name: 'Talk' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hangs up when a phrase cannot be sent offline', async () => {
    stubSpeech()
    const user = userEvent.setup()
    const onActivity = vi.fn()
    useChatStore.setState({ status: 'ready', online: true })
    render(<TalkButton onActivity={onActivity} />)

    await user.click(screen.getByRole('button', { name: 'Talk' }))
    await openEar()
    useChatStore.setState({ online: false })
    act(() => FakeRecognition.instances[0]?.onresult?.(heard('hello', true)))

    await waitFor(
      () => {
        expect(onActivity).toHaveBeenLastCalledWith(
          expect.objectContaining({
            phase: 'idle',
            failure:
              'No connection. Jarvis answers from the live web, so it waits until you are back online.',
          }),
        )
      },
      { timeout: TURN_PAUSE_MS + 500 },
    )
    expect(useChatStore.getState().messages).toEqual([])
    expect(screen.getByRole('button', { name: 'Talk' })).toBeDisabled()
  })

  it('reads the reply in a matching voice and then listens again', async () => {
    stubSpeech()
    const user = userEvent.setup()
    useLocale.setState({ locale: 'de' })
    useChatStore.setState({
      messages: [reply('old', 'Already on screen.')],
      online: true,
    })
    render(<TalkButton />)

    await user.click(screen.getByRole('button', { name: 'Sprechen' }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() =>
      useChatStore.setState({
        messages: [reply('old', 'Already on screen.'), reply('new', 'Berlin ist **schön**.')],
      }),
    )

    expect(synthesis.speak).toHaveBeenCalledOnce()
    const utterance = synthesis.speak.mock.calls[0]?.[0] as Utterance
    expect(utterance.text).toBe('Berlin ist schön.')
    expect(utterance.lang).toBe('de-DE')
    expect(utterance.voice).toBe(german)
    expect(screen.getByRole('button', { name: 'Gespräch beenden' })).toBeInTheDocument()

    const started = FakeRecognition.instances.length
    act(() => utterance.onend?.())
    await openEar()
    expect(FakeRecognition.instances.length).toBe(started + 1)
    expect(FakeRecognition.instances.at(-1)?.start).toHaveBeenCalledOnce()
  })

  it('says a failed turn aloud and ends when the microphone is refused', async () => {
    stubSpeech()
    const user = userEvent.setup()
    const onActivity = vi.fn()
    render(<TalkButton onActivity={onActivity} />)

    await user.click(screen.getByRole('button', { name: 'Talk' }))
    act(() =>
      useChatStore.setState({
        messages: [reply('e', '', { error: 'The worker stopped.' })],
      }),
    )

    const utterance = synthesis.speak.mock.calls[0]?.[0] as Utterance
    expect(utterance.text).toBe('I could not answer that.')

    act(() => utterance.onend?.())
    await openEar()
    act(() => FakeRecognition.instances.at(-1)?.onerror?.({ error: 'not-allowed' }))

    expect(onActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'idle', failure: 'Microphone access was refused.' }),
    )
    expect(screen.getByRole('button', { name: 'Talk' })).toBeInTheDocument()
  })
})
