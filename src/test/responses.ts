/**
 * The four shapes a model download can arrive in.
 *
 * Both cache backends implement the same resume protocol against the same
 * hostile cases, so they are described once here: two copies would drift, and
 * the interesting one — a transfer that dies part way through — is fiddly enough
 * to get wrong quietly.
 */

export const ETAG = '"sha-of-the-weights"'

/** Deterministic bytes, so a resumed file can be compared against the original. */
export function weights(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Array.from({ length }, (_, index) => index % 251))
}

export function complete(bytes: Uint8Array<ArrayBuffer>, etag = ETAG): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.length), etag },
  })
}

/** The remainder of a file, as a well-behaved host answers a Range request. */
export function tail(bytes: Uint8Array<ArrayBuffer>, from: number, etag = ETAG): Response {
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
export function severed(bytes: Uint8Array<ArrayBuffer>, cut: number, etag = ETAG): Response {
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
export function truncated(bytes: Uint8Array<ArrayBuffer>, cut: number, etag = ETAG): Response {
  return new Response(bytes.subarray(0, cut), {
    status: 200,
    headers: { 'content-length': String(bytes.length), etag },
  })
}
