import { useEffect, useState, type ReactNode } from 'react'
import { Alert } from '@heroui/react/alert'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Link } from '@heroui/react/link'
import { Meter } from '@heroui/react/meter'
import { ProgressBar } from '@heroui/react/progress-bar'
import { Spinner } from '@heroui/react/spinner'
import { useT } from '@/i18n'
import { MODEL_DOWNLOAD_BYTES, MODEL_ID } from '@/llm/config'
import { detectWebGpu, type GpuCapability } from '@/lib/webgpu'
import { formatBytes } from '@/lib/format'
import { hasRoomFor } from '@/lib/storage'
import { useChatStore } from '@/store/chat'

/** One row of the specification list, so the labels stay in one column. */
function Row({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-x-4 gap-y-1 py-2.5">
      <dt className="text-[0.68rem] tracking-[0.16em] text-muted uppercase">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/**
 * Everything the one-time download needs to be legible: whether this browser can
 * run the model at all, what is already on disk, whether there is room for the
 * rest, and the button that starts it.
 *
 * It is the landing page's call to action, which is why it carries no heading of
 * its own — the hero above it already said what this is.
 */
export function InstallPanel() {
  const [gpu, setGpu] = useState<GpuCapability | null>(null)
  const { status, loadMessage, loadProgress, error, storage, initialize, refreshStorage, removeModel } =
    useChatStore()
  const t = useT()

  useEffect(() => {
    void detectWebGpu().then(setGpu)
    void refreshStorage()
  }, [refreshStorage])

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

  return (
    <div className="glass edge-beam relative overflow-hidden rounded-3xl border border-border/70 p-5 text-start shadow-2xl shadow-black/15 sm:p-6">
      <div className="space-y-5">
        {gpu === null && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" /> {t('install.checkingGpu')}
          </p>
        )}

        {gpu?.supported === false && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('install.noWebGpu.title')}</Alert.Title>
              <Alert.Description>
                {gpu.reason} {t('install.noWebGpu.body')}{' '}
                <Link href="https://caniuse.com/webgpu" rel="noreferrer noopener" target="_blank">
                  {t('install.noWebGpu.link')}
                  <Link.Icon />
                </Link>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {gpu?.supported && status !== 'loading' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button className="grow" size="lg" variant="primary" onPress={() => void initialize()}>
                {installed
                  ? status === 'error'
                    ? t('install.tryAgain')
                    : t('install.start')
                  : resumeBytes > 0
                    ? t('install.resume', { left: formatBytes(remainingBytes) })
                    : t('install.install', { size: formatBytes(MODEL_DOWNLOAD_BYTES) })}
              </Button>
              {(installed || resumeBytes > 0) && (
                <Button variant="ghost" onPress={() => void removeModel()}>
                  {installed ? t('install.remove') : t('install.discard')}
                </Button>
              )}
            </div>

            {tooLittleRoom && (
              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{t('install.noRoom.title')}</Alert.Title>
                  <Alert.Description>
                    {t('install.noRoom.body', {
                      needed: formatBytes(MODEL_DOWNLOAD_BYTES),
                      free: formatBytes(freeBytes),
                    })}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {status === 'error' && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{t('install.failed.title')}</Alert.Title>
                  <Alert.Description className="break-words">{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <dl className="divide-y divide-separator border-t border-separator">
              <Row label={t('install.row.model')}>
                <span className="font-mono text-xs break-all">{MODEL_ID}</span>
              </Row>
              <Row label={t('install.row.gpu')}>{gpu.adapter ?? t('install.gpu.detected')}</Row>
              <Row label={t('install.row.status')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {installed ? (
                    <>
                      <Chip color="success" variant="soft">
                        {t('install.status.installed')}
                      </Chip>
                      {storage.modelBytes > 0 && (
                        <span className="text-muted text-xs">
                          {t('install.status.onDisk', { size: formatBytes(storage.modelBytes) })}
                        </span>
                      )}
                    </>
                  ) : resumeBytes > 0 ? (
                    <>
                      <Chip color="warning" variant="soft">
                        {t('install.status.partly')}
                      </Chip>
                      <span className="text-muted text-xs">
                        {t('install.status.partlyDetail', {
                          saved: formatBytes(resumeBytes),
                          total: formatBytes(MODEL_DOWNLOAD_BYTES),
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <Chip variant="soft">{t('install.status.notInstalled')}</Chip>
                      <span className="text-muted text-xs">
                        {t('install.status.oneTime', { size: formatBytes(MODEL_DOWNLOAD_BYTES) })}
                      </span>
                    </>
                  )}
                </div>
              </Row>
              <Row label={t('install.row.storage')}>
                <div className="space-y-2 text-xs">
                  <p>
                    {storage.persisted ? t('install.storage.persisted') : t('install.storage.bestEffort')}
                  </p>
                  {/* Only worth a line when it is not the usual one: this
                      browser has no private file system, and the fallback is
                      slower to write. Saying so beats an unexplained wait. */}
                  {storage.backend === 'indexeddb' && <p>{t('install.storage.indexeddb')}</p>}
                  {/* A Meter, not a ProgressBar: this is a standing measurement
                      against a known ceiling, not a task working its way to done. */}
                  {storage.quotaBytes > 0 && (
                    <Meter
                      aria-label={t('install.storage.meter')}
                      color={tooLittleRoom ? 'danger' : 'accent'}
                      maxValue={storage.quotaBytes}
                      value={storage.usageBytes}
                    >
                      <Meter.Output className="text-xs text-muted">
                        {t('install.storage.free', {
                          free: formatBytes(freeBytes),
                          total: formatBytes(storage.quotaBytes),
                        })}
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

        {status === 'loading' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <Spinner size="sm" /> {loadMessage || t('install.loading')}
            </p>
            {total > 0 && (
              <>
                <ProgressBar aria-label={t('install.progress')} value={percent} color="accent">
                  <ProgressBar.Track>
                    <ProgressBar.Fill className="progress-sheen" />
                  </ProgressBar.Track>
                </ProgressBar>
                <p className="text-muted text-xs">
                  {t('install.progressText', {
                    loaded: formatBytes(loaded),
                    total: formatBytes(total),
                    percent: Math.round(percent),
                  })}
                </p>
              </>
            )}
            <p className="text-muted text-xs">{t('install.onceNote')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
