import { describe, expect, it } from 'vitest'
import { parseSkillEntry } from './load'
import { search } from './retrieve'
import type { SkillEntry } from './types'

function entry(name: string, frontmatter: string): SkillEntry {
  return parseSkillEntry(
    `---
name: ${name}
description: A description mentioning temperature and pressure.
jarvis:
${frontmatter}
---
Body.`,
    `${name}/SKILL.md`,
  )
}

const weather = entry(
  'weather',
  `  keywords:
    - weather
    - temperature outside
    - wetter`,
)

const arithmetic = entry(
  'arithmetic',
  `  keywords:
    - calculate
    - percent of`,
)

function names(message: string, catalog: SkillEntry[]): string[] {
  return search(message, catalog).map((hit) => hit.entry.name)
}

describe('search', () => {
  const catalog = [weather, arithmetic]

  it('finds a skill by a keyword the triggers never anticipated', () => {
    expect(names('any idea about the wetter in Berlin', catalog)).toEqual(['weather'])
  })

  it('finds nothing for a message no keyword covers', () => {
    // The common case, and the right one: most messages are not a job for a
    // skill, and firing one on plain conversation makes the model reach for
    // tools it does not need.
    expect(names('write me a poem about the sea', catalog)).toEqual([])
  })

  it('requires a multi-word keyword to match as a phrase', () => {
    // The failure this design exists to avoid: `temperature` on its own also
    // means the one water boils at.
    expect(names('what temperature does water boil at', catalog)).toEqual([])
    expect(names('what is the temperature outside', catalog)).toEqual(['weather'])
  })

  it('ignores the words between a phrase and nothing else', () => {
    expect(names('is the weather any good', catalog)).toEqual(['weather'])
  })

  it('reports what matched, so a decision can be explained', () => {
    expect(search('calculate 20 percent of 80', catalog)[0]?.matched).toContain('percent of')
  })

  it('ranks the skill with more to say about the message first', () => {
    const both = 'calculate the weather'
    expect(names(both, catalog)).toHaveLength(2)
  })

  it('does not match a skill on its own description by default', () => {
    // Both descriptions mention temperature; neither is written to be matched.
    expect(names('temperature and pressure', catalog)).toEqual([])
  })

  it('falls back to the description only for a skill with no keywords', () => {
    const bare = entry('bare', '  triggers:\n    - never')

    expect(names('temperature and pressure', [bare])).toEqual(['bare'])
  })

  it('needs two description terms before trusting prose nobody curated', () => {
    const bare = entry('bare', '  triggers:\n    - never')

    expect(names('temperature', [bare])).toEqual([])
  })

  it('has nothing to search for in an empty message', () => {
    expect(names('   ', catalog)).toEqual([])
  })
})
