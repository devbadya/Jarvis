import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { RadioGroup } from '@heroui/react/radio-group'
import { Badge } from './ui/Badge'
import { RadioOption } from './ui/RadioOption'
import { useChatStore } from '@/store/chat'
import type { McpServerConfig } from '@/tools/mcp'
import { SEARCH_PROVIDERS, searchProviderInfo, type SearchProvider } from '@/tools/web'

const MISSING_KEY_MESSAGE_ID = 'web-access-missing-key'

/**
 * Web access and MCP servers are configured at runtime rather than baked in:
 * the useful choices differ per user, and API keys must never enter the bundle.
 * Both live in localStorage.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { tools, mcpServers, mcpFailures, setMcpServers, webAccess, setWebAccess } = useChatStore()
  const [id, setId] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const provider = searchProviderInfo(webAccess.provider)
  const missingKey = provider.needsKey && !webAccess.jinaApiKey?.trim()

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
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Web access</h3>
        <p className="text-xs text-muted">
          Searches and page reads go straight from this page to the provider — there is no server in between.
          Keys are stored in this browser only.
        </p>

        <RadioGroup
          aria-label="Search provider"
          value={webAccess.provider}
          onChange={(value) => setWebAccess({ ...webAccess, provider: value as SearchProvider })}
        >
          {SEARCH_PROVIDERS.map((entry) => (
            <RadioOption key={entry.id} value={entry.id}>
              {entry.label}
            </RadioOption>
          ))}
        </RadioGroup>

        <p className="text-xs text-muted">{provider.note}</p>

        <div className="space-y-2 border-t border-border pt-3">
          <Input
            type="password"
            value={webAccess.jinaApiKey ?? ''}
            onChange={(event) => setWebAccess({ ...webAccess, jinaApiKey: event.target.value })}
            placeholder={provider.needsKey ? 'jina_…' : 'jina_… (optional)'}
            aria-label="Jina API key"
            aria-describedby={missingKey ? MISSING_KEY_MESSAGE_ID : undefined}
          />
          {missingKey ? (
            <p id={MISSING_KEY_MESSAGE_ID} className="text-xs text-danger">
              web_search will fail until a key is set.
            </p>
          ) : (
            <p className="text-xs text-muted">
              One key covers both Jina services. read_page works without it at 20 requests a minute.
            </p>
          )}
        </div>
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
