import { Button } from '@heroui/react/button'
import { useChatStore } from '@/store/chat'
import { PlusIcon } from './ui/icons'

/**
 * Starts a blank conversation. The one on screen is already in the chats list,
 * so this does not ask for confirmation: nothing is thrown away.
 *
 * Disabled while a reply is running. Abandoning the turn and writing its
 * answer into the next chat is the mix this avoids.
 */
export function NewChatButton() {
  const clear = useChatStore((state) => state.clear)
  const count = useChatStore((state) => state.messages.length)
  const busy = useChatStore((state) => state.busy)

  if (count === 0) return null

  return (
    <Button isDisabled={busy} size="sm" variant="ghost" onPress={clear}>
      <PlusIcon />
      New chat
    </Button>
  )
}
