import { ChatPanel } from './components/ChatPanel'
import { EvalPanel } from './components/EvalPanel'
import { ModelGate } from './components/ModelGate'
import { NewChatButton } from './components/NewChatButton'
import { SettingsPanel } from './components/SettingsPanel'
import { ThemeToggle } from './components/ThemeToggle'

/**
 * The eval needs the real weights on a real GPU, which only exist in the
 * browser, so it ships as part of the app behind a query flag rather than as a
 * script that could never load the model.
 */
const EVAL_MODE = new URLSearchParams(window.location.search).has('eval')

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-semibold">Jarvis</h1>
          <p className="text-xs text-muted">{EVAL_MODE ? 'eval harness' : 'Qwen3.5-0.8B · on-device'}</p>
        </div>
        <div className="flex items-center gap-1">
          {!EVAL_MODE && <NewChatButton />}
          <ThemeToggle />
          {!EVAL_MODE && <SettingsPanel />}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <ModelGate>{EVAL_MODE ? <EvalPanel /> : <ChatPanel />}</ModelGate>
      </main>
    </div>
  )
}
