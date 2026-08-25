/**
 * Which store the weights live in.
 *
 * OPFS first, always, where the browser has it: it takes raw bytes without a
 * structured-clone copy, writes through a synchronous handle and can be written
 * at an offset. IndexedDB is the fallback, and it exists because the previous
 * fallback was the Cache API, which cannot hold a 448 MB file in Chrome at all —
 * so a browser without OPFS re-downloaded the model on every visit.
 */

import {
  clearIdbCachedFiles,
  idbCache,
  idbCacheAvailable,
  listIdbCachedFiles,
  listIdbPartialFiles,
} from './idb-cache'
import { clearCachedFiles, listCachedFiles, listPartialFiles, opfsAvailable, opfsCache } from './opfs-cache'
import type { CachedFile, ModelCacheBackend } from './resume'

export type CacheBackendName = 'opfs' | 'indexeddb' | 'none'

export function modelCacheBackend(): CacheBackendName {
  if (opfsAvailable()) return 'opfs'
  if (idbCacheAvailable()) return 'indexeddb'
  return 'none'
}

/** The backend this browser will actually use, or null when it has neither. */
export function modelCache(): ModelCacheBackend | null {
  const backend = modelCacheBackend()
  if (backend === 'opfs') return opfsCache
  if (backend === 'indexeddb') return idbCache
  return null
}

/**
 * What is stored *and reachable*, which is the active backend and only it.
 *
 * Reporting both would mean the gate screen announcing an installed model that
 * the loader is not going to find — a browser that gains OPFS after installing
 * into IndexedDB has to be told it is downloading again, not shown a reassuring
 * 448 MB it cannot use.
 */
export async function listModelFiles(): Promise<CachedFile[]> {
  return modelCacheBackend() === 'indexeddb' ? listIdbCachedFiles() : listCachedFiles()
}

export async function listModelPartials(): Promise<CachedFile[]> {
  return modelCacheBackend() === 'indexeddb' ? listIdbPartialFiles() : listPartialFiles()
}

/**
 * Deleting is the other way round: every backend, whichever one is active.
 * "Remove model" is a promise about disk space, and a copy left in the store
 * this browser stopped using would still be occupying it.
 */
export async function clearModelFiles(predicate: (name: string) => boolean): Promise<void> {
  await clearCachedFiles(predicate)
  await clearIdbCachedFiles(predicate)
}
