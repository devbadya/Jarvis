import { useState } from 'react'
import { AlertDialog } from '@heroui/react/alert-dialog'
import { Button } from '@heroui/react/button'
import { useChatStore } from '@/store/chat'
import { PlusIcon } from './ui/icons'

/**
 * A transcript lives in memory in this one tab and is never written anywhere, so
 * clearing it is unrecoverable and worth one confirmation.
 */
export function NewChatButton() {
  const clear = useChatStore((state) => state.clear)
  const count = useChatStore((state) => state.messages.length)
  const [confirming, setConfirming] = useState(false)

  if (count === 0) return null

  return (
    <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
      <Button size="sm" variant="ghost">
        <PlusIcon />
        New chat
      </Button>

      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>Start a new chat?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              This conversation is only held in this tab and is not saved anywhere. Starting a new chat
              discards all {count} messages.
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="ghost" onPress={() => setConfirming(false)}>
                Keep chatting
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  clear()
                  setConfirming(false)
                }}
              >
                Discard and start over
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  )
}
