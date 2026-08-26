import { afterEach, describe, expect, it } from 'vitest'
import { MAX_HISTORY_CHARS, residentSkill, rewindToLastPrompt, toHistory, useChatStore } from './chat'
import type { AppliedSkill, Message } from '@/types'

function message(role: Message['role'], content: string): Message {
  return { id: content, role, content, createdAt: 0 }
}

function answer(content: string, skill?: AppliedSkill): Message {
  return { ...message('assistant', content), ...(skill ? { skill } : {}) }
}

const matched: AppliedSkill = { name: 'weather', reason: 'trigger', matched: [] }
const carried: AppliedSkill = { name: 'weather', reason: 'carried-over', matched: [] }

describe('rewindToLastPrompt', () => {
  it('drops the reply being rerun but keeps the request', () => {
    const rewound = rewindToLastPrompt([
      message('user', 'first'),
      message('assistant', 'first answer'),
      message('user', 'second'),
      message('assistant', 'failed'),
    ])

    expect(rewound?.map((entry) => entry.content)).toEqual(['first', 'first answer', 'second'])
  })

  it('leaves a transcript already ending in a request alone', () => {
    const messages = [message('user', 'only')]
    expect(rewindToLastPrompt(messages)?.map((entry) => entry.content)).toEqual(['only'])
  })

  it('has nothing to rerun without a request', () => {
    expect(rewindToLastPrompt([])).toBeNull()
    expect(rewindToLastPrompt([message('assistant', 'orphan')])).toBeNull()
  })
})

describe('toHistory', () => {
  it('sends the conversation as the model should read it', () => {
    const history = toHistory([
      message('user', 'first'),
      message('assistant', 'first answer'),
      message('user', 'second'),
    ])

    expect(history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second' },
    ])
  })

  it('drops a reply that never produced anything', () => {
    // An empty assistant turn takes the next turn's context with it, which is
    // the second reason the loop promotes reasoning into an empty answer.
    const history = toHistory([
      message('user', 'hi'),
      message('assistant', ''),
      message('user', 'still there?'),
    ])

    expect(history.map((turn) => turn.content)).toEqual(['hi', 'still there?'])
  })

  it('drops the oldest turns once the budget is spent, whole turns at a time', () => {
    const history = toHistory(
      [
        message('user', 'ancient question'),
        message('assistant', 'ancient answer'),
        message('user', 'recent question'),
        message('assistant', 'recent answer'),
        message('user', 'now'),
      ],
      // Room for the last three of these and not the first two.
      40,
    )

    expect(history.map((turn) => turn.content)).toEqual(['recent question', 'recent answer', 'now'])
  })

  it('keeps the turn being answered however long it is', () => {
    // Truncating the question is worse than sending nothing else: what was asked
    // is the one thing the turn cannot do without.
    const asked = 'x'.repeat(MAX_HISTORY_CHARS * 2)
    const history = toHistory([message('user', 'earlier'), message('user', asked)])

    expect(history).toEqual([{ role: 'user', content: asked }])
  })
})

describe('residentSkill', () => {
  it('has nothing to carry into a fresh conversation', () => {
    expect(residentSkill([])).toBeNull()
    expect(residentSkill([message('user', 'hello')])).toBeNull()
  })

  it('offers the skill the last reply used', () => {
    expect(residentSkill([message('user', 'weather in Berlin?'), answer('14°C', matched)])).toEqual({
      name: 'weather',
      carried: 0,
    })
  })

  it('counts the turns it has been carried without matching again', () => {
    const transcript = [
      message('user', 'weather in Berlin?'),
      answer('14°C', matched),
      message('user', 'and in Lisbon?'),
      answer('19°C', carried),
      message('user', 'and tomorrow?'),
      answer('Showers', carried),
    ]

    expect(residentSkill(transcript)).toEqual({ name: 'weather', carried: 2 })
  })

  it('resets the count when the skill matched outright again', () => {
    const transcript = [
      message('user', 'and in Lisbon?'),
      answer('19°C', carried),
      message('user', 'what is the weather in Rome?'),
      answer('21°C', matched),
    ]

    expect(residentSkill(transcript)).toEqual({ name: 'weather', carried: 0 })
  })

  it('forgets a skill the newest reply did not use', () => {
    const transcript = [message('user', 'weather?'), answer('14°C', matched), answer('A poem')]

    // The reply in between routed to nothing, which is itself the eviction.
    expect(residentSkill(transcript)).toBeNull()
  })

  it('is read off the transcript, so rewinding a rerun rewinds it too', () => {
    const transcript = [
      message('user', 'weather in Berlin?'),
      answer('14°C', matched),
      message('user', 'and in Lisbon?'),
      answer('19°C', carried),
    ]
    const rewound = rewindToLastPrompt(transcript) ?? []

    // A counter kept to one side would still be carrying the turn just discarded,
    // and the rerun would route differently from the run it replaces.
    expect(residentSkill(rewound)).toEqual({ name: 'weather', carried: 0 })
  })
})

/**
 * Only the part that does not need the model. Draining the queue runs a turn,
 * which needs weights on a GPU — `verify-in-browser` is where that is checked.
 */
describe('queued follow-ups', () => {
  afterEach(() =>
    useChatStore.setState({ status: 'idle', busy: false, queued: [], messages: [], online: true }),
  )

  it('holds a message typed during a reply instead of dropping it', async () => {
    useChatStore.setState({ status: 'ready', busy: true })

    await useChatStore.getState().send('and in Lisbon?')

    expect(useChatStore.getState().queued).toEqual(['and in Lisbon?'])
    // The transcript is untouched: the question has not been asked yet.
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('keeps the order they were typed in', async () => {
    useChatStore.setState({ status: 'ready', busy: true })
    const { send } = useChatStore.getState()

    await send('first')
    await send('second')

    expect(useChatStore.getState().queued).toEqual(['first', 'second'])
  })

  it('queues nothing while the model is still being installed', async () => {
    useChatStore.setState({ status: 'loading', busy: true })

    await useChatStore.getState().send('too early')

    expect(useChatStore.getState().queued).toEqual([])
  })

  it('asks nothing without a connection, and holds nothing back either', async () => {
    // Offline the tools are gone, so an answer could only come from what the
    // model memorised, unchecked. The question stays in the composer instead of
    // waiting in a queue nothing is going to drain.
    useChatStore.setState({ status: 'ready', busy: false, online: false })

    await useChatStore.getState().send('what happened today?')

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().queued).toEqual([])
  })

  it('drops the queue when the running reply is interrupted', () => {
    useChatStore.setState({ status: 'ready', busy: false, queued: ['no longer relevant'] })

    // Not busy, so this reaches no worker — the queue is cleared either way,
    // because stopping is "not now" rather than "next, please".
    useChatStore.getState().stop()

    expect(useChatStore.getState().queued).toEqual([])
  })

  it('starts a new chat with nothing waiting', () => {
    useChatStore.setState({ status: 'ready', queued: ['leftover'] })

    useChatStore.getState().clear()

    expect(useChatStore.getState().queued).toEqual([])
  })

  it('takes one back out, leaving the rest in order', () => {
    useChatStore.setState({ queued: ['first', 'second', 'third'] })

    useChatStore.getState().unqueue('second')

    expect(useChatStore.getState().queued).toEqual(['first', 'third'])
  })

  it('removes by what was typed, so a turn finishing mid-click cannot misfire', () => {
    useChatStore.setState({ queued: ['first', 'second'] })

    // The front of the queue goes when a turn ends; an index captured at render
    // time would now point at the wrong question.
    useChatStore.setState({ queued: ['second'] })
    useChatStore.getState().unqueue('second')

    expect(useChatStore.getState().queued).toEqual([])
  })

  it('has nothing to remove for something already answered', () => {
    useChatStore.setState({ queued: ['still waiting'] })

    useChatStore.getState().unqueue('long gone')

    expect(useChatStore.getState().queued).toEqual(['still waiting'])
  })
})
