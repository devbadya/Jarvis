import { describe, expect, it } from 'vitest'
import { runAgent } from './loop'
import { groundingFor } from './ground'
import { smallTalkReply } from './smalltalk'
import type { LlmClient } from '@/llm/client'

const conversation = { skill: { name: 'conversation' }, tools: [] }

describe('smallTalkReply', () => {
  it.each([
    ['Hallo Jarvis, wie geht es dir?', 'de', 'Mir geht es gut, danke! Wie kann ich dir helfen?'],
    ['Hi, how are you?', 'en', "I'm doing well, thanks! How can I help you?"],
    ['Hallo', 'de', 'Hallo! Wie kann ich dir helfen?'],
    ['Guten Morgen', 'de', 'Guten Morgen! Wie kann ich dir helfen?'],
    ['guten abend jarvis', 'de', 'Guten Abend! Wie kann ich dir helfen?'],
    ['Good morning', 'en', 'Good morning! How can I help you?'],
    ['Danke!', 'de', 'Gern geschehen! Sag Bescheid, wenn du noch etwas brauchst.'],
    [
      'Wer bist du?',
      'de',
      'Ich bin Jarvis, ein Assistent, der ganz in deinem Browser läuft. Wie kann ich dir helfen?',
    ],
  ] as const)('answers %j', (message, language, expected) => {
    expect(smallTalkReply(message, language)).toBe(expected)
  })

  it('lists only what the app can actually do', () => {
    const reply = smallTalkReply('Was kannst du alles?', 'de') ?? ''
    expect(reply).toMatch(/Wetter/)
    expect(reply).toMatch(/Kalender/)
    expect(reply).not.toMatch(/Sie\b|Ihnen/)
  })

  it('leaves a language it has no wording for to the model', () => {
    expect(smallTalkReply('Bonjour, ça va ?', 'en', 'fr')).toBeNull()
  })

  it('answers without a generation once the skill routed', async () => {
    const client = {
      generate: async () => ({
        text: 'x</think>Ich habe alles richtig!',
        tokens: 1,
        thinkTokens: 0,
        durationMs: 1,
      }),
    }
    const result = await runAgent(
      client as unknown as LlmClient,
      [{ role: 'user', content: 'Hallo Jarvis, wie geht es dir?' }],
      [],
      { onPartial: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onRoundEnd: () => {} },
      { ...groundingFor(conversation, 'Hallo Jarvis, wie geht es dir?'), language: 'de' },
    )
    expect(result.content).toBe('Mir geht es gut, danke! Wie kann ich dir helfen?')
  })
})
