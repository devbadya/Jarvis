import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '@/llm/config'
import { builtinTools } from '@/tools/builtins'
import { activate, composeTurns } from './activate'
import { loadCatalog, parseSkillEntry } from './load'
import { MAX_SKILL_CONTEXT_CHARS, type SkillEntry } from './types'

function entry(source: string): SkillEntry {
  return parseSkillEntry(source, 'test/SKILL.md')
}

const calculator = entry(`---
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

const chat = entry(`---
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

const catalog = [calculator, chat]

describe('activate', () => {
  it('loads nothing when nothing routes', () => {
    expect(activate('unrelated text', catalog, builtinTools).activation).toBeNull()
  })

  it('materialises only the skill that won', () => {
    const broken = entry(`---
name: broken-skill
description: A description.
jarvis:
  triggers:
    - 'never matches this turn'
  exemplars:
    - user: Missing its result
      steps:
        - tool: calculator
          arguments: { expression: 1 + 1 }
      answer: Two.
---
Body.`)

    // The broken skill sits in the catalogue with a body that cannot parse. That
    // it does not throw is the proof that its body was never read: routing only
    // ever touched the frontmatter.
    expect(activate('add these', [calculator, broken], builtinTools).activation?.skill.name).toBe(
      'calculator-skill',
    )
    expect(() => broken.load()).toThrow(/"result"/)
  })

  it('narrows the tool list to what the skill declares', () => {
    const { activation } = activate('add these', catalog, builtinTools)

    expect(activation?.tools.map((tool) => tool.schema.function.name)).toEqual(['calculator'])
  })

  it('leaves the tool list alone for a skill that declares none', () => {
    const { activation } = activate('hello', catalog, builtinTools)

    expect(activation?.tools).toHaveLength(builtinTools.length)
  })

  it('ignores tools the skill names but the app does not have', () => {
    const missing = entry(`---
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
    expect(activate('trigger', [missing], builtinTools).activation?.tools).toEqual([])
  })

  it('reports how the skill was found', () => {
    expect(activate('add these', catalog, builtinTools).activation?.reason).toBe('trigger')
  })

  it('hands the memory back for the next turn', () => {
    expect(activate('add these', catalog, builtinTools).memory).toEqual({
      name: 'calculator-skill',
      carried: 0,
    })
  })
})

describe('the shipped skills', () => {
  const shipped = loadCatalog()

  it('offers a weather question one tool and no choice about it', () => {
    const { activation } = activate("What's the weather in Berlin?", shipped, builtinTools)

    expect(activation?.tools.map((tool) => tool.schema.function.name)).toEqual(['weather'])
  })

  it('leaves the full tool list to a turn no skill routed', () => {
    const { activation } = activate('What is the capital of France?', shipped, builtinTools)

    expect(activation).toBeNull()
  })
})

describe('the context budget', () => {
  function exemplar(index: number, size: number): string {
    return `    - user: Question ${index}
      steps:
        - tool: calculator
          arguments:
            expression: ${'1 + '.repeat(size)}1
          result: ${'x'.repeat(size)}
      answer: Answer ${index}.`
  }

  it('drops the exemplars that do not fit', () => {
    const greedy = entry(`---
name: greedy
description: A description.
jarvis:
  tools:
    - calculator
  triggers:
    - 'trigger'
  exemplars:
${[0, 1, 2].map((index) => exemplar(index, MAX_SKILL_CONTEXT_CHARS / 2)).join('\n')}
---
Body.`)

    const { activation } = activate('trigger', [greedy], builtinTools)

    expect(greedy.load().exemplars).toHaveLength(3)
    expect(activation?.exemplars).toHaveLength(1)
  })

  it('keeps the first exemplar whatever it costs', () => {
    const huge = entry(`---
name: huge
description: A description.
jarvis:
  tools:
    - calculator
  triggers:
    - 'trigger'
  exemplars:
${exemplar(0, MAX_SKILL_CONTEXT_CHARS * 2)}
---
Body.`)

    // A skill with no worked example left is prose, which is the thing measured
    // not to work at this model size.
    expect(activate('trigger', [huge], builtinTools).activation?.exemplars).toHaveLength(1)
  })

  it('leaves a skill inside the budget alone', () => {
    const { activation } = activate('add these', catalog, builtinTools)

    expect(activation?.exemplars).toEqual(calculator.load().exemplars)
  })
})

describe('composeTurns', () => {
  const history = [{ role: 'user' as const, content: 'What is 2 + 2?' }]

  it('returns the bare system prompt when no skill fired', () => {
    expect(composeTurns(history, null)).toEqual([{ role: 'system', content: SYSTEM_PROMPT }, ...history])
  })

  it('expands an exemplar into user, tool-call, tool-result and answer turns', () => {
    const { activation } = activate('add these', catalog, builtinTools)
    const turns = composeTurns(history, activation)

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
    const { activation } = activate('hello', catalog, builtinTools)

    expect(composeTurns(history, activation).map((turn) => turn.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
  })

  it('appends the skill guidance to the system prompt', () => {
    const { activation } = activate('add these', catalog, builtinTools)

    expect(composeTurns(history, activation)[0]?.content).toBe(`${SYSTEM_PROMPT}\n\nUse the calculator.`)
  })

  it('sends only the exemplars that fit, not the ones the budget dropped', () => {
    const { activation } = activate('add these', catalog, builtinTools)
    const trimmed = activation ? { ...activation, exemplars: [] } : null

    expect(composeTurns(history, trimmed).map((turn) => turn.role)).toEqual(['system', 'user'])
  })

  it('keeps the real history last, nearest the model output', () => {
    const { activation } = activate('add these', catalog, builtinTools)

    expect(composeTurns(history, activation).at(-1)).toEqual(history[0])
  })
})
