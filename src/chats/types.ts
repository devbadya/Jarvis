import type { Message } from '@/types'

/** One saved conversation. Messages are the transcript the chat already shows. */
export interface ChatRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

/** What the chats drawer lists. The transcript stays in the record until it is opened. */
export interface ChatSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

/**
 * How many conversations this browser keeps. Saving is explicit and unbounded
 * otherwise: a new chat never deletes the one it replaced, so the cap is what
 * stops the database growing for as long as the tab is used.
 */
export const MAX_CHATS = 50

/** Which conversation to reopen. The transcript itself lives in IndexedDB. */
export const ACTIVE_CHAT_KEY = 'jarvis.active-chat'
