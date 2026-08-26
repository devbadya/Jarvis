import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOnline, watchOnline } from './network'

function stubOnLine(value: boolean | undefined): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

afterEach(() => {
  stubOnLine(true)
  vi.unstubAllGlobals()
})

describe('isOnline', () => {
  it('is offline only when the browser says so outright', () => {
    stubOnLine(false)
    expect(isOnline()).toBe(false)

    stubOnLine(true)
    expect(isOnline()).toBe(true)
  })

  it('assumes a connection when the browser does not report one', () => {
    // A browser that cannot answer must not be treated as offline: the cost of
    // guessing wrong here is an app that refuses to work at all.
    stubOnLine(undefined)
    expect(isOnline()).toBe(true)
  })
})

describe('watchOnline', () => {
  it('reports both directions and stops when unsubscribed', () => {
    const seen: boolean[] = []
    const stop = watchOnline((online) => seen.push(online))

    stubOnLine(false)
    window.dispatchEvent(new Event('offline'))
    stubOnLine(true)
    window.dispatchEvent(new Event('online'))
    expect(seen).toEqual([false, true])

    stop()
    stubOnLine(false)
    window.dispatchEvent(new Event('offline'))
    expect(seen).toEqual([false, true])
  })
})
