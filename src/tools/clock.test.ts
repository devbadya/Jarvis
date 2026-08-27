import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clockReading,
  formatClock,
  formatOffset,
  isTimeZone,
  localClock,
  localClockInResult,
  placeCandidates,
  placeFromClockResult,
  zoneOffsetMinutes,
} from './clock'

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
    expect(placeCandidates('wie viel uhr es in deutschland ist')).toContain('deutschland')
    expect(placeCandidates('wie viel uhr es in deutschland ist')).toContain('Germany')
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
  it('puts the local hour first and never a UTC instant', () => {
    const reading = formatClock(NOW, 'Europe/Berlin', 'Germany')

    expect(reading).toBe('Germany — 23:51 CEST (UTC+2, Europe/Berlin), Wed 26 Aug 2026')
    expect(reading).not.toMatch(/instant|\d{4}-\d{2}-\d{2}T/)
  })

  it('follows daylight saving rather than a fixed offset', () => {
    const winter = formatClock(new Date('2026-01-15T12:00:00.000Z'), 'Europe/Berlin', 'Berlin')
    const summer = formatClock(new Date('2026-08-15T12:00:00.000Z'), 'Europe/Berlin', 'Berlin')

    expect(winter).toContain('13:00 CET (UTC+1, Europe/Berlin)')
    expect(summer).toContain('14:00 CEST (UTC+2, Europe/Berlin)')
  })

  it('quotes Germany at 22:40 CEST when the instant is 20:40 UTC', () => {
    // The reported failure: the model read 20:40 off `2026-08-27T20:40:19.483Z`
    // and called that the hour in Germany. Minutes were right; the hour was UTC.
    const now = new Date('2026-08-27T20:40:19.483Z')
    const reading = formatClock(now, 'Europe/Berlin', 'Germany')

    expect(reading).toBe('Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026')
    expect(localClockInResult(reading)).toEqual({ hour: 22, minute: 40 })
  })
})

describe('localClock', () => {
  it('takes the hour from UTC plus the zone offset, not from hourCycle', () => {
    const now = new Date('2026-08-27T20:40:19.483Z')
    const clock = localClock(now, 'Europe/Berlin')

    expect(zoneOffsetMinutes(now, 'Europe/Berlin')).toBe(120)
    expect(formatOffset(120)).toBe('UTC+2')
    expect(formatOffset(330)).toBe('UTC+5:30')
    expect(formatOffset(-300)).toBe('UTC-5')
    expect(clock.hour).toBe(22)
    expect(clock.minute).toBe(40)
    expect(clock.offsetLabel).toBe('UTC+2')
  })
})

describe('localClockInResult', () => {
  it('reads the local hour off a world reading and ignores a bare ISO instant', () => {
    expect(localClockInResult('Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026')).toEqual({
      hour: 22,
      minute: 40,
    })
    expect(localClockInResult('2026-08-27T20:40:19.483Z')).toBeNull()
  })
})

describe('placeFromClockResult', () => {
  it('reads the city off a world reading and ignores a local one', () => {
    expect(placeFromClockResult('Tokyo, Japan — 06:51 JST (UTC+9, Asia/Tokyo), Thu 27 Aug 2026')).toBe(
      'Tokyo',
    )
    expect(placeFromClockResult('23:51 CEST (UTC+2, Europe/Berlin), Wed 26 Aug 2026')).toBeNull()
  })
})

describe('clockReading', () => {
  it('reads the user clock without asking the geocoder', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const reading = await clockReading('', NOW)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reading).toMatch(/^\d{2}:\d{2} /)
    expect(reading).not.toMatch(/instant|\d{4}-\d{2}-\d{2}T/)
    expect(reading).toContain(`, ${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
  })

  it('formats an IANA zone without a lookup', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const reading = await clockReading('Europe/Berlin', NOW)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reading).toBe('Europe/Berlin — 23:51 CEST (UTC+2, Europe/Berlin), Wed 26 Aug 2026')
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
    expect(reading).toContain('(UTC+9, Asia/Tokyo)')
    expect(reading).toContain('06:51')
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

    expect(reading).toContain('Europe/Berlin')
    expect(reading).not.toContain('Europe/Vienna')
  })

  it('takes a fresh reading on every call', async () => {
    const firstAt = new Date('2026-08-26T21:51:00.000Z')
    const secondAt = new Date('2026-08-26T21:52:30.000Z')
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const first = await clockReading('', firstAt)
    const second = await clockReading('', secondAt)

    expect(localClockInResult(first)).toEqual({
      hour: localClock(firstAt, zone).hour,
      minute: localClock(firstAt, zone).minute,
    })
    expect(localClockInResult(second)).toEqual({
      hour: localClock(secondAt, zone).hour,
      minute: localClock(secondAt, zone).minute,
    })
    expect(first).not.toBe(second)
  })

  it('throws when nothing geocodes', async () => {
    stubFetch(jsonResponse({ results: [] }), jsonResponse({ results: [] }))

    await expect(clockReading('Narnia')).rejects.toThrow(/No place called "Narnia"/)
  })
})
