import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { complete, severed, tail, truncated, weights } from '@/test/responses'

/**
 * Each test gets a database and a module registry of its own. The cache keeps a
 * connection, an in-flight map and a set of URLs it has given up on, all at
 * module scope — realistic in a tab, useless in a suite where one test's
 * failures would decide the next one's behaviour.
 */
let cache: typeof import('./idb-cache')
let resume: typeof import('./resume')
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  cache = await import('./idb-cache')
  resume = await import('./resume')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const URL_BASE = 'https://huggingface.co/onnx-community/Model/resolve/main/'
const WEIGHTS = weights(4096)

async function drain(response: Response | undefined): Promise<Uint8Array> {
  if (!response) throw new Error('nothing to read')
  return new Uint8Array(await response.arrayBuffer())
}

describe('idbCache downloads', () => {
  it('stores a download and serves back exactly what arrived', async () => {
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    const served = await drain(await cache.idbCache.match(`${URL_BASE}model.onnx_data`))

    expect(served).toEqual(WEIGHTS)
    expect(await cache.listIdbCachedFiles()).toEqual([
      { name: 'huggingface.co_onnx-community_Model_resolve_main_model.onnx_data', size: 4096 },
    ])
  })

  it('serves an installed file without going near the network', async () => {
    const url = `${URL_BASE}installed.onnx_data`
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))
    await drain(await cache.idbCache.match(url))

    const again = await drain(await cache.idbCache.match(url))

    expect(again).toEqual(WEIGHTS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports the size, which is what Transformers.js asks a cache for', async () => {
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    const response = await cache.idbCache.match(`${URL_BASE}sized.onnx_data`)

    expect(response?.headers.get('content-length')).toBe('4096')
  })

  it('resumes from what arrived when the connection drops mid-transfer', async () => {
    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 1000)).mockResolvedValueOnce(tail(WEIGHTS, 1000))

    const served = await drain(await cache.idbCache.match(`${URL_BASE}resumed.onnx_data`))

    expect(served).toEqual(WEIGHTS)
    // The second attempt asked only for the rest, so the first 1000 bytes were
    // not paid for twice.
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ headers: { Range: 'bytes=1000-' } })
  })

  it('keeps the partial for the next visit when every attempt fails', async () => {
    // A fresh response per call: a body can only be read once, and a mock that
    // hands back the same one would be testing the mock.
    fetchMock.mockImplementation(() => severed(WEIGHTS, 1000))

    const served = await cache.idbCache.match(`${URL_BASE}given-up.onnx_data`)

    expect(served).toBeUndefined()
    expect(await cache.listIdbCachedFiles()).toEqual([])
    // What arrived is still there, and is what the next attempt continues from.
    expect(await cache.listIdbPartialFiles()).toEqual([
      { name: 'huggingface.co_onnx-community_Model_resolve_main_given-up.onnx_data', size: 1000 },
    ])
  })

  it('starts again when the file changed upstream while a partial was stored', async () => {
    const replacement = weights(4096).fill(7)
    fetchMock
      .mockResolvedValueOnce(severed(WEIGHTS, 1000))
      // Same range, different file: splicing these together would corrupt it.
      .mockResolvedValueOnce(tail(replacement, 1000, '"a-different-etag"'))
      .mockResolvedValueOnce(complete(replacement, '"a-different-etag"'))

    const served = await drain(await cache.idbCache.match(`${URL_BASE}changed.onnx_data`))

    expect(served).toEqual(replacement)
  })

  it('starts again when the host ignores the range and sends the whole file', async () => {
    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 1000)).mockResolvedValueOnce(complete(WEIGHTS))

    const served = await drain(await cache.idbCache.match(`${URL_BASE}ignored-range.onnx_data`))

    expect(served).toEqual(WEIGHTS)
  })

  it('treats a body that stops short as unfinished rather than as a shorter file', async () => {
    fetchMock.mockImplementation(() => truncated(WEIGHTS, 3000))

    const served = await cache.idbCache.match(`${URL_BASE}short.onnx_data`)

    // Publishing this would hand Transformers.js 3000 bytes where it expects
    // 4096, and it zero-pads the difference — corrupt weights, loaded happily.
    expect(served).toBeUndefined()
    expect(await cache.listIdbCachedFiles()).toEqual([])
  })

  it('gives up on a URL that is not a download at all, without retrying it', async () => {
    fetchMock.mockImplementation(() => new Response('not found', { status: 404 }))

    expect(await cache.idbCache.match(`${URL_BASE}missing.onnx_data`)).toBeUndefined()
    expect(await cache.idbCache.match(`${URL_BASE}missing.onnx_data`)).toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves a local path alone, since it is not ours to go and fetch', async () => {
    expect(await cache.idbCache.match('/models/local/config.json')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports progress, since Transformers.js never sees this download', async () => {
    const url = `${URL_BASE}progress.onnx_data`
    const seen: import('./resume').DownloadProgress[] = []
    resume.setDownloadProgress((progress) => void seen.push(progress))
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    await drain(await cache.idbCache.match(url))

    expect(seen.at(-1)).toEqual({ url, loaded: WEIGHTS.length, total: WEIGHTS.length })
  })
})

/**
 * A 448 MB file is a hundred-odd records, and everything about reassembly and
 * resumption only happens once there is more than one. The record size is a
 * parameter for exactly this: 1 KB here is the same code path 4 MB takes in a
 * browser, at a size a fake IndexedDB can clone in reasonable time.
 */
describe('idbCache across several records', () => {
  const CHUNK = 1024
  const BIG = weights(CHUNK * 3 + 500)

  it('splits a file across records and reassembles it in order', async () => {
    const chunked = cache.createIdbCache(CHUNK)
    fetchMock.mockResolvedValueOnce(complete(BIG))

    const served = await drain(await chunked.match(`${URL_BASE}big.onnx_data`))

    expect(served).toEqual(BIG)
  })

  it('keeps the tail of an interrupted transfer as a short record', async () => {
    const chunked = cache.createIdbCache(CHUNK)
    // The connection dies 700 bytes into the third record. Those 700 bytes are
    // committed on the way out rather than thrown away, so the resume asks for
    // the byte after them and not for the start of the record.
    const died = CHUNK * 2 + 700
    fetchMock.mockResolvedValueOnce(severed(BIG, died)).mockResolvedValueOnce(tail(BIG, died))

    const served = await drain(await chunked.match(`${URL_BASE}big-resumed.onnx_data`))

    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ headers: { Range: `bytes=${died}-` } })
    // Records of unequal size still reassemble: each one knows its position.
    expect(served).toEqual(BIG)
  })

  it('counts a part-written file as partial, never as installed', async () => {
    const chunked = cache.createIdbCache(CHUNK)
    const died = CHUNK * 2 + 700
    fetchMock.mockImplementation(() => severed(BIG, died))

    expect(await chunked.match(`${URL_BASE}big-stalled.onnx_data`)).toBeUndefined()
    expect(await cache.listIdbCachedFiles()).toEqual([])
    expect((await cache.listIdbPartialFiles()).map((file) => file.size)).toEqual([died])
  })
})

describe('idbCache.put', () => {
  it('stores a file Transformers.js downloaded itself', async () => {
    const url = `${URL_BASE}handed-over.json`

    await cache.idbCache.put(url, complete(WEIGHTS))

    expect(await drain(await cache.idbCache.match(url))).toEqual(WEIGHTS)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports progress to the caller that asked for it', async () => {
    const seen: number[] = []

    await cache.idbCache.put(`${URL_BASE}watched.json`, complete(WEIGHTS), ({ loaded }) => seen.push(loaded))

    expect(seen.at(-1)).toBe(WEIGHTS.length)
  })

  it('keeps nothing when the body fails half way, rather than half a file', async () => {
    const url = `${URL_BASE}broken.json`

    await expect(cache.idbCache.put(url, severed(WEIGHTS, 1000))).rejects.toThrow()

    expect(await cache.listIdbCachedFiles()).toEqual([])
    expect(await cache.listIdbPartialFiles()).toEqual([])
  })
})

describe('idbCache.delete', () => {
  it('removes a stored file and says so', async () => {
    const url = `${URL_BASE}unwanted.onnx_data`
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))
    await drain(await cache.idbCache.match(url))

    expect(await cache.idbCache.delete(url)).toBe(true)
    expect(await cache.listIdbCachedFiles()).toEqual([])
  })

  it('reports nothing removed for a file it never had', async () => {
    expect(await cache.idbCache.delete(`${URL_BASE}never-had.onnx_data`)).toBe(false)
  })
})

describe('clearIdbCachedFiles', () => {
  it('removes unfinished downloads too, since they hold the space back', async () => {
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))
    await drain(await cache.idbCache.match(`${URL_BASE}keeper.onnx_data`))
    fetchMock.mockImplementation(() => severed(WEIGHTS, 1000))
    await cache.idbCache.match(`${URL_BASE}half.onnx_data`)

    await cache.clearIdbCachedFiles((name) => name.includes('half'))

    expect(await cache.listIdbPartialFiles()).toEqual([])
    expect((await cache.listIdbCachedFiles()).map((file) => file.size)).toEqual([4096])
  })

  it('leaves entries the predicate did not match', async () => {
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))
    await drain(await cache.idbCache.match(`${URL_BASE}other-model.onnx_data`))

    await cache.clearIdbCachedFiles((name) => name.includes('some-other-thing'))

    expect(await cache.listIdbCachedFiles()).toHaveLength(1)
  })
})
