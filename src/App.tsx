import { useEffect } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { EvalPanel } from './components/EvalPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { ModelGate } from './components/ModelGate'
import { NewChatButton } from './components/NewChatButton'
import { SettingsPanel } from './components/SettingsPanel'
import { ThemeToggle } from './components/ThemeToggle'
import { Orb } from './components/ui/Orb'
import { isOnline, watchOnline } from '@/lib/network'
import { useChatStore } from '@/store/chat'

/**
 * The eval needs the real weights on a real GPU, which only exist in the
 * browser, so it ships as part of the app behind a query flag rather than as a
 * script that could never load the model.
 */
const EVAL_MODE = new URLSearchParams(window.location.search).has('eval')

/**
 * Selects `busy` here rather than in `App` so the header's own subtree is what
 * re-renders when a turn starts and ends, instead of the transcript below it.
 */
function BrandMark() {
  const busy = useChatStore((state) => state.busy)
  const hostedChat = useChatStore((state) => state.hostedChat)
  const label = EVAL_MODE
    ? 'eval harness'
    : hostedChat
      ? `${hostedChat.model} · hosted`
      : 'Qwen3.5-0.8B · on-device'

  return (
    <div className="flex items-center gap-2.5">
      <Orb active={busy} />
      <div className="flex items-baseline gap-2">
        <h1 className="font-semibold tracking-tight">Jarvis</h1>
        <p className="hidden text-xs text-muted sm:block">{label}</p>
      </div>
    </div>
  )
}

export default function App() {
  const setOnline = useChatStore((state) => state.setOnline)

  // The store was constructed with whatever the browser said at import time,
  // which is already stale if the connection dropped during the model load.
  useEffect(() => {
    setOnline(isOnline())
    return watchOnline(setOnline)
  }, [setOnline])

  return (
    <div className="flex h-full flex-col">
      <header className="glass-dim z-10 flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <BrandMark />
        <div className="flex items-center gap-1">
          {!EVAL_MODE && <NewChatButton />}
          <ThemeToggle />
          {!EVAL_MODE && <MemoryPanel />}
          {!EVAL_MODE && <SettingsPanel />}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <ModelGate>{EVAL_MODE ? <EvalPanel /> : <ChatPanel />}</ModelGate>
      </main>
    </div>
  )
}
