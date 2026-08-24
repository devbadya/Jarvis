import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '@/llm/config'
import { builtinTools, createBuiltinTools } from '@/tools/builtins'
import { DEFAULT_WEB_ACCESS } from '@/tools/web'
import { activate, composeTurns, selectSkill } from './activate'
import { loadSkills, parseSkill } from './load'
import type { Skill } from './types'

function skill(overrides: string): Skill {
  return parseSkill(overrides, 'test/SKILL.md')
}

const calculator = skill(`---
name: calculator-skill
description: A description.
jarvis:
  priority: 10
  tools:
    - calculator
  triggers:
    - 'add'
  exemplars:
    - user: What is 1 + 1?
      steps:
        - tool: calculator
          arguments:
            expression: 1 + 1
          result: 1 + 1 = 2
      answer: Two.
---
Use the calculator.`)

const chat = skill(`---
name: chat-skill
description: A description.
jarvis:
  priority: 1
  triggers:
    - 'hello'
  exemplars:
    - user: Hi there
      answer: Hello.
---
Answer directly.`)

describe('selectSkill', () => {
  it('returns null when nothing matches', () => {
    expect(selectSkill('unrelated text', [calculator, chat])).toBeNull()
  })

  it('prefers the higher-priority skill when both match', () => {
    // Load order is by descending priority, which is what makes this stable.
    const skills = [calculator, chat]
    expect(selectSkill('hello, please add these', skills)?.name).toBe('calculator-skill')
  })
})

describe('activate', () => {
  it('narrows the tool list to what the skill declares', () => {
    const activation = activate('add these', [calculator], builtinTools)

    expect(activation?.tools.map((tool) => tool.schema.function.name)).toEqual(['calculator'])
  })

  it('leaves the tool list alone for a skill that declares none', () => {
    const activation = activate('hello', [chat], builtinTools)

    expect(activation?.tools).toHaveLength(builtinTools.length)
  })

  it('stands aside when every tool the skill names is missing', () => {
    const missing = skill(`---
name: missing
description: A description.
jarvis:
  tools:
    - no_such_tool
  triggers:
    - 'trigger'
---
Body.`)

    // Its exemplars are worked calls to a tool that is not there — an MCP
    // server that failed to connect, or memory switched off. Firing it would
    // teach the model to ask for the tool and spend the round being told there
    // is no such thing.
    expect(activate('trigger', [missing], builtinTools)).toBeNull()
  })

  it('still fires a skill that has some of what it named', () => {
    const partial = skill(`---
name: partial
description: A description.
jarvis:
  tools:
    - calculator
    - no_such_tool
  triggers:
    - 'trigger'
---
Body.`)

    expect(
      activate('trigger', [partial], builtinTools)?.tools.map((tool) => tool.schema.function.name),
    ).toEqual(['calculator'])
  })

  it('lets the next skill answer when the best match cannot', () => {
    const unusable = skill(`---
name: unusable
description: A description.
jarvis:
  priority: 50
  tools:
    - no_such_tool
  triggers:
    - 'add'
---
Body.`)

    expect(activate('add these', [unusable, calculator], builtinTools)?.skill.name).toBe('calculator-skill')
  })
})

describe('composeTurns', () => {
  const history = [{ role: 'user' as const, content: 'What is 2 + 2?' }]

  it('returns the bare system prompt when no skill fired', () => {
    expect(composeTurns(history, null)).toEqual([{ role: 'system', content: SYSTEM_PROMPT }, ...history])
  })

  it('expands an exemplar into user, tool-call, tool-result and answer turns', () => {
    const turns = composeTurns(history, activate('add these', [calculator], builtinTools))

    expect(turns.map((turn) => turn.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ])
    expect(turns[2]?.content).toBe(
      '<tool_call><function=calculator><parameter=expression>1 + 1</parameter></function></tool_call>',
    )
    expect(turns[3]?.content).toBe('1 + 1 = 2')
  })

  it('omits the tool turns for an exemplar that answers directly', () => {
    const turns = composeTurns(history, activate('hello', [chat], builtinTools))

    expect(turns.map((turn) => turn.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('appends the skill guidance to the system prompt', () => {
    const turns = composeTurns(history, activate('add these', [calculator], builtinTools))

    expect(turns[0]?.content).toBe(`${SYSTEM_PROMPT}\n\nUse the calculator.`)
  })

  it('keeps the real history last, nearest the model output', () => {
    const turns = composeTurns(history, activate('add these', [calculator], builtinTools))

    expect(turns.at(-1)).toEqual(history[0])
  })
})

describe('the shipped skills', () => {
  const skills = loadSkills()

  it.each([
    ['What is 98765 * 4321?', 'arithmetic'],
    ['How much is 18 percent of 2450?', 'arithmetic'],
    ['What year is it right now?', 'current-date'],
    ['Summarise https://example.com/post', 'summarize-url'],
    ['Who is the current secretary-general of the UN?', 'research-question'],
    // The reported failure: a bare project name the model read as a measurement.
    ['What is 1inch?', 'lookup-term'],
    ['what is 1inch', 'lookup-term'],
    ['What is 1inch used for?', 'lookup-term'],
    ['What is Stripe?', 'lookup-term'],
    ["What's Notion?", 'lookup-term'],
    ["What's the weather in Berlin?", 'weather'],
    ['How hot is it in Dubai?', 'weather'],
    ['Is it raining in London?', 'weather'],
    ['Will it rain tomorrow?', 'weather'],
    ['What is the temperature in Oslo?', 'weather'],
    ['Remember that I prefer metric units.', 'memory'],
    ['remember I take my coffee black', 'memory'],
    ['Please remember that my flat has no lift.', 'memory'],
    ['Note that I work Tuesdays.', 'memory'],
    ['Forget that I live in Berlin.', 'memory'],
    ['Forget everything you know about me.', 'memory'],
    ['What do you know about me?', 'memory'],
    ['What do you remember about my flat?', 'memory'],
    ['Clear your memory.', 'memory'],
  ])('routes %j to %s', (prompt, expected) => {
    expect(selectSkill(prompt, skills)?.name).toBe(expected)
  })

  it.each([
    // Both also read as arithmetic, or as a question about today, which own
    // the same words at a lower priority.
    ['Remember that 20% of my income goes to rent.', 'memory'],
    ['Remember that I am in Lisbon today.', 'memory'],
  ])('routes %j to %s rather than to the tool the numbers suggest', (prompt, expected) => {
    expect(selectSkill(prompt, skills)?.name).toBe(expected)
  })

  it.each([
    // Every one of these also reads as a question about the date, which owns
    // the same words at a lower priority.
    ["What's the weather in Tokyo today?", 'weather'],
    ['Is it snowing in Oslo right now?', 'weather'],
    ["What's the forecast for Lisbon this week?", 'weather'],
  ])('routes %j to %s rather than to the clock', (prompt, expected) => {
    expect(selectSkill(prompt, skills)?.name).toBe(expected)
  })

  it('says nothing about memory once the user has switched it off', () => {
    const prompt = 'Remember that I prefer metric units.'
    expect(activate(prompt, skills, builtinTools)?.skill.name).toBe('memory')

    // Its exemplars call a tool that is no longer in the list, so firing it
    // would put the word "remember" in front of someone who asked not to be.
    expect(activate(prompt, skills, createBuiltinTools(DEFAULT_WEB_ACCESS, { memory: false }))).toBeNull()
  })

  it('leaves a linked weather site to summarize-url', () => {
    // `weather` and `forecast` both appear in the URL, and a search would
    // answer about somewhere else entirely.
    expect(selectSkill('Summarise https://weather.com/forecast', skills)?.name).toBe('summarize-url')
  })

  it.each([
    // A digit-bearing token is lookup-term's strongest signal, so these are the
    // prompts most at risk of being stolen from the skill that should own them.
    ['What is 2 to the power of 20?', 'arithmetic'],
    ['What is 98765 * 4321?', 'arithmetic'],
    ['What is the date today?', 'current-date'],
  ])('does not let lookup-term steal %j from %s', (prompt, expected) => {
    expect(selectSkill(prompt, skills)?.name).toBe(expected)
  })

  it.each([
    'Write a two-line rhyme about rain.',
    'What is the capital of France?',
    // Answered from what recall put in the prompt, with no tool round spent.
    'What is my favourite colour?',
    // Physics, not this afternoon: the word alone must not pull in the weather.
    'What temperature does water boil at?',
    // The user's own recall, not the app's: neither is a request to store one.
    "I can't remember the capital of Peru.",
    'How much memory does this model need?',
  ])('leaves %j to the model', (prompt) => {
    // Firing a tool-shaped skill on plain conversation is the failure mode
    // that makes a small model reach for tools it does not need.
    expect(selectSkill(prompt, skills)).toBeNull()
  })
})
