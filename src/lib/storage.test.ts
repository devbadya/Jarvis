import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteModel, getStorageStatus, hasRoomFor, requestPersistence, type StorageStatus } from './storage'

const MODEL = 'onnx-community/Qwen3.5-0.8B-Text-ONNX'
const WEIGHTS = 'onnx/model_q4f16.onnx_data'
const PREFIX = `huggingface.co_${MODEL.replace(/[^a-zA-Z0-9._-]/g, '_')}_resolve_main_`

/** Stand-in for the OPFS directory handle; jsdom implements neither OPFS nor StorageManager. */
function fakeOpfs(files: Record<string, number>) {
  const store = new Map(Object.entries(files))
  const directory = {
    kind: 'directory' as const,
    removeEntry: vi.fn(async (name: string) => {
      if (!store.delete(name)) throw new Error('NotFoundError')
    }),
    [Symbol.asyncIterator]: async function* () {
      for (const [name, size] of store) {
        yield [name, { kind: 'file', getFile: async () => ({ size }) }] as const
      }
    },
  }
  return {
    store,
    getDirectory: vi.fn(async () => ({
      getDirectoryHandle: vi.fn(async () => directory),
    })),
  }
}

function stubNavigatorStorage(opfs: ReturnType<typeof fakeOpfs>, overrides: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => true),
      estimate: vi.fn(async () => ({ usage: 500_000_000, quota: 2_000_000_000 })),
      getDirectory: opfs.getDirectory,
      ...overrides,
    },
  })
}

let opfs: ReturnType<typeof fakeOpfs>

beforeEach(() => {
  // Filenames mirror how the OPFS cache flattens a download URL.
  opfs = fakeOpfs({
    [`${PREFIX}onnx_model_q4f16.onnx_data`]: 400,
    [`${PREFIX}tokenizer.json`]: 48,
    'huggingface.co_some-other-model_resolve_main_model.onnx': 999,
  })
  stubNavigatorStorage(opfs)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestPersistence', () => {
  it('asks the browser only when not already persisted', async () => {
    const persist = vi.fn(async () => true)
    stubNavigatorStorage(opfs, { persisted: vi.fn(async () => false), persist })
    await expect(requestPersistence()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('skips the request when persistence is already granted', async () => {
    const persist = vi.fn(async () => true)
    stubNavigatorStorage(opfs, { persisted: vi.fn(async () => true), persist })
    await expect(requestPersistence()).resolves.toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('treats a refusal as a normal outcome rather than an error', async () => {
    stubNavigatorStorage(opfs, { persisted: vi.fn(async () => false), persist: vi.fn(async () => false) })
    await expect(requestPersistence()).resolves.toBe(false)
  })
})

describe('getStorageStatus', () => {
  it('counts only the files belonging to the requested model', async () => {
    const status = await getStorageStatus(MODEL, WEIGHTS)
    expect(status.modelCached).toBe(true)
    expect(status.modelBytes).toBe(448)
  })

  it('reports quota usage from the storage estimate', async () => {
    const status = await getStorageStatus(MODEL, WEIGHTS)
    expect(status.usageBytes).toBe(500_000_000)
    expect(status.quotaBytes).toBe(2_000_000_000)
  })

  it('reports an uninstalled model when nothing is cached', async () => {
    const empty = fakeOpfs({})
    stubNavigatorStorage(empty)
    const status = await getStorageStatus(MODEL, WEIGHTS)
    expect(status.modelCached).toBe(false)
    expect(status.modelBytes).toBe(0)
    expect(status.partialBytes).toBe(0)
  })

  it('is not installed on the strength of the small files alone', async () => {
    stubNavigatorStorage(fakeOpfs({ [`${PREFIX}tokenizer.json`]: 48 }))
    const status = await getStorageStatus(MODEL, WEIGHTS)
    expect(status.modelCached).toBe(false)
  })

  it('reports an unfinished download as bytes the next attempt starts from', async () => {
    stubNavigatorStorage(
      fakeOpfs({
        [`${PREFIX}tokenizer.json`]: 48,
        [`${PREFIX}onnx_model_q4f16.onnx_data.part`]: 300,
        [`${PREFIX}onnx_model_q4f16.onnx_data.part-meta`]: 60,
      }),
    )
    const status = await getStorageStatus(MODEL, WEIGHTS)
    expect(status.modelCached).toBe(false)
    expect(status.partialBytes).toBe(300)
    // Nothing half-written is counted as installed weight.
    expect(status.modelBytes).toBe(48)
  })
})

describe('hasRoomFor', () => {
  const status = (usageBytes: number, quotaBytes: number): StorageStatus => ({
    persisted: false,
    modelCached: false,
    modelBytes: 0,
    partialBytes: 0,
    usageBytes,
    quotaBytes,
  })

  it('has room when the free space covers the download', () => {
    expect(hasRoomFor(status(100, 1000), 500)).toBe(true)
    expect(hasRoomFor(status(100, 1000), 900)).toBe(true)
  })

  it('has no room when the download would overrun the quota', () => {
    expect(hasRoomFor(status(600, 1000), 500)).toBe(false)
  })

  it('assumes room when the browser reported no quota at all', () => {
    expect(hasRoomFor(status(0, 0), 500_000_000)).toBe(true)
  })
})

describe('deleteModel', () => {
  it('removes the model files and leaves other entries untouched', async () => {
    await deleteModel(MODEL)
    expect([...opfs.store.keys()]).toEqual(['huggingface.co_some-other-model_resolve_main_model.onnx'])
  })

  it('reclaims an unfinished download as well as the installed files', async () => {
    const withPartial = fakeOpfs({
      [`${PREFIX}onnx_model_q4f16.onnx_data.part`]: 300,
      [`${PREFIX}onnx_model_q4f16.onnx_data.part-meta`]: 60,
    })
    stubNavigatorStorage(withPartial)
    await deleteModel(MODEL)
    expect([...withPartial.store.keys()]).toEqual([])
  })
})
