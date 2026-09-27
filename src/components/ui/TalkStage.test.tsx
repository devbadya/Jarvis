import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TalkStage } from './TalkStage'
import { useLocale } from '@/i18n'
import { readPresence } from '@/lib/presence'
import { JARVIS_PITCH, SPEAK_GAP_MS } from '@/lib/speech'
import { useChatStore } from '@/store/chat'

class Utterance {
  text: string
  lang = ''
  voice: { name?: string } | null = null
  pitch = 1
  rate = 1
  volume = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  onstart: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const german = { lang: 'de-DE', name: 'Anna', localService: true }
const english = { lang: 'en-US', name: 'Samantha', localService: true }

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  useLocale.setState({ locale: 'en' })
  useChatStore.setState({ messages: [] })
})

function stubSpeech(speak = vi.fn()): { speak: ReturnType<typeof vi.fn> } {
  vi.stubGlobal('speechSynthesis', {
    cancel: vi.fn(),
    speak,
    paused: false,
    getVoices: () => [english, german],
  })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  return { speak }
}

describe('TalkStage', () => {
  it('shows Jarvis in rings, and remembers a colour and a figure', async () => {
    stubSpeech()
    const user = userEvent.setup()
    render(<TalkStage failure={null} heard="" phase="listening" onEnd={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Jarvis' })).toBeInTheDocument()
    expect(screen.getByText('Speak, then pause.')).toBeInTheDocument()
    expect(
      screen.getByText('His own voice: lower and steadier than the browser default.'),
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Rings' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Violet' }))
    expect(readPresence().color).toBe('violet')
    expect(screen.getByRole('button', { name: 'Violet' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Orb' }))
    expect(readPresence()).toMatchObject({ design: 'orb', color: 'violet' })
    expect(screen.getByRole('button', { name: 'Orb' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('stores a voice for this language and speaks a sample in it', async () => {
    const { speak } = stubSpeech()
    const user = userEvent.setup()
    render(<TalkStage failure={null} heard="" phase="speaking" onEnd={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Hear this voice' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SPEAK_GAP_MS + 30))
    })
    const jarvis = speak.mock.calls.at(-1)?.[0] as Utterance
    expect(jarvis.text).toBe('Hello. I am Jarvis.')
    expect(jarvis.lang).toBe('en-US')
    expect(jarvis.voice).toBe(english)
    expect(jarvis.pitch).toBe(JARVIS_PITCH)

    await user.selectOptions(screen.getByLabelText('Voice'), 'Samantha')
    expect(readPresence().voiceName).toBe('Samantha')
    expect(screen.getByLabelText('Voice')).toHaveValue('Samantha')

    await user.click(screen.getByRole('button', { name: 'Hear this voice' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SPEAK_GAP_MS + 30))
    })
    const chosen = speak.mock.calls.at(-1)?.[0] as Utterance
    expect(chosen.voice).toBe(english)
    expect(chosen.pitch).toBe(1)
  })

  it('shows what was heard, and hangs up from the stage or Escape', async () => {
    const user = userEvent.setup()
    const onEnd = vi.fn()
    render(<TalkStage failure={null} heard="hello there" phase="listening" onEnd={onEnd} />)

    expect(screen.getByRole('dialog', { name: 'Jarvis' })).toHaveTextContent('hello there')
    await user.click(screen.getByRole('button', { name: 'Hang up' }))
    expect(onEnd).toHaveBeenCalledOnce()

    await user.keyboard('{Escape}')
    expect(onEnd).toHaveBeenCalledTimes(2)
  })
})
