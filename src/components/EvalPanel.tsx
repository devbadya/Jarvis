import { useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { STRATEGIES, type StrategyId } from '@/llm/config'
import { getClient, useChatStore } from '@/store/chat'
import { runEval, summarize, type Attempt, type EvalArm } from '@/eval/runner'
import { selectScenarios } from '@/eval/scenarios'
import { loadCatalog } from '@/skills/load'

const STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[]
const SKILLS = loadCatalog()

/** `verbose` exists to reproduce a known-bad setting, so it is opt-in. */
const DEFAULT_SELECTION: StrategyId[] = ['baseline', 'capped', 'routed']

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

/**
 * The eval has to run here rather than in Node: the model's Gated DeltaNet
 * layers need an operator only ONNX Runtime Web implements, so there is no
 * headless path to the real weights. Reached at `?eval`.
 */
export function EvalPanel() {
  const tools = useChatStore((state) => state.tools)
  const [repeats, setRepeats] = useState(3)
  const [includeOnline, setIncludeOnline] = useState(false)
  const [selected, setSelected] = useState<StrategyId[]>(DEFAULT_SELECTION)
  const [withSkills, setWithSkills] = useState(true)
  const [withoutReview, setWithoutReview] = useState(false)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  const scenarios = useMemo(() => selectScenarios({ includeOnline }), [includeOnline])

  // Each strategy runs with and without skills, so the two changes can be told
  // apart instead of landing as one undifferentiated "it got better". The answer
  // check is a third dimension on the same principle, and within one run rather
  // than across two: a GPU that throttles between runs would answer for it.
  const arms = useMemo<EvalArm[]>(
    () =>
      selected.flatMap((id) => {
        const strategy = STRATEGIES[id]
        const configured: EvalArm[] = [{ id, strategy, skills: [] }]
        if (withSkills) configured.push({ id: `${id}+skills`, strategy, skills: SKILLS })
        if (!withoutReview) return configured
        return configured.flatMap((arm) => [arm, { ...arm, id: `${arm.id}-nocheck`, review: false }])
      }),
    [selected, withSkills, withoutReview],
  )

  const total = scenarios.length * arms.length * repeats
  const summaries = useMemo(() => summarize(attempts), [attempts])

  const start = async (): Promise<void> => {
    stopRef.current = false
    setRunning(true)
    setAttempts([])
    try {
      await runEval(getClient(), {
        scenarios,
        arms,
        repeats,
        tools,
        onAttempt: (attempt) => setAttempts((current) => [...current, attempt]),
        shouldStop: () => stopRef.current,
      })
    } finally {
      setRunning(false)
    }
  }

  const download = (): void => {
    const blob = new Blob([JSON.stringify(attempts, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `jarvis-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggle = (id: StrategyId): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 overflow-y-auto p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Reasoning budget eval</h1>
        <p className="text-sm text-muted">
          Sweeps generation strategies over {scenarios.length} scenarios so a change to the reasoning budget
          can be measured instead of guessed at. Sampling is on, so read the repeats, not any single run.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-border p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Repeats
          <input
            type="number"
            min={1}
            max={20}
            value={repeats}
            disabled={running}
            onChange={(event) => setRepeats(Math.max(1, Number(event.target.value) || 1))}
            className="w-20 rounded-lg border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          />
        </label>

        <div className="flex flex-col gap-1 text-xs text-muted">
          Strategies
          <div className="flex flex-wrap gap-1.5">
            {STRATEGY_IDS.map((id) => (
              <Button
                key={id}
                size="sm"
                variant={selected.includes(id) ? 'secondary' : 'ghost'}
                isDisabled={running}
                onPress={() => toggle(id)}
              >
                {id}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-muted">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={withSkills}
              disabled={running}
              onChange={(event) => setWithSkills(event.target.checked)}
            />
            Also run each strategy with skills ({SKILLS.length})
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeOnline}
              disabled={running}
              onChange={(event) => setIncludeOnline(event.target.checked)}
            />
            Include scenarios needing the network
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={withoutReview}
              disabled={running}
              onChange={(event) => setWithoutReview(event.target.checked)}
            />
            Also run each arm with the answer check off
          </label>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button size="sm" variant="secondary" onPress={() => (stopRef.current = true)}>
              Stop
            </Button>
          ) : (
            <Button size="sm" isDisabled={selected.length === 0} onPress={() => void start()}>
              Run {total} generations
            </Button>
          )}
          {attempts.length > 0 && !running && (
            <Button size="sm" variant="ghost" onPress={download}>
              Export JSON
            </Button>
          )}
        </div>
      </section>

      {running && (
        <p className="text-sm text-muted">
          {attempts.length} of {total} done…
        </p>
      )}

      {summaries.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">By strategy</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="p-2 text-left font-medium">Strategy</th>
                  <th className="p-2 text-right font-medium">n</th>
                  <th className="p-2 text-right font-medium">Right tool</th>
                  <th className="p-2 text-right font-medium">Right args</th>
                  <th className="p-2 text-right font-medium">Right answer</th>
                  <th className="p-2 text-right font-medium">Invented tool</th>
                  <th className="p-2 text-right font-medium">Flagged</th>
                  <th className="p-2 text-right font-medium">Corrected</th>
                  <th className="p-2 text-right font-medium">Think tokens</th>
                  <th className="p-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.armId} className="border-b border-border last:border-0">
                    <td className="p-2 font-mono text-xs">{summary.armId}</td>
                    <td className="p-2 text-right">{summary.attempts}</td>
                    <td className="p-2 text-right">{percent(summary.routing)}</td>
                    <td className="p-2 text-right">
                      {summary.callQuality === null ? '—' : percent(summary.callQuality)}
                    </td>
                    <td className="p-2 text-right">{percent(summary.answers)}</td>
                    <td className="p-2 text-right">{percent(summary.hallucination)}</td>
                    <td className="p-2 text-right">{percent(summary.flagged)}</td>
                    <td className="p-2 text-right">{percent(summary.corrected)}</td>
                    <td className="p-2 text-right">{summary.medianThinkTokens}</td>
                    <td className="p-2 text-right">{(summary.meanDurationMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">By category</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {summaries.map((summary) => (
              <div key={summary.armId} className="rounded-xl border border-border p-3">
                <p className="mb-2 font-mono text-xs">{summary.armId}</p>
                <ul className="space-y-1 text-xs text-muted">
                  {summary.byCategory.map((entry) => (
                    <li key={entry.category} className="flex justify-between gap-2">
                      <span>{entry.category}</span>
                      <span>
                        tool {percent(entry.routing)} · answer {percent(entry.answers)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {attempts.some((attempt) => attempt.error) && (
        <section className="space-y-1">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Failures</h2>
          <ul className="space-y-1 text-xs text-danger">
            {attempts
              .filter((attempt) => attempt.error)
              .slice(0, 10)
              .map((attempt, index) => (
                <li key={`${attempt.scenarioId}-${index}`}>
                  {attempt.scenarioId}: {attempt.error}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  )
}
