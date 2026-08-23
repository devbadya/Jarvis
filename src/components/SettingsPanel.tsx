import { useState, type FormEvent } from 'react'
import { Alert } from '@heroui/react/alert'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Drawer } from '@heroui/react/drawer'
import { Form } from '@heroui/react/form'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { TextField } from '@heroui/react/textfield'
import { useChatStore } from '@/store/chat'
import { webToolsAvailable } from '@/tools/builtins'
import type { McpServerConfig } from '@/tools/mcp'
import { SlidersIcon } from './ui/icons'

/**
 * MCP servers are added at runtime rather than baked in, because the useful ones
 * differ per user. Configuration lives in localStorage.
 *
 * A drawer rather than a column beside the chat: at phone widths a fixed side
 * panel leaves the transcript nothing to occupy, and the overlay brings focus
 * containment and dismiss-on-Escape with it.
 */
export function SettingsPanel() {
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

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void add()
  }

  return (
    <Drawer>
      <Button size="sm" variant="ghost">
        <SlidersIcon />
        Tools
      </Button>

      <Drawer.Backdrop>
        {/* No width here: Content is a full-viewport flex wrapper and its
            `justify-end` is what puts the panel on the right. Constrain it and
            the panel lands on the left instead. Drawer.Dialog sizes itself. */}
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
                {!webToolsAvailable && (
                  <Alert status="accent">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Web tools are off in this deployment</Alert.Title>
                      <Alert.Description>
                        <code>web_search</code> and <code>read_page</code> need a server-side proxy, which a
                        static host does not provide.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
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
