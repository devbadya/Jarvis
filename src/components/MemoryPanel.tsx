import { useEffect, useState, type FormEvent } from 'react'
import { AlertDialog } from '@heroui/react/alert-dialog'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Drawer } from '@heroui/react/drawer'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { RadioGroup } from '@heroui/react/radio-group'
import { Switch } from '@heroui/react/switch'
import { TextField } from '@heroui/react/textfield'
import { RadioOption } from './ui/RadioOption'
import { BookmarkIcon, PencilIcon, TrashIcon } from './ui/icons'
import { formatAge } from '@/lib/format'
import { MAX_MEMORY_TEXT_CHARS, MEMORY_KINDS, type MemoryKind, type MemoryRecord } from '@/memory/types'
import { useChatStore } from '@/store/chat'

/**
 * What Jarvis remembers, and the only place it can be corrected.
 *
 * A memory the user cannot read is a memory they cannot disagree with, and this
 * one is written by a 0.8B model that will sometimes record the wrong thing.
 * So everything is listed verbatim — the model's entries and the user's alike —
 * and every one of them can be edited or removed here.
 */
export function MemoryPanel() {
  const memoryEnabled = useChatStore((state) => state.memoryEnabled)
  const memories = useChatStore((state) => state.memories)
  const trashed = useChatStore((state) => state.trashedMemories)
  const failure = useChatStore((state) => state.memoryError)
  const refreshMemories = useChatStore((state) => state.refreshMemories)
  const setMemoryEnabled = useChatStore((state) => state.setMemoryEnabled)
  const addMemory = useChatStore((state) => state.addMemory)
  const forgetAllMemories = useChatStore((state) => state.forgetAllMemories)
  const emptyMemoryTrash = useChatStore((state) => state.emptyMemoryTrash)

  const [text, setText] = useState('')
  const [kind, setKind] = useState<MemoryKind>('fact')
  const [confirming, setConfirming] = useState(false)

  // What is on disk outlives the tab; the Zustand store starts empty. The chat
  // fills it when the model loads, but the panel can be opened before that.
  useEffect(() => {
    void refreshMemories()
  }, [refreshMemories])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    void addMemory(trimmed, kind)
  }

  return (
    <Drawer>
      <Button size="sm" variant="ghost">
        <BookmarkIcon />
        Memory
      </Button>

      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.Header>
              <Drawer.Heading>Memory</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>

            <Drawer.Body className="flex flex-col gap-6">
              <section className="space-y-2">
                <Switch isSelected={memoryEnabled} onChange={setMemoryEnabled}>
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    Remember across chats
                  </Switch.Content>
                </Switch>
                <p className="text-xs text-muted">
                  Kept in this browser, in IndexedDB, and never sent anywhere. What is relevant to a question
                  is added to the prompt before Jarvis answers it.
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                  Remembered ({memories.length})
                </h3>

                {/* A browser that refuses IndexedDB — private mode, or storage
                    turned off — would otherwise leave the buttons here doing
                    nothing at all, with no way to tell that from a bug. */}
                {failure && (
                  <p className="text-xs text-danger" role="alert">
                    Memory could not be saved: {failure}
                  </p>
                )}

                {memories.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nothing yet. Say “remember that …” in the chat, or add one below.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {memories.map((record) => (
                      <MemoryItem key={record.id} record={record} />
                    ))}
                  </ul>
                )}

                <form className="space-y-3 border-t border-border pt-3" onSubmit={submit}>
                  <TextField maxLength={MAX_MEMORY_TEXT_CHARS} value={text} onChange={setText}>
                    <Label>New memory</Label>
                    <Input placeholder="Prefers metric units" />
                  </TextField>
                  <RadioGroup
                    aria-label="Kind"
                    orientation="horizontal"
                    value={kind}
                    onChange={(value) => setKind(value as MemoryKind)}
                  >
                    {MEMORY_KINDS.map((entry) => (
                      <RadioOption key={entry} value={entry}>
                        {entry}
                      </RadioOption>
                    ))}
                  </RadioGroup>
                  <Button fullWidth isDisabled={!text.trim()} size="sm" type="submit" variant="secondary">
                    Add memory
                  </Button>
                </form>
              </section>

              {trashed.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
                    Recently deleted ({trashed.length})
                  </h3>
                  <p className="text-xs text-muted">
                    Deleting is undoable for a week, whether Jarvis did it or you did.
                  </p>
                  <ul className="space-y-2">
                    {trashed.map((record) => (
                      <TrashedItem key={record.id} record={record} />
                    ))}
                  </ul>
                  <Button size="sm" variant="ghost" onPress={() => void emptyMemoryTrash()}>
                    Empty the bin
                  </Button>
                </section>
              )}

              {memories.length > 0 && (
                <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
                  <Button size="sm" variant="danger-soft">
                    <TrashIcon />
                    Forget everything
                  </Button>

                  <AlertDialog.Backdrop>
                    <AlertDialog.Container>
                      <AlertDialog.Dialog>
                        <AlertDialog.Header>
                          <AlertDialog.Icon status="warning" />
                          <AlertDialog.Heading>Forget all {memories.length} memories?</AlertDialog.Heading>
                        </AlertDialog.Header>
                        <AlertDialog.Body>
                          They move to the bin below, where they can be restored for a week.
                        </AlertDialog.Body>
                        <AlertDialog.Footer>
                          <Button variant="ghost" onPress={() => setConfirming(false)}>
                            Keep them
                          </Button>
                          <Button
                            variant="danger"
                            onPress={() => {
                              void forgetAllMemories()
                              setConfirming(false)
                            }}
                          >
                            Forget everything
                          </Button>
                        </AlertDialog.Footer>
                      </AlertDialog.Dialog>
                    </AlertDialog.Container>
                  </AlertDialog.Backdrop>
                </AlertDialog>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}

function MemoryItem({ record }: { record: MemoryRecord }) {
  const editMemory = useChatStore((state) => state.editMemory)
  const forgetMemory = useChatStore((state) => state.forgetMemory)
  const [draft, setDraft] = useState<string | null>(null)

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = draft?.trim()
    setDraft(null)
    if (trimmed && trimmed !== record.text) void editMemory(record.id, trimmed)
  }

  return (
    <li className="rounded-lg border border-border p-2 text-sm">
      {draft === null ? (
        <>
          <p className="[overflow-wrap:anywhere]">{record.text}</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Chip size="sm" variant="soft">
                {record.kind}
              </Chip>
              {record.source === 'model' ? 'saved by Jarvis' : 'added by you'} · {formatAge(record.updatedAt)}
            </span>
            <span className="flex gap-1">
              <Button
                aria-label={`Edit memory: ${record.text}`}
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => setDraft(record.text)}
              >
                <PencilIcon />
              </Button>
              <Button
                aria-label={`Delete memory: ${record.text}`}
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => void forgetMemory(record.id)}
              >
                <TrashIcon />
              </Button>
            </span>
          </div>
        </>
      ) : (
        <form className="space-y-2" onSubmit={save}>
          <TextField
            autoFocus
            aria-label={`Memory: ${record.text}`}
            maxLength={MAX_MEMORY_TEXT_CHARS}
            value={draft}
            onChange={setDraft}
          >
            <Input />
          </TextField>
          <div className="flex gap-1">
            <Button size="sm" type="submit" variant="secondary">
              Save
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function TrashedItem({ record }: { record: MemoryRecord }) {
  const restore = useChatStore((state) => state.restoreMemory)
  const purge = useChatStore((state) => state.purgeMemory)

  return (
    <li className="rounded-lg border border-border p-2 text-sm">
      <p className="text-muted line-through [overflow-wrap:anywhere]">{record.text}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">deleted {formatAge(record.deletedAt ?? record.updatedAt)}</span>
        <span className="flex gap-1">
          <Button
            aria-label={`Restore memory: ${record.text}`}
            size="sm"
            variant="ghost"
            onPress={() => void restore(record.id)}
          >
            Restore
          </Button>
          <Button
            aria-label={`Delete memory forever: ${record.text}`}
            size="sm"
            variant="ghost"
            onPress={() => void purge(record.id)}
          >
            Forever
          </Button>
        </span>
      </div>
    </li>
  )
}
