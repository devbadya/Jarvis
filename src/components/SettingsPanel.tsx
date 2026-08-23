import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Badge } from './ui/Badge'
import { useChatStore } from '@/store/chat'
import { webToolsAvailable } from '@/tools/builtins'
import type { McpServerConfig } from '@/tools/mcp'

/**
 * MCP servers are added at runtime rather than baked in, because the useful ones
 * differ per user. Configuration lives in localStorage.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { tools, mcpServers, mcpFailures, setMcpServers } = useChatStore()
  const [id, setId] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const add = async (): Promise<void> => {
    const trimmedId = id.trim()
    const trimmedUrl = url.trim()
    if (!trimmedId || !trimmedUrl) return
    setSaving(true)
    const next: McpServerConfig[] = [
      ...mcpServers.filter((server) => server.id !== trimmedId),
      { id: trimmedId, url: trimmedUrl },
    ]
    await setMcpServers(next)
    setId('')
    setUrl('')
    setSaving(false)
  }

  const remove = async (serverId: string): Promise<void> => {
    await setMcpServers(mcpServers.filter((server) => server.id !== serverId))
  }

  return (
    <aside className="flex w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Tools</h2>
        <Button size="sm" variant="ghost" onPress={onClose}>
          Close
        </Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
          Available to the model ({tools.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <Badge key={tool.schema.function.name}>{tool.schema.function.name}</Badge>
          ))}
        </div>
        {!webToolsAvailable && (
          <p className="text-xs text-muted">
            <code>web_search</code> and <code>read_page</code> are off in this deployment: they need a
            server-side proxy, which a static host does not provide.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">MCP servers</h3>
        <p className="text-xs text-muted">
          Connect any server speaking MCP over HTTP. It must send CORS headers, since the request comes
          straight from this page.
        </p>

        {mcpServers.length > 0 && (
          <ul className="space-y-2">
            {mcpServers.map((server) => {
              const failure = mcpFailures.find((entry) => entry.id === server.id)
              return (
                <li key={server.id} className="rounded-lg border border-border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{server.id}</span>
                    <Button size="sm" variant="ghost" onPress={() => void remove(server.id)}>
                      Remove
                    </Button>
                  </div>
                  <p className="truncate text-xs text-muted">{server.url}</p>
                  {failure && <p className="mt-1 text-xs text-danger">{failure.message}</p>}
                </li>
              )
            })}
          </ul>
        )}

        <div className="space-y-2">
          <Input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="Short name, e.g. github"
            aria-label="Server name"
          />
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://host/mcp"
            aria-label="Server URL"
          />
          <Button
            size="sm"
            variant="secondary"
            fullWidth
            isDisabled={saving || !id.trim() || !url.trim()}
            onPress={() => void add()}
          >
            {saving ? 'Connecting…' : 'Add server'}
          </Button>
        </div>
      </section>
    </aside>
  )
}
