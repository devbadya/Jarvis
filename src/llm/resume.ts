/**
 * The parts of a resumable model download that do not care where the bytes land.
 *
 * There are two backends — `opfs-cache.ts` and `idb-cache.ts` — and exactly one
 * piece of logic between them is subtle enough that a second copy would be a
 * liability: deciding whether a response may be appended to what is already
 * stored. That lives here, with the vocabulary both backends speak.
 */

/** Attempts per download, each one resuming where the last stopped. */
export const ATTEMPTS = 3

/** Pause between attempts, long enough for a brief drop to pass. */
export const RETRY_DELAY_MS = 500

/** Progress is reported this often rather than per chunk, which is every 64 KB. */
export const REPORT_EVERY_BYTES = 1024 * 1024

export function cacheKeyFor(request: string): string {
  return request.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** What an unfinished download is known to be a prefix of. */
export interface ResumeMeta {
  /** Entity tag the bytes already stored came from. */
  etag: string
  /** Size of the complete file. */
  total: number
}

/** Where a response's bytes belong in the file being assembled. */
export interface WritePlan {
  /** Offset the body starts at. Zero for a full response. */
  start: number
  /** Size of the complete file, or 0 when the server did not say. */
  total: number
}

/** `bytes 1024-4095/4096` → where the body starts and how large the file is. */
function parseContentRange(value: string | null): { start: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value?.trim() ?? '')
  if (!match) return null
  return { start: Number(match[1]), total: Number(match[3]) }
}

/**
 * Whether a response can be appended to what is already stored.
 *
 * A 206 is trusted only when it continues the partial exactly: same entity tag,
 * same total, starting where the stored bytes end. The check cannot be delegated
 * to the server, because the Hub's CDN ignores `If-Range` — a stale validator
 * still comes back as 206 with the old range, which would splice bytes from two
 * different files together. A 200 is always a whole file, so it restarts.
 * Anything else means the backend should stand aside.
 */
export function planWrite(
  response: {
    status: number
    etag: string | null
    contentRange: string | null
    contentLength: string | null
  },
  requested: number,
  meta: ResumeMeta | null,
): WritePlan | null {
  if (response.status === 200) {
    return { start: 0, total: Number(response.contentLength ?? 0) || 0 }
  }
  if (response.status !== 206 || requested <= 0 || !meta) return null

  const range = parseContentRange(response.contentRange)
  if (!range || range.start !== requested || range.total !== meta.total) return null
  if (!response.etag || response.etag !== meta.etag) return null
  return range
}

export function headersOf(response: Response) {
  return {
    status: response.status,
    etag: response.headers.get('etag'),
    contentRange: response.headers.get('content-range'),
    contentLength: response.headers.get('content-length'),
  }
}

/** Bytes stored for one file, as the app shows them while a download runs. */
export interface DownloadProgress {
  url: string
  loaded: number
  total: number
}

let report: ((progress: DownloadProgress) => void) | null = null

/**
 * Where download progress goes.
 *
 * Transformers.js reports progress for the bodies it reads itself, and it never
 * reads these — the file is stored by the time it is handed over. The worker
 * translates these URLs into the file names the rest of the app already uses.
 */
export function setDownloadProgress(listener: ((progress: DownloadProgress) => void) | null): void {
  report = listener
}

export function reportProgress(progress: DownloadProgress): void {
  report?.(progress)
}

export interface CachedFile {
  name: string
  size: number
}

/**
 * What Transformers.js needs from a cache backend, which is the Cache API's
 * shape narrowed to the three methods it actually calls.
 */
export interface ModelCacheBackend {
  match: (request: string) => Promise<Response | undefined>
  put: (
    request: string,
    response: Response,
    progress_callback?: (data: { progress: number; loaded: number; total: number }) => void,
  ) => Promise<void>
  delete: (request: string) => Promise<boolean>
}
