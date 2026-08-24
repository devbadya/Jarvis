import { create } from 'zustand'
import { runAgent } from '@/agent/loop'
import { LlmClient } from '@/llm/client'
import type { ChatTurn, LoadProgress } from '@/llm/protocol'
import { MODEL_ID, MODEL_WEIGHTS_FILE } from '@/llm/config'
import {
  deleteModel,
  getStorageStatus,
  requestPersistence,
  EMPTY_STORAGE_STATUS,
  type StorageStatus,
} from '@/lib/storage'
import { createBuiltinTools } from '@/tools/builtins'
import { loadMcpTools, type McpServerConfig } from '@/tools/mcp'
import type { Tool } from '@/tools/types'
import { DEFAULT_WEB_ACCESS, normalizeWebAccess, type WebAccessConfig } from '@/tools/web'
import { activate, composeTurns } from '@/skills/activate'
import { loadCatalog } from '@/skills/load'
import type { SkillMemory } from '@/skills/route'
import type { Message, ToolCall } from '@/types'

const MCP_STORAGE_KEY = 'jarvis.mcp-servers'
const WEB_ACCESS_STORAGE_KEY = 'jarvis.web-access'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ChatState {
  status: ModelStatus
  loadMessage: string
  loadProgress: LoadProgress[]
  error: string | null

  messages: Message[]
  busy: boolean

  tools: Tool[]
  mcpServers: McpServerConfig[]
  mcpTools: Tool[]
  mcpFailures: { id: string; message: string }[]
  webAccess: WebAccessConfig

  storage: StorageStatus

  initialize: () => Promise<void>
  refreshStorage: () => Promise<void>
  removeModel: () => Promise<void>
  send: (text: string) => Promise<void>
  retry: () => Promise<void>
  stop: () => void
  clear: () => void
  setMcpServers: (servers: McpServerConfig[]) => Promise<void>
  setWebAccess: (config: WebAccessConfig) => void
}

function readStoredServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as McpServerConfig[]) : []
  } catch {
    return []
  }
}

function readStoredWebAccess(): WebAccessConfig {
  try {
    const raw = localStorage.getItem(WEB_ACCESS_STORAGE_KEY)
    return normalizeWebAccess(raw ? (JSON.parse(raw) as Partial<WebAccessConfig>) : {})
  } catch {
    return DEFAULT_WEB_ACCESS
  }
}

function composeTools(webAccess: WebAccessConfig, mcpTools: Tool[]): Tool[] {
  return [...createBuiltinTools(webAccess), ...mcpTools]
}

let client: LlmClient | null = null

/**
 * Exported so the eval harness can drive the same loaded model rather than
 * spawning a second worker and paying for another 448 MB of weights.
 */
export function getClient(): LlmClient {
  client ??= new LlmClient()
  return client
}

/**
 * Frontmatter only: the catalogue is what routing reads, and no part of it ever
 * reaches the prompt. A skill's body is parsed when that skill wins a turn.
 */
const catalog = loadCatalog()

/** Only user-visible turns go back to the model; reasoning is intentionally dropped. */
function toHistory(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && !message.content) continue
    turns.push({ role: message.role, content: message.content })
  }
  return turns
}

function createMessage(role: Message['role'], content = ''): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() }
}

/**
 * The skill left resident by the replies so far, read back off the transcript.
 *
 * Kept here rather than in a field of its own so that it cannot disagree with
 * the conversation: rerunning a turn rewinds the transcript, and a counter held
 * to one side would still be carrying the turn it just discarded.
 */
export function residentSkill(messages: Message[]): SkillMemory | null {
  const replies = messages.filter((message) => message.role === 'assistant')

  // The newest reply decides. A reply that used no skill is not a turn to look
  // past for one that did: the router already evicted it there.
  const last = replies.at(-1)?.skill
  if (!last) return null

  let carried = 0
  for (const reply of replies.toReversed()) {
    if (reply.skill?.name !== last.name || reply.skill.reason !== 'carried-over') break
    carried += 1
  }
  return { name: last.name, carried }
}

/**
 * The transcript as it stood when the last request was made. Rerunning has to
 * replace the reply rather than append a second one: both would be sent back as
 * history, and the model would answer a question it had already answered twice.
 *
 * Null when there is nothing to rerun.
 */
export function rewindToLastPrompt(messages: Message[]): Message[] | null {
  const lastPrompt = messages.findLastIndex((message) => message.role === 'user')
  return lastPrompt === -1 ? null : messages.slice(0, lastPrompt + 1)
}

const initialWebAccess = readStoredWebAccess()

export const useChatStore = create<ChatState>((set, get) => {
  /**
   * Answers whatever user turn the transcript currently ends with. `send` and
   * `retry` differ only in how they get there, so the generation itself lives
   * here rather than being written twice and drifting apart.
   */
  const runTurn = async (): Promise<void> => {
    const history = get().messages
    const prompt = history.at(-1)
    if (prompt?.role !== 'user') return

    const assistant: Message = { ...createMessage('assistant'), streaming: true, toolCalls: [] }
    set({ messages: [...history, assistant], busy: true, error: null })

    const patch = (update: (message: Message) => Message): void => {
      set((state) => ({
        messages: state.messages.map((message) => (message.id === assistant.id ? update(message) : message)),
      }))
    }

    // Routed on this turn's text, with the previous turn's skill available for a
    // follow-up that states nothing of its own. A skill is never latched: it is
    // carried only while the router keeps choosing to, and for a bounded number
    // of turns.
    const { activation } = activate(prompt.content, catalog, get().tools, residentSkill(history))
    if (activation) {
      const { skill, reason, matched } = activation
      patch((message) => ({ ...message, skill: { name: skill.name, reason, matched } }))
    }

    try {
      const result = await runAgent(
        getClient(),
        composeTurns(toHistory(history), activation),
        activation?.tools ?? get().tools,
        {
          onPartial: ({ content, reasoning }) => patch((message) => ({ ...message, content, reasoning })),
          onToolStart: (call) =>
            patch((message) => ({
              ...message,
              toolCalls: [
                ...(message.toolCalls ?? []),
                {
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                  status: 'running',
                } satisfies ToolCall,
              ],
            })),
          onToolEnd: (id, outcome) =>
            patch((message) => ({
              ...message,
              toolCalls: (message.toolCalls ?? []).map((call) =>
                call.id === id ? { ...call, status: outcome.error ? 'error' : 'done', ...outcome } : call,
              ),
            })),
          onRoundEnd: ({ content, reasoning }) => patch((message) => ({ ...message, content, reasoning })),
          // The draft is about to be overwritten by the corrected answer, so
          // record what was wrong with it before the tokens start replacing it.
          onCorrection: (found) => patch((message) => ({ ...message, review: { found, corrected: false } })),
        },
        activation?.strategy ? { strategy: activation.strategy } : {},
      )

      patch((message) => ({
        ...message,
        content: result.content,
        reasoning: result.reasoning,
        stats: result.stats,
        ...(result.review ? { review: result.review } : {}),
        streaming: false,
      }))
    } catch (error) {
      // The failure goes in its own field. Writing it into `content` made it
      // indistinguishable from an answer, and threw away whatever had streamed.
      const message = error instanceof Error ? error.message : String(error)
      patch((current) => ({ ...current, streaming: false, error: message }))
      set({ error: message })
    } finally {
      set({ busy: false })
    }
  }

  return {
    status: 'idle',
    loadMessage: '',
    loadProgress: [],
    error: null,
    messages: [],
    busy: false,
    tools: composeTools(initialWebAccess, []),
    mcpServers: readStoredServers(),
    mcpTools: [],
    mcpFailures: [],
    webAccess: initialWebAccess,
    storage: EMPTY_STORAGE_STATUS,

    async initialize() {
      if (get().status === 'loading' || get().status === 'ready') return
      set({ status: 'loading', error: null, loadMessage: 'Requesting persistent storage' })

      // Ask before downloading: weights fetched into best-effort storage can be
      // evicted, and re-downloading 448 MB is exactly what installing should avoid.
      await requestPersistence()

      try {
        set({ loadMessage: 'Starting the inference worker' })
        await getClient().load({
          onStatus: (loadMessage) => set({ loadMessage }),
          onProgress: (loadProgress) => set({ loadProgress }),
        })
        set({ status: 'ready', loadMessage: '', loadProgress: [] })
        void get().refreshStorage()
        await get().setMcpServers(get().mcpServers)
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        // Whatever did arrive is a resume point, and the gate offers to continue
        // from it — so the figure it shows has to be the one after the failure.
        void get().refreshStorage()
      }
    },

    async refreshStorage() {
      set({ storage: await getStorageStatus(MODEL_ID, MODEL_WEIGHTS_FILE) })
    },

    async removeModel() {
      await deleteModel(MODEL_ID)
      await get().refreshStorage()
    },

    async setMcpServers(servers) {
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers))
      set({ mcpServers: servers })
      if (servers.length === 0) {
        set({ mcpTools: [], tools: composeTools(get().webAccess, []), mcpFailures: [] })
        return
      }
      const { tools, failures } = await loadMcpTools(servers)
      set({ mcpTools: tools, tools: composeTools(get().webAccess, tools), mcpFailures: failures })
    },

    setWebAccess(config) {
      localStorage.setItem(WEB_ACCESS_STORAGE_KEY, JSON.stringify(config))
      set({ webAccess: config, tools: composeTools(config, get().mcpTools) })
    },

    async send(text) {
      const trimmed = text.trim()
      if (!trimmed || get().busy || get().status !== 'ready') return
      set({ messages: [...get().messages, createMessage('user', trimmed)] })
      await runTurn()
    },

    async retry() {
      if (get().busy || get().status !== 'ready') return
      const rewound = rewindToLastPrompt(get().messages)
      if (!rewound) return
      set({ messages: rewound })
      await runTurn()
    },

    stop() {
      if (get().busy) getClient().interrupt()
    },

    clear() {
      if (get().busy) getClient().interrupt()
      set({ messages: [], error: null })
    },
  }
})
