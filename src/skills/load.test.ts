import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '@/agent/parse'
import { renderToolCall } from '@/agent/render'
import { builtinTools } from '@/tools/builtins'
import { loadCatalog, parseSkill, parseSkillEntry } from './load'
import { MAX_GUIDANCE_CHARS, MAX_SKILL_CONTEXT_CHARS } from './types'

const MINIMAL = `---
name: example
description: Does a thing. Use when a thing is needed.
---

Body.
`

describe('parseSkill', () => {
  it('reads the spec fields and treats the body as guidance', () => {
    const skill = parseSkill(MINIMAL, 'example/SKILL.md')

    expect(skill.name).toBe('example')
    expect(skill.guidance).toBe('Body.')
    // Absent extension block means no restrictions rather than no skill.
    expect(skill.tools).toEqual([])
    expect(skill.priority).toBe(0)
  })

  it('compiles triggers case-insensitively', () => {
    const source = `---
name: example
description: A description.
jarvis:
  triggers:
    - 'hello world'
---
Body.`

    const [trigger] = parseSkill(source, 'example/SKILL.md').triggers
    expect(trigger?.test('Say HELLO WORLD to me')).toBe(true)
  })

  it('rejects a body over the guidance budget', () => {
    const source = `---
name: example
description: A description.
---

${'x'.repeat(MAX_GUIDANCE_CHARS + 1)}`

    // Prose at this size is what previously drove tool use down, so an
    // over-long skill has to fail loudly rather than ship.
    expect(() => parseSkill(source, 'example/SKILL.md')).toThrow(/over the \d+ budget/)
  })

  it('rejects a step with no result to learn from', () => {
    const source = `---
name: example
description: A description.
jarvis:
  exemplars:
    - user: Add two numbers
      steps:
        - tool: calculator
          arguments:
            expression: 1 + 1
      answer: Two.
---
Body.`

    expect(() => parseSkill(source, 'example/SKILL.md')).toThrow(/step 1: "result"/)
  })

  it('keeps several steps in order, so a workflow reads as one behaviour', () => {
    const source = `---
name: example
description: A description.
jarvis:
  exemplars:
    - user: What is Arc?
      steps:
        - tool: web_search
          arguments: { query: Arc }
          result: 'results'
        - tool: read_page
          arguments: { url: 'https://arc.net' }
          result: 'page'
      answer: A browser.
---
Body.`

    expect(parseSkill(source, 'example/SKILL.md').exemplars[0]?.steps.map((step) => step.tool)).toEqual([
      'web_search',
      'read_page',
    ])
  })

  it('rejects the superseded single-call format rather than dropping it', () => {
    const source = `---
name: example
description: A description.
jarvis:
  exemplars:
    - user: What is 1 + 1?
      call:
        name: calculator
        arguments: { expression: 1 + 1 }
      result: 1 + 1 = 2
      answer: Two.
---
Body.`

    expect(() => parseSkill(source, 'example/SKILL.md')).toThrow(/no longer supported/)
  })

  it('names the file when frontmatter is missing', () => {
    expect(() => parseSkill('No frontmatter here.', 'broken/SKILL.md')).toThrow(/broken\/SKILL\.md/)
  })

  it('stringifies exemplar arguments, since the wire format is untyped text', () => {
    const source = `---
name: example
description: A description.
jarvis:
  exemplars:
    - user: How many results?
      steps:
        - tool: web_search
          arguments:
            query: cats
            limit: 3
          result: 'ok'
      answer: Three.
---
Body.`

    expect(parseSkill(source, 'example/SKILL.md').exemplars[0]?.steps[0]?.arguments).toEqual({
      query: 'cats',
      limit: '3',
    })
  })

  it('reads the keywords the router searches', () => {
    const source = `---
name: example
description: A description.
jarvis:
  keywords:
    - wetter
    - temperature outside
---
Body.`

    expect(parseSkill(source, 'example/SKILL.md').keywords).toEqual(['wetter', 'temperature outside'])
  })

  it('rejects a keyword made only of stopwords', () => {
    const source = `---
name: example
description: A description.
jarvis:
  keywords:
    - what is
---
Body.`

    // Scoring ignores stopwords, so this would match nearly every question with
    // a score of zero: a skill routed to on no evidence at all.
    expect(() => parseSkill(source, 'example/SKILL.md')).toThrow(/only stopwords/)
  })
})

describe('parseSkillEntry', () => {
  const source = `---
name: example
description: A description.
jarvis:
  keywords:
    - wetter
  triggers:
    - 'hello'
  exemplars:
    - user: Missing its result
      steps:
        - tool: calculator
          arguments: { expression: 1 + 1 }
      answer: Two.
---
Body.`

  it('reads what routing needs without reading the body', () => {
    const skillEntry = parseSkillEntry(source, 'example/SKILL.md')

    // The exemplar in this source cannot parse. That the entry exists at all is
    // the proof that routing costs only the frontmatter.
    expect(skillEntry.name).toBe('example')
    expect(skillEntry.keywords).toEqual(['wetter'])
    expect(skillEntry.triggers[0]?.test('HELLO')).toBe(true)
    expect(() => skillEntry.load()).toThrow(/"result"/)
  })

  it('still refuses an over-long body while the app is starting', () => {
    const overLong = `---
name: example
description: A description.
---

${'x'.repeat(MAX_GUIDANCE_CHARS + 1)}`

    // One length comparison, and worth doing eagerly: a skill this broken has to
    // fail at load rather than in the middle of somebody's conversation.
    expect(() => parseSkillEntry(overLong, 'example/SKILL.md')).toThrow(/over the \d+ budget/)
  })

  it('parses the body once, however often it is asked for', () => {
    const good = parseSkillEntry(
      `---
name: example
description: A description.
---
Body.`,
      'example/SKILL.md',
    )

    expect(good.load()).toBe(good.load())
  })
})

describe('the shipped skills', () => {
  const skills = loadCatalog().map((entry) => entry.load())
  const builtinNames = new Set(builtinTools.map((tool) => tool.schema.function.name))

  it('all load', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  it('are ordered by descending priority', () => {
    const priorities = skills.map((skill) => skill.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a))
  })

  it.each(skills.map((skill) => [skill.name, skill] as const))('%s declares real tools', (_name, skill) => {
    for (const tool of skill.tools) expect(builtinNames).toContain(tool)
  })

  it.each(skills.map((skill) => [skill.name, skill] as const))(
    '%s only demonstrates tools it declares',
    (_name, skill) => {
      for (const exemplar of skill.exemplars) {
        for (const step of exemplar.steps) expect(skill.tools).toContain(step.tool)
      }
    },
  )

  it.each(skills.map((skill) => [skill.name, skill] as const))(
    '%s produces exemplars the parser reads back',
    (_name, skill) => {
      // An exemplar that does not survive a round trip is teaching the model a
      // format the agent loop would then fail to parse.
      for (const exemplar of skill.exemplars) {
        for (const step of exemplar.steps) {
          const markup = renderToolCall(step.tool, step.arguments)
          expect(parseModelOutput(markup).toolCalls).toEqual([{ name: step.tool, arguments: step.arguments }])
        }
      }
    },
  )

  it.each(skills.map((skill) => [skill.name, skill] as const))(
    '%s has at least one trigger',
    (_name, skill) => {
      expect(skill.triggers.length).toBeGreaterThan(0)
    },
  )

  it.each(skills.map((skill) => [skill.name, skill] as const))(
    '%s fits the context budget without being trimmed',
    (_name, skill) => {
      const cost =
        skill.guidance.length +
        skill.exemplars.reduce(
          (total, exemplar) =>
            total +
            exemplar.user.length +
            exemplar.answer.length +
            exemplar.steps.reduce(
              (steps, step) => steps + renderToolCall(step.tool, step.arguments).length + step.result.length,
              0,
            ),
          0,
        )

      // The budget exists for the skill somebody writes later. If it ever starts
      // trimming what ships today, that is a behaviour change nobody asked for.
      expect(cost).toBeLessThanOrEqual(MAX_SKILL_CONTEXT_CHARS)
    },
  )
})
