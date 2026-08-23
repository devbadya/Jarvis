import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '@/llm/config'
import { builtinTools } from '@/tools/builtins'
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

  it('ignores tools the skill names but the app does not have', () => {
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

    // A skill referring to an MCP tool that is not connected should degrade to
    // no tools rather than crash the turn.
    expect(activate('trigger', [missing], builtinTools)?.tools).toEqual([])
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
  ])('routes %j to %s', (prompt, expected) => {
    expect(selectSkill(prompt, skills)?.name).toBe(expected)
  })

  it.each([
    'Write a two-line rhyme about rain.',
    'What is the capital of France?',
    'What is my favourite colour?',
  ])('leaves %j to the model', (prompt) => {
    // Firing a tool-shaped skill on plain conversation is the failure mode
    // that makes a small model reach for tools it does not need.
    expect(selectSkill(prompt, skills)).toBeNull()
  })
})
