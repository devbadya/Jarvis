import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@heroui/react/button'
import { Card } from '@heroui/react/card'
import { ProgressBar } from '@heroui/react/progress-bar'
import { Spinner } from '@heroui/react/spinner'
import { MODEL_ID } from '@/llm/config'
import { detectWebGpu, type GpuCapability } from '@/lib/webgpu'
import { formatBytes } from '@/lib/format'
import { useChatStore } from '@/store/chat'

/**
 * Stands between the user and the chat until WebGPU is confirmed and the weights
 * are in place. The first load pulls roughly 600 MB, so progress must be visible.
 */
export function ModelGate({ children }: { children: ReactNode }) {
  const [gpu, setGpu] = useState<GpuCapability | null>(null)
  const { status, loadMessage, loadProgress, error, initialize } = useChatStore()

  useEffect(() => {
    void detectWebGpu().then(setGpu)
  }, [])

  if (status === 'ready') return <>{children}</>

  const loaded = loadProgress.reduce((sum, file) => sum + file.loaded, 0)
  const total = loadProgress.reduce((sum, file) => sum + file.total, 0)
  const percent = total > 0 ? Math.min((loaded / total) * 100, 100) : 0

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <Card.Header>
          <Card.Title>Jarvis</Card.Title>
          <Card.Description>
            A chat agent whose language model runs entirely on your GPU. Nothing you type is sent to a server.
          </Card.Description>
        </Card.Header>

        <Card.Content className="space-y-5">
          {gpu === null && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" /> Checking GPU support…
            </p>
          )}

          {gpu?.supported === false && (
            <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger-soft-foreground">
              <p className="font-medium">WebGPU is unavailable</p>
              <p className="mt-1">{gpu.reason}</p>
            </div>
          )}

          {gpu?.supported && status === 'idle' && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Model</dt>
                <dd className="font-mono text-xs break-all">{MODEL_ID}</dd>
                <dt className="text-muted">GPU</dt>
                <dd>{gpu.adapter ?? 'detected'}</dd>
                <dt className="text-muted">First download</dt>
                <dd>~600 MB, then cached in your browser</dd>
              </dl>
              <Button variant="primary" onPress={() => void initialize()}>
                Load model
              </Button>
            </>
          )}

          {status === 'loading' && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                <Spinner size="sm" /> {loadMessage || 'Loading…'}
              </p>
              {total > 0 && (
                <ProgressBar aria-label="Model download progress" value={percent} color="accent">
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              )}
              {total > 0 && (
                <p className="text-xs text-muted">
                  {formatBytes(loaded)} of {formatBytes(total)} · {Math.round(percent)}%
                </p>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger-soft-foreground">
                <p className="font-medium">Loading failed</p>
                <p className="mt-1 break-words">{error}</p>
              </div>
              <Button variant="secondary" onPress={() => void initialize()}>
                Try again
              </Button>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  )
}
