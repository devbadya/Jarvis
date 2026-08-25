import {
  clearModelFiles,
  listModelFiles,
  listModelPartials,
  modelCacheBackend,
  type CacheBackendName,
} from '@/llm/model-cache'
import { cacheKeyFor } from '@/llm/resume'

/**
 * Model weights live in the Origin Private File System, or in IndexedDB where a
 * browser has no usable OPFS (see `llm/model-cache.ts`).
 *
 * Either way, without an explicit persistence grant the browser treats that data
 * as "best effort" and may evict it under storage pressure — which for a 448 MB
 * download means an unexpected re-download. `navigator.storage.persist()` moves
 * the origin to "persistent", after which only the user can clear it. The grant
 * covers the whole origin, so it protects both stores at once.
 */

export interface StorageStatus {
  /** Whether the browser promised not to evict this origin's data. */
  persisted: boolean
  /** Where the weights are kept in this browser. */
  backend: CacheBackendName
  /** True once the weights are on disk, not merely some of the model's files. */
  modelCached: boolean
  modelBytes: number
  /** Bytes of an unfinished download the next attempt will continue from. */
  partialBytes: number
  usageBytes: number
  quotaBytes: number
}

export const EMPTY_STORAGE_STATUS: StorageStatus = {
  persisted: false,
  backend: 'none',
  modelCached: false,
  modelBytes: 0,
  partialBytes: 0,
  usageBytes: 0,
  quotaBytes: 0,
}

/**
 * Whether a download of `bytes` plausibly fits. A quota of zero means the
 * browser declined to say, which is not the same as saying no — assume room
 * rather than block an install over a number nobody supplied.
 */
export function hasRoomFor(status: StorageStatus, bytes: number): boolean {
  if (status.quotaBytes <= 0) return true
  return status.quotaBytes - status.usageBytes >= bytes
}

function storageApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator
}

/**
 * Asks the browser to make this origin's storage persistent. Chrome grants it
 * silently for installed PWAs and sufficiently engaged sites, and denies it
 * otherwise without prompting, so a `false` result is not an error.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!storageApiAvailable() || !navigator.storage.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** Cache keys are flattened URLs, so the model id survives as a substring. */
function modelFilePrefix(modelId: string): string {
  return cacheKeyFor(modelId)
}

/**
 * What is on disk for `modelId`.
 *
 * `weightsFile` decides what counts as installed. Any one of the model's seven
 * files being present is not enough: a run that fetched the tokenizer and then
 * lost the connection would report itself installed, and pressing Start would
 * quietly begin the 448 MB download again.
 */
export async function getStorageStatus(modelId: string, weightsFile: string): Promise<StorageStatus> {
  if (!storageApiAvailable()) return EMPTY_STORAGE_STATUS

  try {
    const [persisted, estimate, files, partials] = await Promise.all([
      navigator.storage.persisted?.() ?? Promise.resolve(false),
      navigator.storage.estimate?.() ?? Promise.resolve({}),
      listModelFiles(),
      listModelPartials(),
    ])

    const needle = modelFilePrefix(modelId)
    const belongs = (name: string): boolean => name.includes(needle)
    const modelFiles = files.filter((file) => belongs(file.name))
    const weightsKey = cacheKeyFor(weightsFile)

    return {
      persisted,
      backend: modelCacheBackend(),
      modelCached: modelFiles.some((file) => file.name.endsWith(weightsKey)),
      modelBytes: modelFiles.reduce((sum, file) => sum + file.size, 0),
      partialBytes: partials.filter((file) => belongs(file.name)).reduce((sum, file) => sum + file.size, 0),
      usageBytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? 0,
    }
  } catch {
    return EMPTY_STORAGE_STATUS
  }
}

/** Frees the weights again, unfinished downloads included. The next load re-downloads them. */
export async function deleteModel(modelId: string): Promise<void> {
  const needle = modelFilePrefix(modelId)
  await clearModelFiles((name) => name.includes(needle))
}
