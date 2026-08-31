import { useEffect, useState, type ReactNode } from 'react'
import { Alert } from '@heroui/react/alert'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Description } from '@heroui/react/description'
import { FieldError } from '@heroui/react/field-error'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { Link } from '@heroui/react/link'
import { Meter } from '@heroui/react/meter'
import { ProgressBar } from '@heroui/react/progress-bar'
import { Spinner } from '@heroui/react/spinner'
import { TextField } from '@heroui/react/textfield'
import { MODEL_DOWNLOAD_BYTES, MODEL_ID } from '@/llm/config'
import { detectWebGpu, type GpuCapability } from '@/lib/webgpu'
import { formatBytes } from '@/lib/format'
import { hasRoomFor } from '@/lib/storage'
import { isHttpUrl } from '@/tools/mcp'
import { useChatStore } from '@/store/chat'

/** One row of the specification list, so the labels stay in one column. */
function Row({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-x-4 gap-y-1 py-2.5">
      <dt className="text-xs text-muted uppercase tracking-wide">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/**
 * The landing page's call to action. Hosted chat (Claude Opus on the tool
 * proxy) starts with no download. The on-device path still shows the GPU
 * check, the storage figures, and the 448 MB install.
 */
export function InstallPanel() {
  const [gpu, setGpu] = useState<GpuCapability | null>(null)
  const {
    status,
    loadMessage,
    loadProgress,
    error,
    storage,
    hostedChat,
    initialize,
    refreshStorage,
    removeModel,
    probeHosted,
    webAccess,
    setWebAccess,
  } = useChatStore()

  useEffect(() => {
    void detectWebGpu().then(setGpu)
    void refreshStorage()
    void probeHosted()
  }, [refreshStorage, probeHosted])

  const loaded = loadProgress.reduce((sum, file) => sum + file.loaded, 0)
  const total = loadProgress.reduce((sum, file) => sum + file.total, 0)
  const percent = total > 0 ? Math.min((loaded / total) * 100, 100) : 0
  const installed = storage.modelCached
  // Better to say the download will not fit than to spend ten minutes finding out.
  const freeBytes = storage.quotaBytes - storage.usageBytes
  const tooLittleRoom = !installed && !hasRoomFor(storage, MODEL_DOWNLOAD_BYTES)
  // An earlier attempt that died part way through is not lost work: the next one
  // continues from it, so the gate offers to resume rather than to start again.
  const resumeBytes = installed ? 0 : storage.partialBytes
  const remainingBytes = Math.max(MODEL_DOWNLOAD_BYTES - resumeBytes, 0)
  const typedProxy = webAccess.proxyUrl ?? ''
  const badProxy = typedProxy.trim().length > 0 && !isHttpUrl(typedProxy.trim())
  const hosted = hostedChat !== null

  return (
    <div className="glass relative overflow-hidden rounded-3xl border border-border/70 p-5 text-start shadow-2xl shadow-black/10 sm:p-6">
      {/* A filament of brand colour along the top edge, so the panel reads as
          the lit part of the page rather than another card. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-6 top-0 h-px bg-linear-to-r from-transparent via-brand to-transparent"
      />

      <div className="space-y-5">
        {gpu === null && !hosted && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" /> Checking GPU support…
          </p>
        )}

        {gpu?.supported === false && !hosted && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>WebGPU is unavailable</Alert.Title>
              <Alert.Description>
                {gpu.reason} On-device generation has no CPU fallback.{' '}
                <Link href="https://caniuse.com/webgpu" rel="noreferrer noopener" target="_blank">
                  Which browsers support WebGPU
                  <Link.Icon />
                </Link>
                . Paste a tool proxy with Claude Opus below to chat without a GPU.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {hosted && status !== 'loading' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button className="grow" size="lg" variant="primary" onPress={() => void initialize()}>
                {status === 'error' ? 'Try again' : 'Start chatting'}
              </Button>
            </div>
            {status === 'error' && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Could not reach the hosted model</Alert.Title>
                  <Alert.Description className="break-words">{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
            <dl className="divide-y divide-separator border-t border-separator">
              <Row label="Model">
                <span className="font-mono text-xs break-all">{hostedChat.model}</span>
              </Row>
              <Row label="Path">Hosted via the tool proxy — nothing downloads to this browser</Row>
            </dl>
          </>
        )}

        {!hosted && gpu?.supported && status !== 'loading' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button className="grow" size="lg" variant="primary" onPress={() => void initialize()}>
                {installed
                  ? status === 'error'
                    ? 'Try again'
                    : 'Start'
                  : resumeBytes > 0
                    ? `Resume install (${formatBytes(remainingBytes)} left)`
                    : `Install model (${formatBytes(MODEL_DOWNLOAD_BYTES)})`}
              </Button>
              {(installed || resumeBytes > 0) && (
                <Button variant="ghost" onPress={() => void removeModel()}>
                  {installed ? 'Remove model' : 'Discard download'}
                </Button>
              )}
            </div>

            {tooLittleRoom && (
              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>There may not be room for the download</Alert.Title>
                  <Alert.Description>
                    The model needs about {formatBytes(MODEL_DOWNLOAD_BYTES)} and this browser has{' '}
                    {formatBytes(freeBytes)} left. Free some space first, or expect the install to fail part
                    way through.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {status === 'error' && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Loading failed</Alert.Title>
                  <Alert.Description className="break-words">{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <dl className="divide-y divide-separator border-t border-separator">
              <Row label="Model">
                <span className="font-mono text-xs break-all">{MODEL_ID}</span>
              </Row>
              <Row label="GPU">{gpu.adapter ?? 'detected'}</Row>
              <Row label="Status">
                <div className="flex flex-wrap items-center gap-1.5">
                  {installed ? (
                    <>
                      <Chip color="success" variant="soft">
                        installed
                      </Chip>
                      {storage.modelBytes > 0 && (
                        <span className="text-muted text-xs">{formatBytes(storage.modelBytes)} on disk</span>
                      )}
                    </>
                  ) : resumeBytes > 0 ? (
                    <>
                      <Chip color="warning" variant="soft">
                        partly downloaded
                      </Chip>
                      <span className="text-muted text-xs">
                        {formatBytes(resumeBytes)} of {formatBytes(MODEL_DOWNLOAD_BYTES)} saved — the rest
                        picks up where it stopped
                      </span>
                    </>
                  ) : (
                    <>
                      <Chip variant="soft">not installed</Chip>
                      <span className="text-muted text-xs">
                        one-time download, about {formatBytes(MODEL_DOWNLOAD_BYTES)}
                      </span>
                    </>
                  )}
                </div>
              </Row>
              <Row label="Storage">
                <div className="space-y-2 text-xs">
                  <p>
                    {storage.persisted
                      ? 'Persistent — the browser will not evict the model'
                      : 'Best effort — the browser may reclaim the model under storage pressure'}
                  </p>
                  {/* Only worth a line when it is not the usual one: this
                      browser has no private file system, and the fallback is
                      slower to write. Saying so beats an unexplained wait. */}
                  {storage.backend === 'indexeddb' && (
                    <p>Kept in IndexedDB — this browser has no private file system to stream it to</p>
                  )}
                  {/* A Meter, not a ProgressBar: this is a standing measurement
                      against a known ceiling, not a task working its way to done. */}
                  {storage.quotaBytes > 0 && (
                    <Meter
                      aria-label="Browser storage used"
                      color={tooLittleRoom ? 'danger' : 'accent'}
                      maxValue={storage.quotaBytes}
                      value={storage.usageBytes}
                    >
                      <Meter.Output className="text-xs text-muted">
                        {formatBytes(freeBytes)} free of {formatBytes(storage.quotaBytes)}
                      </Meter.Output>
                      <Meter.Track>
                        <Meter.Fill />
                      </Meter.Track>
                    </Meter>
                  )}
                </div>
              </Row>
            </dl>
          </>
        )}

        {status !== 'loading' && (
          <TextField
            isInvalid={badProxy}
            type="url"
            value={typedProxy}
            onChange={(value) => setWebAccess({ ...webAccess, proxyUrl: value })}
          >
            <Label>Tool proxy URL</Label>
            <Input placeholder="https://your-proxy.up.railway.app" />
            <Description>
              {hosted
                ? `Using ${hostedChat.base || 'this origin'} for Claude Opus. Visitors do not paste an API key.`
                : 'Optional. A proxy with ANTHROPIC_API_KEY starts a hosted model instead of the on-device download.'}
            </Description>
            <FieldError>Needs a full http:// or https:// address.</FieldError>
          </TextField>
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
                    <ProgressBar.Fill className="progress-sheen" />
                  </ProgressBar.Track>
                </ProgressBar>
                <p className="text-muted text-xs">
                  {formatBytes(loaded)} of {formatBytes(total)} · {Math.round(percent)}%
                </p>
              </>
            )}
            <p className="text-muted text-xs">
              {hosted
                ? 'Connecting to the hosted model. Nothing is downloaded to this browser.'
                : 'Downloading only happens once. Afterwards the model is served from this browser, and a transfer that is interrupted continues from where it stopped rather than starting again.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
