import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { complete, weights } from '@/test/responses'

let cache: typeof import('./model-cache')
let idb: typeof import('./idb-cache')

/** OPFS as far as `opfsAvailable` is concerned, which is all these tests need. */
function withOpfs(present: boolean): void {
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: present ? { getDirectory: async () => ({ getDirectoryHandle: async () => ({}) }) } : {},
  })
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.resetModules()
  cache = await import('./model-cache')
  idb = await import('./idb-cache')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('modelCacheBackend', () => {
  it('prefers OPFS, which is where 448 MB belongs', () => {
    withOpfs(true)
    expect(cache.modelCacheBackend()).toBe('opfs')
  })

  it('falls back to IndexedDB rather than to a Cache API that cannot hold the file', () => {
    withOpfs(false)
    expect(cache.modelCacheBackend()).toBe('indexeddb')
    expect(cache.modelCache()).not.toBeNull()
  })

  it('has nowhere to put the weights when the browser offers neither', () => {
    withOpfs(false)
    vi.stubGlobal('indexedDB', undefined)

    expect(cache.modelCacheBackend()).toBe('none')
    // Transformers.js then caches the file its own way, as it did before any of
    // this existed — which for the weights means downloading them every visit.
    expect(cache.modelCache()).toBeNull()
  })
})

describe('what the gate screen is told', () => {
  it('reports the files of the backend that will actually be read', async () => {
    withOpfs(false)
    await idb.idbCache.put('https://host/model.onnx_data', complete(weights(2048)))

    expect(await cache.listModelFiles()).toEqual([{ name: 'host_model.onnx_data', size: 2048 }])
  })

  it('does not offer a browser files the loader cannot reach', async () => {
    // Installed into IndexedDB, then opened somewhere OPFS works — a private
    // window that was reopened as a normal one. Announcing 448 MB as installed
    // would send the user to a Start button that silently re-downloads.
    withOpfs(false)
    await idb.idbCache.put('https://host/model.onnx_data', complete(weights(2048)))
    withOpfs(true)

    expect(await cache.listModelFiles()).toEqual([])
  })
})

describe('clearModelFiles', () => {
  it('empties every backend, not only the one in use', async () => {
    withOpfs(false)
    await idb.idbCache.put('https://host/model.onnx_data', complete(weights(2048)))
    withOpfs(true)

    // "Remove model" is a promise about disk space. A copy in the store this
    // browser stopped using is still occupying it.
    await cache.clearModelFiles((name) => name.includes('model.onnx_data'))

    expect(await idb.listIdbCachedFiles()).toEqual([])
  })
})
