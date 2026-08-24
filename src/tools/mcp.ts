import { defineTool, type Tool } from './types'
import type { ToolSchema } from '@/types'

/**
 * Minimal Model Context Protocol client speaking the Streamable HTTP transport.
 *
 * Only the handful of methods the agent needs is implemented (initialize,
 * tools/list, tools/call). The server must send permissive CORS headers, since
 * these calls originate from the browser with no proxy in between.
 */

const PROTOCOL_VERSION = '2025-06-18'

interface JsonRpcResponse<T> {
  jsonrpc: '2.0'
  id?: number | string
  result?: T
  error?: { code: number; message: string }
}

interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: ToolSchema['function']['parameters']
}

interface McpContentBlock {
  type: string
  text?: string
}

export interface McpServerConfig {
  /** Short prefix that keeps tool names unique across servers. */
  id: string
  url: string
  headers?: Record<string, string>
}

/**
 * The transport is `fetch`, so anything without an http(s) scheme cannot work.
 * Worth answering before a connection attempt: the failure otherwise arrives as
 * a browser fetch message, several seconds later, in a panel already scrolled
 * past.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export class McpClient {
  private sessionId: string | null = null
  private nextId = 1
  private readonly config: McpServerConfig

  constructor(config: McpServerConfig) {
    this.config = config
  }

  private async rpc<T>(method: string, params?: Record<string, unknown>, notify = false): Promise<T | null> {
    const body: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (params) body.params = params
    if (!notify) body.id = this.nextId++

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
    })

    const session = response.headers.get('mcp-session-id')
    if (session) this.sessionId = session

    if (!response.ok) {
      throw new Error(`MCP server "${this.config.id}" returned ${response.status}`)
    }
    if (notify || response.status === 202) return null

    const payload = await this.parseBody<T>(response)
    if (payload.error) throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`)
    return payload.result ?? null
  }

  /** The transport may answer with plain JSON or with a one-shot SSE stream. */
  private async parseBody<T>(response: Response): Promise<JsonRpcResponse<T>> {
    const text = await response.text()
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      return JSON.parse(text) as JsonRpcResponse<T>
    }
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (data) return JSON.parse(data) as JsonRpcResponse<T>
      }
    }
    throw new Error('MCP server sent an event stream with no data payload')
  }

  async connect(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'jarvis', version: '0.1.0' },
    })
    await this.rpc('notifications/initialized', undefined, true)
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.rpc<{ tools: McpToolDefinition[] }>('tools/list')
    return (result?.tools ?? []).map((definition) =>
      defineTool(
        `${this.config.id}__${definition.name}`,
        definition.description ?? `Tool "${definition.name}" from MCP server "${this.config.id}"`,
        definition.inputSchema ?? { type: 'object', properties: {} },
        (args) => this.callTool(definition.name, args),
      ),
    )
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc<{ content?: McpContentBlock[]; isError?: boolean }>('tools/call', {
      name,
      arguments: args,
    })
    const text = (result?.content ?? [])
      .map((block) => block.text ?? `[${block.type}]`)
      .join('\n')
      .trim()
    if (result?.isError) throw new Error(text || 'MCP tool reported an error')
    return text || '(empty result)'
  }
}

/** Connects every configured server, skipping the ones that fail so one bad URL cannot break startup. */
export async function loadMcpTools(
  servers: McpServerConfig[],
): Promise<{ tools: Tool[]; failures: { id: string; message: string }[] }> {
  const tools: Tool[] = []
  const failures: { id: string; message: string }[] = []

  await Promise.all(
    servers.map(async (config) => {
      try {
        const client = new McpClient(config)
        await client.connect()
        tools.push(...(await client.listTools()))
      } catch (error) {
        failures.push({ id: config.id, message: error instanceof Error ? error.message : String(error) })
      }
    }),
  )

  return { tools, failures }
}
