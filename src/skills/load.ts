import { parse as parseYaml } from 'yaml'
import { STRATEGIES } from '@/llm/config'
import { MAX_GUIDANCE_CHARS, type Skill, type SkillExemplar, type SkillStep } from './types'

/**
 * Skills are bundled at build time rather than fetched.
 *
 * A fetch would need the service worker to precache each one to survive going
 * offline, and offline is the whole point of this app. Inlining them costs a few
 * kilobytes and removes the failure mode entirely.
 */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

interface ParsedSkillFile {
  frontmatter: Record<string, unknown>
  body: string
}

function splitFrontmatter(source: string, path: string): ParsedSkillFile {
  const match = FRONTMATTER.exec(source.trim())
  if (!match?.[1]) throw new Error(`${path}: missing YAML frontmatter delimited by ---`)

  const frontmatter = parseYaml(match[1]) as unknown
  if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`)
  }
  return { frontmatter: frontmatter as Record<string, unknown>, body: (match[2] ?? '').trim() }
}

function requireString(value: unknown, path: string, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${path}: "${field}" must be a non-empty string`)
  return value.trim()
}

function stringArray(value: unknown, path: string, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${path}: "${field}" must be a list of strings`)
  }
  return value as string[]
}

function parseSteps(value: unknown, where: string): SkillStep[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${where}: "steps" must be a list`)

  return value.map((entry, index) => {
    const at = `${where}, step ${index + 1}`
    if (typeof entry !== 'object' || entry === null) throw new Error(`${at} must be a mapping`)
    const record = entry as Record<string, unknown>

    const args = record.arguments ?? {}
    if (typeof args !== 'object' || args === null) throw new Error(`${at}: "arguments" must be a mapping`)

    return {
      tool: requireString(record.tool, at, 'tool'),
      // Qwen's tool-call format is untyped text, so everything is stringified
      // here to match what the model will actually be asked to emit.
      arguments: Object.fromEntries(
        Object.entries(args as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      ),
      result: requireString(record.result, at, 'result'),
    }
  })
}

function parseExemplars(value: unknown, path: string): SkillExemplar[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${path}: "exemplars" must be a list`)

  return value.map((entry, index) => {
    const where = `${path}: exemplar ${index + 1}`
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where} must be a mapping`)
    const record = entry as Record<string, unknown>

    // Exemplars once held a single `call`/`result` pair. Ignoring the old keys
    // would drop the tool call silently and leave a skill that teaches nothing.
    for (const legacy of ['call', 'result'] as const) {
      if (record[legacy] !== undefined) {
        throw new Error(`${where}: "${legacy}" is no longer supported — use a "steps" list`)
      }
    }

    return {
      user: requireString(record.user, where, 'user'),
      steps: parseSteps(record.steps, where),
      answer: requireString(record.answer, where, 'answer'),
    }
  })
}

/**
 * Triggers are case-insensitive by default: they match free-form user text, and
 * a skill that only fires on the user's capitalisation is a bug.
 */
function compileTriggers(patterns: string[], path: string): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, 'i')
    } catch (error) {
      throw new Error(`${path}: trigger ${JSON.stringify(pattern)} is not a valid regex — ${String(error)}`)
    }
  })
}

export function parseSkill(source: string, path: string): Skill {
  const { frontmatter, body } = splitFrontmatter(source, path)
  const extension = frontmatter.jarvis
  if (extension !== undefined && (typeof extension !== 'object' || extension === null)) {
    throw new Error(`${path}: "jarvis" must be a mapping`)
  }
  const jarvis = (extension ?? {}) as Record<string, unknown>

  if (body.length > MAX_GUIDANCE_CHARS) {
    throw new Error(
      `${path}: body is ${body.length} characters, over the ${MAX_GUIDANCE_CHARS} budget. ` +
        'Move the detail into an exemplar — prose is close to worthless at this model size.',
    )
  }

  const priority = jarvis.priority
  if (priority !== undefined && typeof priority !== 'number') {
    throw new Error(`${path}: "priority" must be a number`)
  }

  // Checked against the real table rather than cast: an unknown name would
  // otherwise typecheck and then hand the worker an undefined strategy.
  const strategy = jarvis.strategy
  if (strategy !== undefined && (typeof strategy !== 'string' || !(strategy in STRATEGIES))) {
    throw new Error(`${path}: "strategy" must be one of ${Object.keys(STRATEGIES).join(', ')}`)
  }

  return {
    name: requireString(frontmatter.name, path, 'name'),
    description: requireString(frontmatter.description, path, 'description'),
    guidance: body,
    tools: stringArray(jarvis.tools, path, 'tools'),
    triggers: compileTriggers(stringArray(jarvis.triggers, path, 'triggers'), path),
    exemplars: parseExemplars(jarvis.exemplars, path),
    priority: priority ?? 0,
    ...(strategy ? { strategy: strategy as Skill['strategy'] } : {}),
  }
}

const SOURCES = import.meta.glob('./*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** Highest priority first, then by name so the order never depends on the filesystem. */
export function loadSkills(sources: Record<string, string> = SOURCES): Skill[] {
  return Object.entries(sources)
    .map(([path, source]) => parseSkill(source, path))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
}
