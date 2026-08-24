import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollBehavior } from './motion'

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scrollBehavior', () => {
  it('animates the jump when nobody asked it not to', () => {
    stubMatchMedia(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('jumps outright for a reader who asked for less motion', () => {
    stubMatchMedia(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it('animates when the browser cannot answer', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(scrollBehavior()).toBe('smooth')
  })
})
