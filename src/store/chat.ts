import { create } from 'zustand'
import { runAgent } from '@/agent/loop'
import { LlmClient } from '@/llm/client'
import type { ChatTurn, LoadProgress } from '@/llm/protocol'
import { MODEL_ID, SYSTEM_PROMPT } from '@/llm/config'
import {
  deleteModel,
  getStorageStatus,
  requestPersistence,
  EMPTY_STORAGE_STATUS,
  type StorageStatus,
} from '@/lib/storage'
import { builtinTools } from '@/tools/builtins'
import { loadMcpTools, type McpServerConfig } from '@/tools/mcp'
import type { Tool } from '@/tools/types'
import type { Message, ToolCall } from '@/types'

const MCP_STORAGE_KEY = 'jarvis.mcp-servers'

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
  mcpFailures: { id: string; message: string }[]

  storage: StorageStatus

  initialize: () => Promise<void>
  refreshStorage: () => Promise<void>
  removeModel: () => Promise<void>
  send: (text: string) => Promise<void>
  stop: () => void
  clear: () => void
  setMcpServers: (servers: McpServerConfig[]) => Promise<void>
}

function readStoredServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as McpServerConfig[]) : []
  } catch {
    return []
  }
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

/** Only user-visible turns go back to the model; reasoning is intentionally dropped. */
function toTurns(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const message of messages) {
    if (message.role === 'assistant' && !message.content) continue
    turns.push({ role: message.role, content: message.content })
  }
  return turns
}

function createMessage(role: Message['role'], content = ''): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() }
}

export const useChatStore = create<ChatState>((set, get) => ({
  status: 'idle',
  loadMessage: '',
  loadProgress: [],
  error: null,
  messages: [],
  busy: false,
  tools: builtinTools,
  mcpServers: readStoredServers(),
  mcpFailures: [],
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
    }
  },

  async refreshStorage() {
    set({ storage: await getStorageStatus(MODEL_ID) })
  },

  async removeModel() {
    await deleteModel(MODEL_ID)
    await get().refreshStorage()
  },

  async setMcpServers(servers) {
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers))
    set({ mcpServers: servers })
    if (servers.length === 0) {
      set({ tools: builtinTools, mcpFailures: [] })
      return
    }
    const { tools, failures } = await loadMcpTools(servers)
    set({ tools: [...builtinTools, ...tools], mcpFailures: failures })
  },

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().busy || get().status !== 'ready') return

    const user = createMessage('user', trimmed)
    const assistant: Message = { ...createMessage('assistant'), streaming: true, toolCalls: [] }
    const history = [...get().messages, user]
    set({ messages: [...history, assistant], busy: true, error: null })

    const patch = (update: (message: Message) => Message): void => {
      set((state) => ({
        messages: state.messages.map((message) => (message.id === assistant.id ? update(message) : message)),
      }))
    }

    try {
      const result = await runAgent(getClient(), toTurns(history), get().tools, {
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
      })

      patch((message) => ({
        ...message,
        content: result.content,
        reasoning: result.reasoning,
        stats: result.stats,
        streaming: false,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch((current) => ({
        ...current,
        streaming: false,
        content: current.content || `Generation failed: ${message}`,
      }))
      set({ error: message })
    } finally {
      set({ busy: false })
    }
  },

  stop() {
    if (get().busy) getClient().interrupt()
  },

  clear() {
    if (get().busy) getClient().interrupt()
    set({ messages: [], error: null })
  },
}))
