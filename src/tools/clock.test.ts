import { afterEach, describe, expect, it, vi } from 'vitest'
import { clockReading, formatClock, isTimeZone, placeCandidates, placeFromClockResult } from './clock'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response
}

function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next ?? jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requested(fetchMock: ReturnType<typeof stubFetch>): URL[] {
  return fetchMock.mock.calls.map((call) => new URL((call as unknown as [string])[0]))
}

const NOW = new Date('2026-08-26T21:51:00.000Z')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('placeCandidates', () => {
  it('keeps a bare name', () => {
    expect(placeCandidates('Berlin')).toEqual(['Berlin'])
  })

  it('pulls the city out of the question a 0.8B model often passes whole', () => {
    expect(placeCandidates('What time is it in Tokyo?')).toContain('Tokyo')
    expect(placeCandidates('Wie spät ist es in Deutschland?')).toContain('Deutschland')
  })

  it('adds the English alias that the German name would otherwise miss', () => {
    expect(placeCandidates('Deutschland')).toContain('Germany')
    expect(placeCandidates('Tokio')).toContain('Tokyo')
  })
})

describe('isTimeZone', () => {
  it('accepts IANA names and rejects a country', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Germany')).toBe(false)
    expect(isTimeZone('')).toBe(false)
  })
})

describe('formatClock', () => {
  it('formats a place reading with the zone and the instant', () => {
    const reading = formatClock(NOW, 'Europe/Berlin', 'Germany')

    expect(reading).toContain('Germany —')
    expect(reading).toContain('26 Aug 2026, 23:51:00')
    expect(reading).toContain('(Europe/Berlin)')
    expect(reading).toContain('instant 2026-08-26T21:51:00.000Z')
  })

  it('follows daylight saving rather than a fixed offset', () => {
    const winter = formatClock(new Date('2026-01-15T12:00:00.000Z'), 'Europe/Berlin', 'Berlin')
    const summer = formatClock(new Date('2026-08-15T12:00:00.000Z'), 'Europe/Berlin', 'Berlin')

    expect(winter).toContain('13:00:00')
    expect(summer).toContain('14:00:00')
  })
})

describe('placeFromClockResult', () => {
  it('reads the city off a world reading and ignores a local one', () => {
    expect(
      placeFromClockResult(
        'Tokyo, Japan — Thu 27 Aug 2026, 06:51:00 JST (Asia/Tokyo) — instant 2026-08-26T21:51:00.000Z',
      ),
    ).toBe('Tokyo')
    expect(
      placeFromClockResult(
        'Wed 26 Aug 2026, 23:51:00 CEST (Europe/Berlin) — instant 2026-08-26T21:51:00.000Z',
      ),
    ).toBeNull()
  })
})

describe('clockReading', () => {
  it('reads the user clock without asking the geocoder', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const reading = await clockReading('', NOW)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reading).toContain('instant 2026-08-26T21:51:00.000Z')
    expect(reading).toContain(`(${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
  })

  it('formats an IANA zone without a lookup', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const reading = await clockReading('Europe/Berlin', NOW)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reading).toContain('Europe/Berlin —')
    expect(reading).toContain('26 Aug 2026, 23:51:00')
  })

  it('geocodes a city in English and German and prefers a capital', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        results: [
          {
            name: 'Tokio',
            country: 'United States',
            timezone: 'America/Chicago',
            feature_code: 'PPL',
            population: 12,
          },
        ],
      }),
      jsonResponse({
        results: [
          {
            name: 'Tokio',
            country: 'Japan',
            timezone: 'Asia/Tokyo',
            feature_code: 'PPLC',
            population: 13_000_000,
          },
        ],
      }),
    )

    const reading = await clockReading('Tokio', NOW)
    const urls = requested(fetchMock)

    expect(urls.map((url) => url.searchParams.get('language')).sort()).toEqual(['de', 'en'])
    expect(reading).toContain('Tokio, Japan —')
    expect(reading).toContain('(Asia/Tokyo)')
    expect(reading).toContain('06:51:00')
  })

  it('prefers a country named Deutschland over the Austrian town the English index ranks first', async () => {
    stubFetch(
      jsonResponse({
        results: [
          {
            name: 'Deutschlandsberg',
            country: 'Austria',
            timezone: 'Europe/Vienna',
            feature_code: 'PPLA3',
            population: 8429,
          },
        ],
      }),
      jsonResponse({
        results: [
          {
            name: 'Deutschland',
            country: 'Deutschland',
            timezone: 'Europe/Berlin',
            feature_code: 'PCLI',
            population: 82_000_000,
          },
        ],
      }),
    )

    const reading = await clockReading('Deutschland', NOW)

    expect(reading).toContain('(Europe/Berlin)')
    expect(reading).not.toContain('Europe/Vienna')
  })

  it('takes a fresh instant on every call', async () => {
    const first = await clockReading('', new Date('2026-08-26T21:51:00.000Z'))
    const second = await clockReading('', new Date('2026-08-26T21:52:30.000Z'))

    expect(first).toContain('instant 2026-08-26T21:51:00.000Z')
    expect(second).toContain('instant 2026-08-26T21:52:30.000Z')
  })

  it('throws when nothing geocodes', async () => {
    stubFetch(jsonResponse({ results: [] }), jsonResponse({ results: [] }))

    await expect(clockReading('Narnia')).rejects.toThrow(/No place called "Narnia"/)
  })
})
