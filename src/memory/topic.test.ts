import { describe, expect, it } from 'vitest'
import {
  conversationTopic,
  joinPromptNotes,
  lastEstablishedPlace,
  renderTopicBlock,
  type TopicTurn,
} from './topic'

function turn(role: TopicTurn['role'], content: string, toolCalls?: TopicTurn['toolCalls']): TopicTurn {
  return { role, content, toolCalls }
}

const frankfurtWeather: TopicTurn[] = [
  turn('user', 'Wie ist das Wetter in Frankfurt?'),
  turn('assistant', 'Frankfurt is around 18 °C and cloudy, with little wind.', [
    {
      name: 'weather',
      arguments: { place: 'Frankfurt' },
      status: 'done',
      result: 'Frankfurt, Germany — 15:45 local (Europe/Berlin)\nNow: 18 °C, cloudy',
    },
  ]),
]

describe('lastEstablishedPlace', () => {
  it('reads the place off the last successful weather call', () => {
    expect(lastEstablishedPlace(frankfurtWeather)).toBe('Frankfurt')
  })

  it('prefers a later city when the conversation moves', () => {
    const turns = [
      ...frankfurtWeather,
      turn('user', 'und in Hamburg?'),
      turn('assistant', 'Hamburg is 14 °C.', [
        {
          name: 'weather',
          arguments: { place: 'Hamburg' },
          status: 'done',
          result: 'Hamburg, Germany — 12:00',
        },
      ]),
    ]

    expect(lastEstablishedPlace(turns)).toBe('Hamburg')
  })

  it('falls back to a weather question when no tool call was recorded', () => {
    expect(
      lastEstablishedPlace([
        turn('user', 'Wie ist das Wetter in Frankfurt?'),
        turn('assistant', 'Frankfurt is around 18 °C and cloudy.'),
      ]),
    ).toBe('Frankfurt')
  })

  it('does not invent a place from a weather question that named none', () => {
    expect(lastEstablishedPlace([turn('user', 'Wie wird das Wetter?')])).toBeNull()
  })

  it('reads the city off a successful clock call', () => {
    expect(
      lastEstablishedPlace([
        turn('user', 'What time is it in Tokyo?'),
        turn('assistant', 'In Tokyo it is 06:51 JST.', [
          {
            name: 'current_time',
            arguments: { place: 'Tokyo' },
            status: 'done',
            result:
              'Tokyo, Japan — Thu 27 Aug 2026, 06:51:00 JST (Asia/Tokyo) — instant 2026-08-26T21:51:00.000Z',
          },
        ]),
      ]),
    ).toBe('Tokyo')
  })

  it('does not treat a local clock reading as a place', () => {
    expect(
      lastEstablishedPlace([
        turn('assistant', 'It is 2026.', [
          {
            name: 'current_time',
            arguments: {},
            status: 'done',
            result: 'Wed 26 Aug 2026, 23:51:00 CEST (Europe/Berlin) — instant 2026-08-26T21:51:00.000Z',
          },
        ]),
      ]),
    ).toBeNull()
  })

  it('falls back to a clock question when no tool call was recorded', () => {
    expect(lastEstablishedPlace([turn('user', 'What time is it in Tokyo?')])).toBe('Tokyo')
  })

  it('skips a weather call that failed', () => {
    expect(
      lastEstablishedPlace([
        turn('assistant', '', [
          { name: 'weather', arguments: { place: 'Narnia' }, status: 'error', result: undefined },
        ]),
      ]),
    ).toBeNull()
  })

  it('reads the resolved city from the result when the argument was the whole question', () => {
    expect(
      lastEstablishedPlace([
        turn('assistant', 'Frankfurt is around 18 °C.', [
          {
            name: 'weather',
            arguments: { place: 'Wie ist das Wetter in Frankfurt?' },
            status: 'done',
            result: 'Frankfurt, Germany — 15:45 local\nNow: 18 °C',
          },
        ]),
      ]),
    ).toBe('Frankfurt')
  })
})

describe('conversationTopic', () => {
  it('pins the place onto a follow-up that names none', () => {
    expect(conversationTopic('Und morgen?', frankfurtWeather, { skill: 'weather' })).toBe(
      'This conversation is about Frankfurt.',
    )
  })

  it('pins it onto a weather question that names no place', () => {
    expect(conversationTopic('Wie wird das Wetter?', frankfurtWeather, { skill: 'weather' })).toBe(
      'This conversation is about Frankfurt.',
    )
  })

  it('pins it onto an anaphoric question that still needs the city', () => {
    expect(conversationTopic('Wer ist der Bürgermeister?', frankfurtWeather)).toBe(
      'This conversation is about Frankfurt.',
    )
  })

  it('pins a clock follow-up that names no place', () => {
    const tokyo: TopicTurn[] = [
      turn('user', 'What time is it in Tokyo?'),
      turn('assistant', 'In Tokyo it is 06:51 JST.', [
        {
          name: 'current_time',
          arguments: { place: 'Tokyo' },
          status: 'done',
          result:
            'Tokyo, Japan — Thu 27 Aug 2026, 06:51:00 JST (Asia/Tokyo) — instant 2026-08-26T21:51:00.000Z',
        },
      ]),
    ]

    expect(conversationTopic('and now?', tokyo, { skill: 'world-clock' })).toBe(
      'This conversation is about Tokyo.',
    )
  })

  it('stays silent when the question already names that place', () => {
    expect(conversationTopic('Wetter in Frankfurt morgen?', frankfurtWeather, { skill: 'weather' })).toBe('')
  })

  it('stays silent when the follow-up names a different city', () => {
    expect(conversationTopic('und in Hamburg?', frankfurtWeather, { skill: 'weather' })).toBe('')
    expect(conversationTopic('What about Rome?', frankfurtWeather)).toBe('')
  })

  it('stays silent on a fresh question that names its own subject', () => {
    expect(conversationTopic('Wer ist Elon Musk?', frankfurtWeather)).toBe('')
    expect(conversationTopic('What is the capital of France?', frankfurtWeather)).toBe('')
  })

  it('stays silent when nothing was established', () => {
    expect(conversationTopic('Und morgen?', [], { skill: 'weather' })).toBe('')
  })
})

describe('joinPromptNotes', () => {
  it('joins recall and topic without a blank announcement', () => {
    expect(
      joinPromptNotes(
        'What you already know about this user:\n- Prefers short answers',
        renderTopicBlock('Frankfurt'),
      ),
    ).toBe(
      'What you already know about this user:\n- Prefers short answers\n\nThis conversation is about Frankfurt.',
    )
  })

  it('is empty when both sides are', () => {
    expect(joinPromptNotes('', '')).toBe('')
  })
})
