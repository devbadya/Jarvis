import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheKeyFor,
  clearCachedFiles,
  listCachedFiles,
  listPartialFiles,
  opfsCache,
  planWrite,
  type ResumeMeta,
} from './opfs-cache'

describe('cacheKeyFor', () => {
  it('flattens a download URL into a safe filename', () => {
    expect(
      cacheKeyFor('https://huggingface.co/onnx-community/Model/resolve/main/onnx/model_q4f16.onnx'),
    ).toBe('huggingface.co_onnx-community_Model_resolve_main_onnx_model_q4f16.onnx')
  })

  it('keeps the model id recognisable so cached files can be attributed', () => {
    const key = cacheKeyFor(
      'https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX/resolve/main/x.json',
    )
    expect(key).toContain(cacheKeyFor('onnx-community/Qwen3.5-0.8B-Text-ONNX'))
  })

  it('produces distinct keys for distinct URLs', () => {
    expect(cacheKeyFor('https://a.co/x/model.onnx')).not.toBe(cacheKeyFor('https://a.co/y/model.onnx'))
  })

  it('strips characters that are not filename-safe', () => {
    expect(cacheKeyFor('https://host/a?b=c#d')).toBe('host_a_b_c_d')
  })
})

describe('planWrite', () => {
  const meta: ResumeMeta = { etag: '"abc"', total: 1000 }

  it('starts from zero when the whole file arrives', () => {
    expect(
      planWrite({ status: 200, etag: '"abc"', contentRange: null, contentLength: '1000' }, 600, meta),
    ).toEqual({ start: 0, total: 1000 })
  })

  it('continues the partial when the range matches it exactly', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 600-999/1000', contentLength: '400' },
        600,
        meta,
      ),
    ).toEqual({ start: 600, total: 1000 })
  })

  it('refuses a range whose entity tag no longer matches the saved bytes', () => {
    expect(
      planWrite(
        { status: 206, etag: '"changed"', contentRange: 'bytes 600-999/1000', contentLength: '400' },
        600,
        meta,
      ),
    ).toBeNull()
  })

  it('refuses a range that belongs to a differently sized file', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 600-1199/1200', contentLength: '600' },
        600,
        meta,
      ),
    ).toBeNull()
  })

  it('refuses a range that does not start where the file ends', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 500-999/1000', contentLength: '500' },
        600,
        meta,
      ),
    ).toBeNull()
  })

  it('refuses a range nobody asked for, and any other status', () => {
    expect(
      planWrite(
        { status: 206, etag: '"abc"', contentRange: 'bytes 0-999/1000', contentLength: '1000' },
        0,
        null,
      ),
    ).toBeNull()
    expect(
      planWrite({ status: 404, etag: null, contentRange: null, contentLength: null }, 0, null),
    ).toBeNull()
  })
})

/**
 * In-memory stand-in for OPFS: jsdom implements none of it, and the resume path
 * is mostly about what survives on disk between two attempts.
 */
function fakeOpfs() {
  const files = new Map<string, Uint8Array>()
  const locked = new Set<string>()

  const bytesOf = (value: unknown): Uint8Array =>
    typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBufferLike)

  function handleFor(name: string) {
    const read = (): Uint8Array => files.get(name) ?? new Uint8Array()
    return {
      kind: 'file' as const,
      name,
      // Node's Blob rather than jsdom's: only that one has the `stream()` a
      // Response body is read through.
      getFile: async () => new NodeBlob([read()]),
      move: async (next: string) => {
        files.set(next, read())
        files.delete(name)
      },
      createWritable: async () => {
        let buffer = new Uint8Array()
        return {
          write: async (chunk: unknown) => {
            const incoming = bytesOf(chunk instanceof Uint8Array ? chunk : chunk)
            const next = new Uint8Array(buffer.length + incoming.length)
            next.set(buffer)
            next.set(incoming, buffer.length)
            buffer = next
          },
          close: async () => void files.set(name, buffer),
          abort: async () => undefined,
        }
      },
      createSyncAccessHandle: async () => {
        if (locked.has(name)) throw new Error('NoModificationAllowedError')
        locked.add(name)
        return {
          getSize: () => read().length,
          read: (buffer: Uint8Array, options?: { at?: number }) => {
            const source = read()
            const at = options?.at ?? 0
            const length = Math.max(0, Math.min(buffer.length, source.length - at))
            buffer.set(source.subarray(at, at + length))
            return length
          },
          write: (chunk: Uint8Array, options?: { at?: number }) => {
            const at = options?.at ?? 0
            const current = read()
            const next = new Uint8Array(Math.max(current.length, at + chunk.length))
            next.set(current)
            next.set(chunk, at)
            files.set(name, next)
            return chunk.length
          },
          truncate: (size: number) => {
            const current = read()
            const next = new Uint8Array(size)
            next.set(current.subarray(0, Math.min(size, current.length)))
            files.set(name, next)
          },
          flush: () => undefined,
          close: () => void locked.delete(name),
        }
      },
    }
  }

  const directory = {
    kind: 'directory' as const,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new Error('NotFoundError')
        files.set(name, new Uint8Array())
      }
      return handleFor(name)
    },
    removeEntry: async (name: string) => {
      if (!files.delete(name)) throw new Error('NotFoundError')
    },
    [Symbol.asyncIterator]: async function* () {
      for (const name of [...files.keys()]) yield [name, handleFor(name)] as const
    },
  }

  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
    },
  })

  return files
}

const ETAG = '"sha-of-the-weights"'
const WEIGHTS: Uint8Array<ArrayBuffer> = new Uint8Array(
  Array.from({ length: 4096 }, (_, index) => index % 251),
)

function complete(bytes: Uint8Array<ArrayBuffer>, etag = ETAG): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.length), etag },
  })
}

function tail(bytes: Uint8Array<ArrayBuffer>, from: number, etag = ETAG): Response {
  const slice = bytes.subarray(from)
  return new Response(slice, {
    status: 206,
    headers: {
      'content-length': String(slice.length),
      'content-range': `bytes ${from}-${bytes.length - 1}/${bytes.length}`,
      etag,
    },
  })
}

/**
 * A transfer that dies part way through, the way a dropped connection does. The
 * failure has to come from a later `pull`: erroring a stream discards whatever
 * is still queued, so the first chunk has to be read before the break.
 */
function severed(bytes: Uint8Array<ArrayBuffer>, cut: number, etag = ETAG): Response {
  let sent = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(bytes.subarray(0, cut))
        return
      }
      controller.error(new Error('network went away'))
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-length': String(bytes.length), etag },
  })
}

/** A transfer that ends cleanly but short, which content-length would hide. */
function truncated(bytes: Uint8Array<ArrayBuffer>, cut: number, etag = ETAG): Response {
  return new Response(bytes.subarray(0, cut), {
    status: 200,
    headers: { 'content-length': String(bytes.length), etag },
  })
}

async function drain(response: Response | undefined): Promise<Uint8Array> {
  if (!response) throw new Error('nothing to read')
  return new Uint8Array(await response.arrayBuffer())
}

let files: Map<string, Uint8Array>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  files = fakeOpfs()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Each test uses a URL of its own. The cache remembers which downloads it had to
 * hand back to Transformers.js, and that memory is per module rather than per test.
 */
function urlFor(name: string): string {
  return `https://huggingface.co/onnx-community/Model/resolve/main/${name}`
}

describe('opfsCache downloads', () => {
  it('streams a download to disk and publishes it under its final name', async () => {
    const url = urlFor('fresh.onnx_data')
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)

    expect(files.get(cacheKeyFor(url))).toEqual(WEIGHTS)
    expect([...files.keys()].filter((name) => name.includes('.part'))).toEqual([])
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('serves an installed file without going near the network', async () => {
    const url = urlFor('installed.onnx_data')
    files.set(cacheKeyFor(url), WEIGHTS)

    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never fetches for the local paths Transformers.js also probes', async () => {
    expect(await opfsCache.match('/models/onnx-community/Model/onnx/model_q4f16.onnx_data')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps what arrived when the connection drops, and finishes it next time', async () => {
    const url = urlFor('dropped.onnx_data')
    const key = cacheKeyFor(url)

    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 1500))
    await expect(drain(await opfsCache.match(url))).rejects.toThrow()

    expect(files.get(`${key}.part`)).toEqual(WEIGHTS.subarray(0, 1500))
    expect(files.has(key)).toBe(false)
    // Nothing loadable is on offer yet, so the app must not call itself installed.
    expect(await listCachedFiles()).toEqual([])
    expect(await listPartialFiles()).toEqual([{ name: `${key}.part`, size: 1500 }])

    fetchMock.mockResolvedValueOnce(tail(WEIGHTS, 1500))
    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)

    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ headers: { Range: 'bytes=1500-' } })
    expect(files.get(key)).toEqual(WEIGHTS)
    expect([...files.keys()].filter((name) => name.includes('.part'))).toEqual([])
  })

  it('starts again when the file changed upstream while a partial was on disk', async () => {
    const url = urlFor('changed.onnx_data')
    const key = cacheKeyFor(url)

    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 900))
    await expect(drain(await opfsCache.match(url))).rejects.toThrow()

    // The Hub ignores If-Range, so a stale partial is answered with a 206 that
    // belongs to different bytes. It has to be recognised here.
    const replacement: Uint8Array<ArrayBuffer> = new Uint8Array(2048).fill(7)
    fetchMock
      .mockResolvedValueOnce(tail(replacement, 900, '"a-new-export"'))
      .mockResolvedValueOnce(complete(replacement, '"a-new-export"'))

    expect(await drain(await opfsCache.match(url))).toEqual(replacement)
    expect(files.get(key)).toEqual(replacement)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('starts again when the host ignores the range and sends the whole file', async () => {
    const url = urlFor('no-ranges.onnx_data')
    const key = cacheKeyFor(url)

    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 700))
    await expect(drain(await opfsCache.match(url))).rejects.toThrow()

    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))
    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)
    expect(files.get(key)).toEqual(WEIGHTS)
  })

  it('treats a body that stops short as a failure rather than a shorter file', async () => {
    const url = urlFor('short.onnx_data')
    const key = cacheKeyFor(url)

    fetchMock.mockResolvedValueOnce(truncated(WEIGHTS, 2000))
    await expect(drain(await opfsCache.match(url))).rejects.toThrow(/2000 of 4096/)

    expect(files.has(key)).toBe(false)
    expect(files.get(`${key}.part`)).toEqual(WEIGHTS.subarray(0, 2000))
  })

  it('stands aside when the file cannot be reached at all', async () => {
    const url = urlFor('missing.json')
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }))

    expect(await opfsCache.match(url)).toBeUndefined()
    // No empty partial left behind for the next visit to trip over.
    expect([...files.keys()]).toEqual([])
  })

  it('leaves the download to Transformers.js when the write lock is held', async () => {
    const url = urlFor('locked.onnx_data')
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('model-cache')
    const partial = (await directory.getFileHandle(`${cacheKeyFor(url)}.part`, {
      create: true,
    })) as FileSystemFileHandle & { createSyncAccessHandle: () => Promise<unknown> }
    await partial.createSyncAccessHandle()

    expect(await opfsCache.match(url)).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('clearCachedFiles', () => {
  it('removes unfinished downloads too, since they hold the space back', async () => {
    const url = urlFor('discarded.onnx_data')
    const key = cacheKeyFor(url)

    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 1200))
    await expect(drain(await opfsCache.match(url))).rejects.toThrow()
    files.set('huggingface.co_some-other-model_resolve_main_model.onnx', new Uint8Array(4))

    await clearCachedFiles((name) => name.includes(cacheKeyFor('onnx-community/Model')))

    expect([...files.keys()]).toEqual(['huggingface.co_some-other-model_resolve_main_model.onnx'])
    expect(key).toContain('onnx-community_Model')
  })
})
