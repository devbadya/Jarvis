import { describe, expect, it } from 'vitest'
import { defineTool } from '@/tools/types'
import type { TopicTurn } from '@/memory/topic'
import {
  ageReply,
  factAskQuery,
  formatResearchedReply,
  pronounFollowUpFocus,
  researchQuery,
  researchSeed,
  researchSentence,
  settleResearch,
} from './ground'
import type { ReviewEvidence } from './review'

function turn(role: TopicTurn['role'], content: string, toolCalls?: TopicTurn['toolCalls']): TopicTurn {
  return { role, content, toolCalls }
}

const chancellor: TopicTurn[] = [
  turn('user', 'Wer ist der Bundeskanzler?'),
  turn('assistant', 'Friedrich Merz, seit Mai 2025.', [
    {
      name: 'research',
      arguments: { query: 'Bundeskanzler' },
      status: 'done',
      result: [
        'Answer: Friedrich Merz.',
        '',
        'Researched 2026-09-10 for "Bundeskanzler" across 1 source, all read in full.',
        '',
        '1. Bundeskanzler — https://de.wikipedia.org/wiki/Bundeskanzler',
        '   "Amtsträger ist Friedrich Merz."',
      ].join('\n'),
    },
  ]),
]

const franceThen: TopicTurn[] = [
  turn('user', 'Who is the president of France?'),
  turn('assistant', 'Emmanuel Macron.'),
]

function evidence(results: { tool: string; result: string }[] = []): ReviewEvidence {
  return { toolResults: results, knownUrls: [] }
}

const merzDigest = [
  'Answer: Friedrich Merz.',
  '',
  'Researched 2026-09-10 for "Bundeskanzler" across 1 source, all read in full.',
  '',
  '1. Bundeskanzler — https://de.wikipedia.org/wiki/Bundeskanzler',
  '   "Amtsträger ist Friedrich Merz."',
].join('\n')

describe('researchQuery', () => {
  it('passes a complete question through', () => {
    expect(researchQuery('who is the president of the USA')).toBe('who is the president of the USA')
  })

  it('does not mix a new complete question with the previous office', () => {
    expect(researchQuery('who is the president of the USA', franceThen)).toBe(
      'who is the president of the USA',
    )
  })

  it('keeps the last office and adds the new place on a follow-up', () => {
    expect(researchQuery('und der von Frankreich?', chancellor)).toBe('Bundeskanzler Frankreich')
  })

  it('keeps the last office on a correction that only names a place', () => {
    const russia = [turn('user', 'Wer ist der russische Präsident?'), turn('assistant', 'Wladimir Putin.')]
    expect(researchQuery('nein in russland', russia)).toBe('russische Präsident russland')
  })

  it('does not pin the last office onto a new person', () => {
    expect(researchQuery('Wer ist Elon Musk?', chancellor)).toBe('Wer ist Elon Musk?')
    expect(researchQuery('und Elon Musk?', chancellor)).toBe('und Elon Musk?')
  })

  it('looks a pronoun follow-up up as the last person plus the attribute', () => {
    expect(researchQuery('does he has a women?', chancellor)).toBe('Friedrich Merz women')
    expect(researchQuery('how old is he?', chancellor)).toBe('Friedrich Merz how old')
    expect(researchQuery('ist er verheiratet?', chancellor)).toBe('Friedrich Merz verheiratet')
    expect(researchQuery('Und wie alt ist er?', chancellor)).toBe('Friedrich Merz wie alt')
  })

  it('pins a pronoun follow-up to a name that only appeared in assistant prose', () => {
    expect(researchQuery('does he has a women?', franceThen)).toBe('Emmanuel Macron women')
    expect(researchQuery('how old is he', franceThen)).toBe('Emmanuel Macron how old')
  })

  it('pins a pronoun follow-up to a name the user typed informally', () => {
    const informal = [
      turn('user', 'no of macron has a wife'),
      turn('assistant', 'Emmanuel Macron is not married.'),
    ]
    expect(researchQuery('how old is he', informal)).toBe('Emmanuel Macron how old')
  })

  it('looks an informal fact-ask up as the name plus the attribute', () => {
    expect(researchQuery('no of macron has a wife')).toBe('macron wife')
    expect(researchQuery('macron has a wife')).toBe('macron wife')
    expect(researchQuery('macron frau')).toBe('macron frau')
  })

  it('does not pin a person onto a question that names its own subject', () => {
    expect(researchQuery('does France have a king?', chancellor)).toBe('does France have a king?')
    expect(researchQuery('who is the president of the USA', chancellor)).toBe(
      'who is the president of the USA',
    )
  })
})

describe('factAskQuery', () => {
  it.each([
    ['no of macron has a wife', 'macron wife'],
    ['macron has a wife', 'macron wife'],
    ['weißt du ob macron verheiratet ist', 'macron verheiratet'],
  ])('narrows %j to %j', (raw, expected) => {
    expect(factAskQuery(raw)).toBe(expected)
  })
})

describe('pronounFollowUpFocus', () => {
  it.each([
    ['does he has a women?', 'women'],
    ['how old is he?', 'how old'],
    ['ist er verheiratet?', 'verheiratet'],
    ["what's his age?", 'age'],
    ['when was he born?', 'when born'],
  ])('narrows %j to %j', (raw, expected) => {
    expect(pronounFollowUpFocus(raw)).toBe(expected)
  })
})

describe('researchSeed', () => {
  const research = defineTool('research', 'look it up', { type: 'object', properties: {} }, async () => '')

  it('seeds research when that skill routed', () => {
    expect(
      researchSeed({ skill: { name: 'research-question' }, tools: [research] }, 'Who wrote Dune?'),
    ).toEqual({ name: 'research', arguments: { query: 'Who wrote Dune?' } })
  })

  it('does not seed another skill', () => {
    expect(researchSeed({ skill: { name: 'weather' }, tools: [research] }, 'Who wrote Dune?')).toBeNull()
  })

  it('does not seed when the research tool is missing', () => {
    expect(researchSeed({ skill: { name: 'research-question' }, tools: [] }, 'Who wrote Dune?')).toBeNull()
  })
})

describe('formatResearchedReply', () => {
  it('hands over the extract and its source', () => {
    expect(formatResearchedReply(evidence([{ tool: 'research', result: merzDigest }]))).toBe(
      'Friedrich Merz.\n\nSource: https://de.wikipedia.org/wiki/Bundeskanzler',
    )
  })

  it('stays silent when the digest committed to no extract', () => {
    expect(
      formatResearchedReply(
        evidence([{ tool: 'research', result: 'Researched 2026-09-11 for "x". No results.' }]),
      ),
    ).toBeNull()
  })
})

describe('settleResearch', () => {
  it('answers with the extract in a sentence built from the question', () => {
    expect(
      settleResearch(evidence([{ tool: 'research', result: merzDigest }]), 'Wer ist der Bundeskanzler?'),
    ).toBe('Der Bundeskanzler ist Friedrich Merz.\n\nSource: https://de.wikipedia.org/wiki/Bundeskanzler')
  })

  it('answers a definition question with the article’s own opening', () => {
    const digest = [
      'Definition: Ein Schwarzes Loch ist ein Objekt, dessen Masse die Raumzeit stark krümmt.',
      '',
      'Researched 2026-09-25 for "Was ist ein schwarzes Loch?" across 1 source, all read in full.',
      '',
      '1. Schwarzes Loch — https://de.wikipedia.org/wiki/Schwarzes_Loch',
      '   "Die Grenze dieses Bereiches wird Ereignishorizont genannt."',
    ].join('\n')
    expect(
      settleResearch(evidence([{ tool: 'research', result: digest }]), 'Was ist ein schwarzes Loch?'),
    ).toBe(
      'Ein Schwarzes Loch ist ein Objekt, dessen Masse die Raumzeit stark krümmt.\n\nSource: https://de.wikipedia.org/wiki/Schwarzes_Loch',
    )
  })

  it('leaves a digest with no extract for the model to write up', () => {
    const digest = [
      'Researched 2026-09-11 for "Elon Musk" across 1 source, all read in full.',
      '',
      '1. Elon Musk — https://en.wikipedia.org/wiki/Elon_Musk',
      '   "Elon Musk is a businessman."',
    ].join('\n')

    expect(settleResearch(evidence([{ tool: 'research', result: digest }]), 'Who is Elon Musk?')).toBeNull()
  })

  it('refuses a digest that does not mention anything from the query', () => {
    const digest = [
      'Researched 2026-09-11 for "Emmanuel Macron women" across 1 source, all read in full.',
      '',
      '1. Adolf Hitler — https://en.wikipedia.org/wiki/Adolf_Hitler',
      '   "In 2025, geneticists examined blood from the Führerbunker sofa."',
    ].join('\n')

    const text = settleResearch(evidence([{ tool: 'research', result: digest }]), 'does he has a women?')
    expect(text).toBe('I could not find a reliable answer.')
    expect(text).not.toMatch(/Hitler|Führerbunker|wikipedia/i)
  })

  it('refuses in the language of the question when nothing came back', () => {
    expect(settleResearch(evidence(), 'who is the president of the USA')).toBe(
      'I could not find a reliable answer.',
    )
    expect(settleResearch(evidence(), 'Wer ist der Präsident der USA?')).toBe(
      'Dazu habe ich keine verlässliche Antwort gefunden.',
    )
  })

  it('follows the chosen language over the language of the question', () => {
    expect(settleResearch(evidence(), 'who is the president of the USA', undefined, 'de')).toBe(
      'Dazu habe ich keine verlässliche Antwort gefunden.',
    )
  })

  it('surfaces a lookup failure instead of inventing a fact', () => {
    expect(settleResearch(evidence(), 'who is the president of the USA', 'rate-limited')).toBe(
      'The lookup failed: rate-limited',
    )
    expect(settleResearch(evidence(), 'Wer ist der Präsident?', 'rate-limited')).toBe(
      'Das Nachschlagen hat nicht geklappt: rate-limited',
    )
  })
})

describe('researchSentence', () => {
  it.each([
    [
      'Wer ist der Bundeskanzler von Deutschland?',
      'Friedrich Merz',
      'de',
      'Der Bundeskanzler von Deutschland ist Friedrich Merz.',
    ],
    ['Wer ist aktuell Bundeskanzler?', 'Friedrich Merz', 'de', 'Bundeskanzler ist aktuell Friedrich Merz.'],
    [
      'Wer ist der russische Präsident gerade?',
      'Wladimir Putin',
      'de',
      'Der russische Präsident ist gerade Wladimir Putin.',
    ],
    [
      'Wer hat Faust geschrieben?',
      'Johann Wolfgang von Goethe',
      'de',
      'Johann Wolfgang von Goethe hat Faust geschrieben.',
    ],
    [
      'Wie heißt der Präsident von Frankreich?',
      'Emmanuel Macron',
      'de',
      'Der Präsident von Frankreich heißt Emmanuel Macron.',
    ],
    ['Wie viele Einwohner hat München?', '1,5 Millionen', 'de', 'München hat 1,5 Millionen Einwohner.'],
    [
      'Was ist die Einwohnerzahl von Berlin?',
      '3,8 Millionen',
      'de',
      'Die Einwohnerzahl von Berlin beträgt 3,8 Millionen.',
    ],
    [
      'Was ist die Hauptstadt von Australien?',
      'Canberra',
      'de',
      'Die Hauptstadt von Australien ist Canberra.',
    ],
    ['Was kostet ein Big Mac?', '5,69 Euro', 'de', 'Ein Big Mac kostet 5,69 Euro.'],
    ['und der von Frankreich?', 'Emmanuel Macron', 'de', 'Emmanuel Macron.'],
    [
      'Who is the president of France?',
      'Emmanuel Macron',
      'en',
      'The president of France is Emmanuel Macron.',
    ],
    ['Who wrote Dune?', 'Frank Herbert', 'en', 'Frank Herbert wrote Dune.'],
    [
      "What's the population of Tokyo?",
      '13.96 million people',
      'en',
      'The population of Tokyo is 13.96 million people.',
    ],
    [
      'Who is currently the UN secretary-general?',
      'António Guterres',
      'en',
      'The UN secretary-general is currently António Guterres.',
    ],
  ] as const)('%j with %j reads %j', (question, extracted, language, expected) => {
    expect(researchSentence(question, extracted, language)).toBe(expected)
  })
})

describe('ageReply', () => {
  const born = evidence([
    {
      tool: 'research',
      result:
        'Born: Friedrich Merz, 1955-11-11\n\nResearched 2026-09-25 for "Friedrich Merz wie alt" across 1 source, all read in full.\n\n1. Friedrich Merz — https://de.wikipedia.org/wiki/Friedrich_Merz\n   "Merz ist ein Politiker."',
    },
  ])

  it('works the age out from the birth date, counting a birthday not yet reached', () => {
    expect(ageReply(born, 'de', new Date('2026-09-25T12:00:00Z'))).toBe(
      'Friedrich Merz ist 70 Jahre alt (geboren am 11. November 1955).',
    )
    expect(ageReply(born, 'en', new Date('2026-11-11T12:00:00Z'))).toBe(
      'Friedrich Merz is 71 years old (born 11 November 1955).',
    )
  })

  it('answers an age follow-up with it and the article it came from', () => {
    expect(settleResearch(born, 'Und wie alt ist er?')).toMatch(
      /^Friedrich Merz ist \d+ Jahre alt \(geboren am 11\. November 1955\)\.\n\nSource: https:\/\/de\.wikipedia\.org\/wiki\/Friedrich_Merz$/,
    )
  })
})
