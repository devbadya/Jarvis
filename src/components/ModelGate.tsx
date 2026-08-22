import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@heroui/react/button'
import { Card } from '@heroui/react/card'
import { ProgressBar } from '@heroui/react/progress-bar'
import { Spinner } from '@heroui/react/spinner'
import { MODEL_DOWNLOAD_BYTES, MODEL_ID } from '@/llm/config'
import { detectWebGpu, type GpuCapability } from '@/lib/webgpu'
import { formatBytes } from '@/lib/format'
import { useChatStore } from '@/store/chat'
import { Badge } from './ui/Badge'

/**
 * Stands between the user and the chat until WebGPU is confirmed and the weights
 * are installed. The download is a one-time cost, so its state has to be legible.
 */
export function ModelGate({ children }: { children: ReactNode }) {
  const [gpu, setGpu] = useState<GpuCapability | null>(null)
  const { status, loadMessage, loadProgress, error, storage, initialize, refreshStorage, removeModel } =
    useChatStore()

  useEffect(() => {
    void detectWebGpu().then(setGpu)
    void refreshStorage()
  }, [refreshStorage])

  if (status === 'ready') return <>{children}</>

  const loaded = loadProgress.reduce((sum, file) => sum + file.loaded, 0)
  const total = loadProgress.reduce((sum, file) => sum + file.total, 0)
  const percent = total > 0 ? Math.min((loaded / total) * 100, 100) : 0
  const installed = storage.modelCached

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <Card.Header>
          <Card.Title>Jarvis</Card.Title>
          <Card.Description>
            A chat agent whose language model runs on your own GPU. Install it once, then it works offline and
            nothing you type ever leaves this device.
          </Card.Description>
        </Card.Header>

        <Card.Content className="space-y-5">
          {gpu === null && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" /> Checking GPU support…
            </p>
          )}

          {gpu?.supported === false && (
            <div className="border-danger/40 bg-danger-soft text-danger-soft-foreground rounded-lg border p-4 text-sm">
              <p className="font-medium">WebGPU is unavailable</p>
              <p className="mt-1">{gpu.reason}</p>
            </div>
          )}

          {gpu?.supported && status !== 'loading' && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted">Model</dt>
                <dd className="font-mono text-xs break-all">{MODEL_ID}</dd>
                <dt className="text-muted">GPU</dt>
                <dd>{gpu.adapter ?? 'detected'}</dd>
                <dt className="text-muted">Status</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  {installed ? (
                    <>
                      <Badge tone="success">installed</Badge>
                      {storage.modelBytes > 0 && (
                        <span className="text-muted text-xs">{formatBytes(storage.modelBytes)} on disk</span>
                      )}
                    </>
                  ) : (
                    <>
                      <Badge>not installed</Badge>
                      <span className="text-muted text-xs">
                        one-time download, about {formatBytes(MODEL_DOWNLOAD_BYTES)}
                      </span>
                    </>
                  )}
                </dd>
                <dt className="text-muted">Storage</dt>
                <dd className="text-xs">
                  {storage.persisted
                    ? 'Persistent — the browser will not evict the model'
                    : 'Best effort — the browser may reclaim the model under storage pressure'}
                  {storage.quotaBytes > 0 && (
                    <span className="text-muted">
                      {' '}
                      · {formatBytes(storage.usageBytes)} of {formatBytes(storage.quotaBytes)} used
                    </span>
                  )}
                </dd>
              </dl>

              {status === 'error' && (
                <div className="border-danger/40 bg-danger-soft text-danger-soft-foreground rounded-lg border p-4 text-sm">
                  <p className="font-medium">Loading failed</p>
                  <p className="mt-1 break-words">{error}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onPress={() => void initialize()}>
                  {installed ? 'Start' : `Install model (${formatBytes(MODEL_DOWNLOAD_BYTES)})`}
                </Button>
                {installed && (
                  <Button variant="ghost" onPress={() => void removeModel()}>
                    Remove model
                  </Button>
                )}
              </div>
            </>
          )}

          {status === 'loading' && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                <Spinner size="sm" /> {loadMessage || 'Loading…'}
              </p>
              {total > 0 && (
                <>
                  <ProgressBar aria-label="Model download progress" value={percent} color="accent">
                    <ProgressBar.Track>
                      <ProgressBar.Fill />
                    </ProgressBar.Track>
                  </ProgressBar>
                  <p className="text-muted text-xs">
                    {formatBytes(loaded)} of {formatBytes(total)} · {Math.round(percent)}%
                  </p>
                </>
              )}
              <p className="text-muted text-xs">
                Downloading only happens once. Afterwards the model is served from this browser.
              </p>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  )
}
