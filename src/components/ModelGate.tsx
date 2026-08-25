import type { ReactNode } from 'react'
import { Landing } from './Landing'
import { useChatStore } from '@/store/chat'

/**
 * Stands between the user and the chat until the weights are installed and
 * loaded. Everything it used to render — the GPU check, the storage figures, the
 * download — now lives in `InstallPanel` inside the landing page, so the screen
 * that asks for 448 MB is also the one that explains what they buy.
 */
export function ModelGate({ children }: { children: ReactNode }) {
  const status = useChatStore((state) => state.status)

  if (status === 'ready') return <>{children}</>
  return <Landing />
}
