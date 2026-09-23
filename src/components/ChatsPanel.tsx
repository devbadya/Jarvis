import { useEffect, useState } from 'react'
import { AlertDialog } from '@heroui/react/alert-dialog'
import { Button } from '@heroui/react/button'
import { Drawer } from '@heroui/react/drawer'
import { ChatIcon, PlusIcon, TrashIcon } from './ui/icons'
import { formatAge } from '@/lib/format'
import type { ChatSummary } from '@/chats/types'
import { useChatStore } from '@/store/chat'

/**
 * Saved conversations, and the way back into one.
 *
 * A drawer, like Memory and Tools: a column beside the transcript leaves a
 * phone with nothing to read. The list is summaries; opening one loads its
 * messages. Deleting is permanent, unlike a memory, so it asks first.
 */
export function ChatsPanel() {
  const chats = useChatStore((state) => state.chats)
  const chatId = useChatStore((state) => state.chatId)
  const busy = useChatStore((state) => state.busy)
  const failure = useChatStore((state) => state.chatsError)
  const blank = useChatStore((state) => state.messages.length === 0 && state.chatId === null)
  const loadChats = useChatStore((state) => state.loadChats)
  const openChat = useChatStore((state) => state.openChat)
  const deleteChat = useChatStore((state) => state.deleteChat)
  const clear = useChatStore((state) => state.clear)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ChatSummary | null>(null)

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  return (
    <>
      <Drawer isOpen={open} onOpenChange={setOpen}>
        <Button size="sm" variant="ghost">
          <ChatIcon />
          Chats
        </Button>

        <Drawer.Backdrop>
          <Drawer.Content placement="right">
            <Drawer.Dialog>
              <Drawer.Header>
                <Drawer.Heading>Chats</Drawer.Heading>
                <Drawer.CloseTrigger />
              </Drawer.Header>

              <Drawer.Body className="flex flex-col gap-4">
                <p className="text-xs text-muted">
                  Kept in this browser, in IndexedDB, and never sent anywhere. A new chat leaves the current
                  one here.
                </p>

                <Button
                  isDisabled={busy || blank}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    clear()
                    setOpen(false)
                  }}
                >
                  <PlusIcon />
                  New chat
                </Button>

                {failure && (
                  <p className="text-xs text-danger" role="alert">
                    {failure}
                  </p>
                )}

                {chats.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nothing saved yet. A conversation is kept once you send a message.
                  </p>
                ) : (
                  <ul aria-label="Saved chats" className="space-y-1">
                    {chats.map((chat) => (
                      <li key={chat.id} className="flex items-center gap-1">
                        <Button
                          aria-current={chat.id === chatId ? 'true' : undefined}
                          className="min-w-0 flex-1 justify-start"
                          isDisabled={busy}
                          variant={chat.id === chatId ? 'secondary' : 'ghost'}
                          onPress={() => {
                            void openChat(chat.id)
                            setOpen(false)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate text-start">{chat.title}</span>
                          <span className="ms-2 shrink-0 text-xs text-muted">
                            {formatAge(chat.updatedAt)}
                          </span>
                        </Button>
                        <Button
                          aria-label={`Delete chat: ${chat.title}`}
                          isDisabled={busy}
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          onPress={() => setPending(chat)}
                        >
                          <TrashIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {pending && (
                  <AlertDialog
                    isOpen
                    onOpenChange={(next) => {
                      if (!next) setPending(null)
                    }}
                  >
                    {/* DialogTrigger wants a pressable child. The row already opened this. */}
                    <Button aria-label="Open confirmation" className="sr-only">
                      Open confirmation
                    </Button>
                    <AlertDialog.Backdrop>
                      <AlertDialog.Container>
                        <AlertDialog.Dialog>
                          <AlertDialog.Header>
                            <AlertDialog.Icon status="danger" />
                            <AlertDialog.Heading>Delete this chat?</AlertDialog.Heading>
                          </AlertDialog.Header>
                          <AlertDialog.Body>
                            “{pending.title}” is removed from this browser. It cannot be restored.
                          </AlertDialog.Body>
                          <AlertDialog.Footer>
                            <Button variant="ghost" onPress={() => setPending(null)}>
                              Keep
                            </Button>
                            <Button
                              variant="danger"
                              onPress={() => {
                                void deleteChat(pending.id)
                                setPending(null)
                              }}
                            >
                              Delete
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
    </>
  )
}
