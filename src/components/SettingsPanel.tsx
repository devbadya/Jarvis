import { useState, type FormEvent } from 'react'
import { Badge } from '@heroui/react/badge'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Drawer } from '@heroui/react/drawer'
import { Form } from '@heroui/react/form'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { RadioGroup } from '@heroui/react/radio-group'
import { TextField } from '@heroui/react/textfield'
import { RadioOption } from './ui/RadioOption'
import { SlidersIcon } from './ui/icons'
import { useChatStore } from '@/store/chat'
import type { McpServerConfig } from '@/tools/mcp'
import { SEARCH_PROVIDERS, searchProviderInfo, type SearchProvider } from '@/tools/web'

const MISSING_KEY_MESSAGE_ID = 'web-access-missing-key'

/**
 * Web access and MCP servers are configured at runtime rather than baked in:
 * the useful choices differ per user, and API keys must never enter the bundle.
 * Both live in localStorage.
 *
 * A drawer rather than a column beside the chat: at phone widths a fixed side
 * panel leaves the transcript nothing to occupy, and the overlay brings focus
 * containment and dismiss-on-Escape with it.
 */
export function SettingsPanel() {
  const { tools, mcpServers, mcpFailures, setMcpServers, webAccess, setWebAccess } = useChatStore()
  const [id, setId] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const provider = searchProviderInfo(webAccess.provider)
  const missingKey = provider.needsKey && !webAccess.searchApiKey?.trim()

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

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void add()
  }

  return (
    <Drawer>
      {/* A server that fails to connect costs the model a tool, and until now it
          said so only inside the drawer nobody had a reason to open. This is the
          one job HeroUI's Badge is actually for: a count hanging off a control. */}
      <Badge.Anchor>
        <Button size="sm" variant="ghost">
          <SlidersIcon />
          Tools
          {mcpFailures.length > 0 && (
            <span className="sr-only">
              , {mcpFailures.length} {mcpFailures.length === 1 ? 'server' : 'servers'} not connected
            </span>
          )}
        </Button>
        {mcpFailures.length > 0 && (
          <Badge aria-hidden="true" color="danger" size="sm">
            {mcpFailures.length}
          </Badge>
        )}
      </Badge.Anchor>

      {/* No width on Content: it is a full-viewport flex wrapper and its
          `justify-end` is what puts the panel on the right. Constrain it and the
          panel lands on the left instead. Drawer.Dialog sizes itself. */}
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.Header>
              <Drawer.Heading>Tools</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>

            <Drawer.Body className="flex flex-col gap-6">
              <section className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                  Available to the model ({tools.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((tool) => (
                    <Chip key={tool.schema.function.name} variant="soft">
                      {tool.schema.function.name}
                    </Chip>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Web access</h3>
                <p className="text-xs text-muted">
                  Searches and page reads go straight from this page to the provider — there is no server in
                  between. Keys are stored in this browser only.
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

                {provider.needsKey && (
                  <TextField
                    type="password"
                    value={webAccess.searchApiKey ?? ''}
                    onChange={(value) => setWebAccess({ ...webAccess, searchApiKey: value })}
                  >
                    <Label>{provider.label} API key</Label>
                    <Input
                      aria-describedby={missingKey ? MISSING_KEY_MESSAGE_ID : undefined}
                      placeholder={provider.keyPlaceholder}
                    />
                  </TextField>
                )}

                {missingKey && (
                  <p id={MISSING_KEY_MESSAGE_ID} className="text-xs text-danger">
                    web_search will fail until a key is set.
                  </p>
                )}

                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs text-muted">
                    read_page uses r.jina.ai, which allows 20 requests a minute without a key. A key raises
                    that limit.
                  </p>
                  <TextField
                    type="password"
                    value={webAccess.readerApiKey ?? ''}
                    onChange={(value) => setWebAccess({ ...webAccess, readerApiKey: value })}
                  >
                    <Label>Reader API key</Label>
                    <Input placeholder="jina_… (optional)" />
                  </TextField>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">MCP servers</h3>
                <p className="text-xs text-muted">
                  Connect any server speaking MCP over HTTP. It must send CORS headers, since the request
                  comes straight from this page.
                </p>

                {mcpServers.length > 0 && (
                  <ul className="space-y-2">
                    {mcpServers.map((server) => {
                      const failure = mcpFailures.find((entry) => entry.id === server.id)
                      return (
                        <li key={server.id} className="rounded-lg border border-border p-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs">{server.id}</span>
                            <Button
                              aria-label={`Remove ${server.id}`}
                              size="sm"
                              variant="ghost"
                              onPress={() => void remove(server.id)}
                            >
                              Remove
                            </Button>
                          </div>
                          <p className="truncate text-xs text-muted">{server.url}</p>
                          {failure && (
                            <p className="mt-1 text-xs text-danger" role="alert">
                              {failure.message}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                <Form className="space-y-3" onSubmit={submit}>
                  <TextField value={id} onChange={setId}>
                    <Label>Server name</Label>
                    <Input placeholder="github" />
                  </TextField>
                  <TextField type="url" value={url} onChange={setUrl}>
                    <Label>Server URL</Label>
                    <Input placeholder="https://host/mcp" />
                  </TextField>
                  <Button
                    fullWidth
                    isDisabled={saving || !id.trim() || !url.trim()}
                    size="sm"
                    type="submit"
                    variant="secondary"
                  >
                    {saving ? 'Connecting…' : 'Add server'}
                  </Button>
                </Form>
              </section>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}
