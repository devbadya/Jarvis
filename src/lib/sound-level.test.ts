import { describe, expect, it } from 'vitest'
import { levelFromTimeDomain } from './sound-level'

describe('levelFromTimeDomain', () => {
  it('is silent at the analyser midpoint and loud at the rails', () => {
    expect(levelFromTimeDomain(new Uint8Array())).toBe(0)
    expect(levelFromTimeDomain(new Uint8Array([128, 128, 128, 128]))).toBe(0)
    expect(levelFromTimeDomain(new Uint8Array([0, 255, 0, 255]))).toBe(1)
  })

  it('grows as the samples leave the midpoint', () => {
    const quiet = levelFromTimeDomain(new Uint8Array([120, 136, 124, 132]))
    const louder = levelFromTimeDomain(new Uint8Array([100, 156, 96, 160]))
    expect(quiet).toBeGreaterThan(0)
    expect(louder).toBeGreaterThan(quiet)
    expect(louder).toBeLessThan(1)
  })
})
