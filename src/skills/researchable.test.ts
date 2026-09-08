import { describe, expect, it } from 'vitest'
import { isResearchable } from './researchable'

describe('isResearchable', () => {
  it.each([
    'What is the capital of France?',
    'What temperature does water boil at?',
    'Why is the sky blue?',
    'Warum ist der Himmel blau?',
    'How does photosynthesis work?',
    'What is 32 fahrenheit in celsius',
    'Explain the French Revolution',
    'Tell me about the history of Rome',
    'Was ist die Hauptstadt von Frankreich?',
    'Wie funktioniert Photosynthese?',
  ])('takes the factual question %j', (message) => {
    expect(isResearchable(message)).toBe(true)
  })

  it.each([
    'How are you?',
    "How's it going?",
    'wie gehts dir',
    "Wie geht's dir?",
    'Wie geht es dir?',
    'wie gehts',
    "what's up?",
    "What's up",
    'Hallo',
    'Hello there',
    'Was machst du heute?',
    'Who are you?',
    'What is your name?',
    'What is my favourite colour?',
    "What's my favourite colour?",
    'Was ist mein Lieblingsessen?',
    'Who is that?',
    'What is this?',
    'Was ist das?',
    'Was ist los?',
    'Write a two-line rhyme about rain.',
    'Erzähl mir einen Witz',
    'Can you write a poem?',
    'thanks',
    'I was born in 2024',
    'I currently live in Berlin',
    "I can't remember the capital of Peru.",
    'ok cool',
    'Tell me about yourself',
    'Tell me about the trip we planned',
    'Tell me about it',
    'and in Lisbon?',
    'Erklär mir das nochmal',
    'Erkläre mir warum das nicht geht',
    'Erkläre mir, wie das funktioniert',
  ])('leaves %j alone', (message) => {
    expect(isResearchable(message)).toBe(false)
  })

  it('still researches news that only looks like a greeting at the start', () => {
    expect(isResearchable("What's up in France?")).toBe(true)
  })
})
