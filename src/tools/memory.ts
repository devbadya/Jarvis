import {
  clearMemories,
  deleteMemory,
  findMemories,
  loadMemory,
  saveMemory,
  updateMemory,
} from '@/memory/manage'
import { MEMORY_KINDS, type MemoryRecord } from '@/memory/types'
import { defineTool, type Tool } from './types'

/**
 * One tool with a command argument rather than four tools.
 *
 * Tool-calling accuracy falls as the visible list grows, and `remember`,
 * `recall`, `forget` and `update_memory` would nearly double it for every turn
 * that has nothing to do with memory. Anthropic's memory tool is the same
 * shape — one entry, a `command` field — for the same reason.
 *
 * Reading is the command this is *least* used for: recall is injected into the
 * system prompt by `memory/select.ts` before the model sees the question, so
 * `list` is here for "what do you know about me" and for finding the id of
 * something to change.
 */

/** Beyond this the list stops being an answer and starts being a wall. */
const MAX_LIST_ENTRIES = 20
const MAX_LIST_CHARS = 1200

/**
 * The model reaches for the verb in the user's sentence — `remember`, `forget`,
 * `recall` — far more readily than for the command name in the schema.
 * Accepting both costs one lookup; refusing costs a whole tool round.
 */
const ALIASES: Record<string, string> = {
  add: 'save',
  create: 'save',
  remember: 'save',
  set: 'save',
  store: 'save',
  write: 'save',
  get: 'list',
  read: 'list',
  recall: 'list',
  search: 'list',
  show: 'list',
  view: 'list',
  change: 'update',
  correct: 'update',
  edit: 'update',
  replace: 'update',
  drop: 'delete',
  erase: 'delete',
  forget: 'delete',
  remove: 'delete',
  clear_all: 'clear',
  delete_all: 'clear',
  forget_all: 'clear',
  reset: 'clear',
  wipe: 'clear',
}

const COMMANDS = ['save', 'list', 'update', 'delete', 'clear'] as const

function describe(record: MemoryRecord): string {
  return `[${record.id}] (${record.kind}) ${record.text}`
}

function renderList(records: MemoryRecord[]): string {
  const lines: string[] = []
  let used = 0
  for (const record of records.slice(0, MAX_LIST_ENTRIES)) {
    const line = describe(record)
    if (used + line.length > MAX_LIST_CHARS) break
    lines.push(line)
    used += line.length
  }
  const hidden = records.length - lines.length
  return [
    `${records.length} ${records.length === 1 ? 'memory' : 'memories'}:`,
    ...lines,
    ...(hidden > 0 ? [`…and ${hidden} more.`] : []),
  ].join('\n')
}

/**
 * Turns whatever the model gave — an id, or the words it remembers the memory
 * by — into exactly one record. An ambiguous query is answered with the
 * candidates and their ids rather than a guess: picking one would delete the
 * wrong memory and say it succeeded.
 */
function resolve(records: MemoryRecord[], id: string, query: string, command: string): MemoryRecord {
  if (id) {
    const found = records.find((record) => record.id === id)
    if (!found) throw new Error(`no memory has id ${id} — call memory with command=list to see the ids`)
    return found
  }

  if (!query) throw new Error(`${command} needs an id, or a query naming the memory`)

  const matches = findMemories(records, query)
  if (matches.length === 0) throw new Error(`no memory matches "${query}"`)
  if (matches.length > 1) {
    throw new Error(
      `"${query}" matches ${matches.length} memories — repeat with the id of the one you mean:\n${matches
        .map(describe)
        .join('\n')}`,
    )
  }
  return matches[0] as MemoryRecord
}

export const memory: Tool = defineTool(
  'memory',
  'Remember, look up, correct or delete things about the user that should outlast this conversation. Use when the user asks you to remember or forget something, or asks what you remember about them.',
  {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: `One of: ${COMMANDS.join(', ')}`,
      },
      text: {
        type: 'string',
        description: 'For save and update: the memory, as one short sentence about the user',
      },
      query: {
        type: 'string',
        description: 'Words the memory contains, to find it without an id. For list, update and delete',
      },
      id: { type: 'string', description: 'The id shown in brackets by list' },
      kind: { type: 'string', description: `One of: ${MEMORY_KINDS.join(', ')}. Defaults to fact` },
      confirm: { type: 'string', description: 'Must be yes for clear, which deletes everything' },
    },
    required: ['command'],
  },
  async (args) => {
    const text = String(args.text ?? '').trim()
    const query = String(args.query ?? '').trim()
    const id = String(args.id ?? '').trim()
    const raw = String(args.command ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    const command = ALIASES[raw] ?? raw

    // A call carrying the text and no command can only mean save.
    if (!command && text) return await save(text, args.kind)
    if (!(COMMANDS as readonly string[]).includes(command)) {
      throw new Error(`unknown command "${raw}". Use one of: ${COMMANDS.join(', ')}`)
    }

    if (command === 'save') return await save(text, args.kind)

    const { live } = await loadMemory()

    if (command === 'list') {
      const matching = query ? findMemories(live, query) : live
      if (matching.length === 0) {
        return query ? `Nothing remembered about "${query}".` : 'Nothing remembered about the user yet.'
      }
      return renderList(matching)
    }

    if (command === 'clear') {
      if (
        String(args.confirm ?? '')
          .trim()
          .toLowerCase() !== 'yes'
      ) {
        throw new Error(
          'clear deletes every memory. Only repeat it with confirm=yes if the user asked for exactly that; otherwise delete the one memory they meant.',
        )
      }
        const count = await clearMemories()
        if (count === 0) return 'There was nothing to delete.'
        const noun = count === 1 ? 'the 1 memory' : `all ${count} memories`
        return `Deleted ${noun}. The user can restore them from the Memory panel.`
    }

    const target = resolve(live, id, query, command)

    if (command === 'update') {
      if (!text) throw new Error('update needs the replacement text')
      return `Updated ${describe(await updateMemory(target.id, { text, kind: args.kind ?? target.kind }))}`
    }

    return `Deleted ${describe(await deleteMemory(target.id))}`
  },
)

async function save(text: string, kind: unknown): Promise<string> {
  if (!text) throw new Error('save needs the text to remember')
  const outcome = await saveMemory({ text, kind, source: 'model' })
  const evicted = outcome.evicted ? ' The oldest memory was dropped to make room.' : ''
  return outcome.duplicate
    ? `Already remembered ${describe(outcome.record)}`
    : `Saved ${describe(outcome.record)}${evicted}`
}
