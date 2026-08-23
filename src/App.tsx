import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { ChatPanel } from './components/ChatPanel'
import { EvalPanel } from './components/EvalPanel'
import { ModelGate } from './components/ModelGate'
import { SettingsPanel } from './components/SettingsPanel'
import { useChatStore } from './store/chat'

/**
 * The eval needs the real weights on a real GPU, which only exist in the
 * browser, so it ships as part of the app behind a query flag rather than as a
 * script that could never load the model.
 */
const EVAL_MODE = new URLSearchParams(window.location.search).has('eval')

export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const clear = useChatStore((state) => state.clear)
  const hasMessages = useChatStore((state) => state.messages.length > 0)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">Jarvis</span>
          <span className="text-xs text-muted">
            {EVAL_MODE ? 'eval harness' : 'Qwen3.5-0.8B · on-device'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!EVAL_MODE && hasMessages && (
            <Button size="sm" variant="ghost" onPress={clear}>
              New chat
            </Button>
          )}
          {!EVAL_MODE && (
            <Button size="sm" variant="ghost" onPress={() => setShowSettings((open) => !open)}>
              Tools
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col">
          <ModelGate>{EVAL_MODE ? <EvalPanel /> : <ChatPanel />}</ModelGate>
        </main>
        {showSettings && !EVAL_MODE && <SettingsPanel onClose={() => setShowSettings(false)} />}
      </div>
    </div>
  )
}
