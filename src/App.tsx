import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { ChatPanel } from './components/ChatPanel'
import { ModelGate } from './components/ModelGate'
import { SettingsPanel } from './components/SettingsPanel'
import { useChatStore } from './store/chat'

export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const clear = useChatStore((state) => state.clear)
  const hasMessages = useChatStore((state) => state.messages.length > 0)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">Jarvis</span>
          <span className="text-xs text-muted">Qwen3.5-0.8B · on-device</span>
        </div>
        <div className="flex items-center gap-1">
          {hasMessages && (
            <Button size="sm" variant="ghost" onPress={clear}>
              New chat
            </Button>
          )}
          <Button size="sm" variant="ghost" onPress={() => setShowSettings((open) => !open)}>
            Tools
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col">
          <ModelGate>
            <ChatPanel />
          </ModelGate>
        </main>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      </div>
    </div>
  )
}
