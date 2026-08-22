import { cacheKeyFor, clearCachedFiles, listCachedFiles } from '@/llm/opfs-cache'

/**
 * Model weights live in the Origin Private File System (see `llm/opfs-cache.ts`).
 *
 * Without an explicit persistence grant the browser treats that data as "best
 * effort" and may evict it under storage pressure — which for a 448 MB download
 * means an unexpected re-download. `navigator.storage.persist()` moves the origin
 * to "persistent", after which only the user can clear it.
 */

export interface StorageStatus {
  /** Whether the browser promised not to evict this origin's data. */
  persisted: boolean
  /** True once the model's files are on disk. */
  modelCached: boolean
  modelBytes: number
  usageBytes: number
  quotaBytes: number
}

export const EMPTY_STORAGE_STATUS: StorageStatus = {
  persisted: false,
  modelCached: false,
  modelBytes: 0,
  usageBytes: 0,
  quotaBytes: 0,
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

/** OPFS filenames are flattened URLs, so the model id survives as a substring. */
function modelFilePrefix(modelId: string): string {
  return cacheKeyFor(modelId)
}

export async function getStorageStatus(modelId: string): Promise<StorageStatus> {
  if (!storageApiAvailable()) return EMPTY_STORAGE_STATUS

  try {
    const [persisted, estimate, files] = await Promise.all([
      navigator.storage.persisted?.() ?? Promise.resolve(false),
      navigator.storage.estimate?.() ?? Promise.resolve({}),
      listCachedFiles(),
    ])

    const needle = modelFilePrefix(modelId)
    const modelFiles = files.filter((file) => file.name.includes(needle))

    return {
      persisted,
      modelCached: modelFiles.length > 0,
      modelBytes: modelFiles.reduce((sum, file) => sum + file.size, 0),
      usageBytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? 0,
    }
  } catch {
    return EMPTY_STORAGE_STATUS
  }
}

/** Frees the weights again. The next load re-downloads them. */
export async function deleteModel(modelId: string): Promise<void> {
  const needle = modelFilePrefix(modelId)
  await clearCachedFiles((name) => name.includes(needle))
}
