import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictateButton } from './DictateButton'
import { describeFailure, type RecognitionLike, type RecognitionResultEvent } from '@/lib/speech'

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

afterEach(() => {
  vi.unstubAllGlobals()
  FakeRecognition.instances = []
})

function heard(text: string, isFinal: boolean): RecognitionResultEvent {
  return { resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }
}

describe('DictateButton', () => {
  it('renders nothing where the browser cannot listen', () => {
    render(<DictateButton draft="" onDraft={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument()
  })

  it('listens in the language of the last message and puts the words in the draft', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const user = userEvent.setup()
    const onDraft = vi.fn()
    const onStatus = vi.fn()
    render(
      <DictateButton
        draft="Bitte"
        lastMessage="Wie viel ist 7 mal 8?"
        onDraft={onDraft}
        onStatus={onStatus}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Dictate' }))
    const [recognition] = FakeRecognition.instances
    expect(recognition?.lang).toBe('de-DE')
    expect(recognition?.start).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toHaveAttribute('aria-pressed', 'true')

    act(() => recognition?.onresult?.(heard('öffne', false)))
    expect(onDraft).toHaveBeenLastCalledWith('Bitte öffne')
    act(() => recognition?.onresult?.(heard('öffne Spotify', true)))
    expect(onDraft).toHaveBeenLastCalledWith('Bitte öffne Spotify')

    act(() => recognition?.onend?.())
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
    // Words were heard, so there is nothing to complain about.
    expect(onStatus).toHaveBeenLastCalledWith(null)
  })

  it('stops early on a second press', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const user = userEvent.setup()
    render(<DictateButton draft="" onDraft={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Dictate' }))
    await user.click(screen.getByRole('button', { name: 'Stop dictating' }))

    expect(FakeRecognition.instances[0]?.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
  })

  it('says when a session ended without hearing anything', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const user = userEvent.setup()
    const onStatus = vi.fn()
    render(<DictateButton draft="" onDraft={() => {}} onStatus={onStatus} />)

    await user.click(screen.getByRole('button', { name: 'Dictate' }))
    act(() => FakeRecognition.instances[0]?.onend?.())

    expect(onStatus).toHaveBeenLastCalledWith('Nothing was heard.')
  })

  it('says when the microphone was refused or missing', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const user = userEvent.setup()
    const onStatus = vi.fn()
    render(<DictateButton draft="" onDraft={() => {}} onStatus={onStatus} />)

    await user.click(screen.getByRole('button', { name: 'Dictate' }))
    act(() => {
      FakeRecognition.instances[0]?.onerror?.({ error: 'not-allowed' })
      FakeRecognition.instances[0]?.onend?.()
    })

    expect(onStatus).toHaveBeenLastCalledWith('Microphone access was refused.')
    expect(describeFailure('audio-capture')).toBe('No microphone was found.')
    expect(describeFailure('network')).toBe('The speech service could not be reached.')
  })
})
