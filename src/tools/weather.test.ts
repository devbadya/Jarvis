import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeCandidates, weatherReport } from './weather'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response
}

/** Responses are returned in the order the module asks for them: geocode, Open-Meteo, wttr.in. */
function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next ?? jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedUrls(fetchMock: ReturnType<typeof stubFetch>): URL[] {
  return fetchMock.mock.calls.map((call) => new URL((call as unknown as [string])[0]))
}

function requestedInits(fetchMock: ReturnType<typeof stubFetch>): (RequestInit | undefined)[] {
  return fetchMock.mock.calls.map((call) => (call as unknown as [string, RequestInit | undefined])[1])
}

const BERLIN = {
  results: [{ name: 'Berlin', country: 'Germany', latitude: 52.52437, longitude: 13.41053 }],
}

/**
 * The instant every test is run at, so the ages in a reading are fixed.
 *
 * 13:52Z is seven minutes after the fixture's observation, which is what a
 * quarter-hourly grid normally looks like: the clock in the answer is behind the
 * question and the reading is still current.
 */
const NOW = '2026-08-24T13:52:00Z'

/**
 * Trimmed from a real response. `models` makes every daily key carry a model
 * suffix and drops the unsuffixed ones, which is the detail a naive parser gets
 * wrong, so the fixture keeps that shape exactly.
 */
const FORECAST = {
  timezone: 'Europe/Berlin',
  // `current.time` is a local wall clock, so the offset is the only thing that
  // makes it an instant — 15:45 in Berlin is 13:45Z.
  utc_offset_seconds: 7200,
  current: {
    time: '2026-08-24T15:45',
    temperature_2m: 19.6,
    apparent_temperature: 19.5,
    relative_humidity_2m: 59,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 3.9,
    wind_direction_10m: 326,
  },
  daily: {
    time: ['2026-08-24', '2026-08-25'],
    weather_code_icon_seamless: [3, 3],
    temperature_2m_max_icon_seamless: [20.2, 23.5],
    temperature_2m_min_icon_seamless: [11.4, 13.4],
    precipitation_sum_icon_seamless: [0, 0],
    precipitation_probability_max_icon_seamless: [0, 0],
    weather_code_gfs_seamless: [3, 2],
    temperature_2m_max_gfs_seamless: [22.2, 25.2],
    temperature_2m_min_gfs_seamless: [11.4, 14.4],
    precipitation_sum_gfs_seamless: [0, 0],
    precipitation_probability_max_gfs_seamless: [3, 0],
    weather_code_ecmwf_ifs025: [51, 3],
    temperature_2m_max_ecmwf_ifs025: [20.2, 23.7],
    temperature_2m_min_ecmwf_ifs025: [11.9, 12.8],
    precipitation_sum_ecmwf_ifs025: [0.7, 0],
    precipitation_probability_max_ecmwf_ifs025: [22, 0],
  },
}

/** wttr.in reports every measurement as a string, including the numeric ones. */
const WTTR_NOW = {
  /** UTC, and a bare clock: 01:37 PM is 13:37Z, fifteen minutes before `NOW`. */
  observation_time: '01:37 PM',
  temp_C: '20',
  FeelsLikeC: '20',
  humidity: '58',
  windspeedKmph: '6',
  winddir16Point: 'WNW',
  precipMM: '0.0',
  weatherDesc: [{ value: 'Sunny' }],
}

const WTTR = {
  current_condition: [WTTR_NOW],
  weather: [
    { date: '2026-08-24', maxtempC: '21', mintempC: '12', hourly: [{ chanceofrain: '15' }] },
    { date: '2026-08-25', maxtempC: '24', mintempC: '13', hourly: [{ chanceofrain: '0' }] },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('weatherReport', () => {
  it('reports one reading built from every source, taking the median of the models', async () => {
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(WTTR))

    const report = await weatherReport('Berlin')

    expect(report).toBe(
      [
        'Berlin, Germany — 15:45 local (Europe/Berlin)',
        // The clock above is the observation's, not the user's, so the age is
        // what stops a quarter-hourly grid reading as a stale answer.
        'Now (measured 7 min ago): 19.6 °C, feels 19.5 °C, partly cloudy, wind 4 km/h from NW, humidity 59%',
        // Maxima 20.2 / 22.2 / 20.2 and minima 11.4 / 11.4 / 11.9: the middle of
        // the three, not the first model and not the average.
        'Today Mon 24 Aug: 11.4 to 20.2 °C, overcast, 3% chance of rain',
        'Tue 25 Aug: 13.4 to 23.7 °C, overcast, 0% chance of rain',
        'Sources: Open-Meteo (ICON, GFS, ECMWF) and wttr.in, agreeing within 0.4 °C on the temperature now.',
      ].join('\n'),
    )
    expect(report.length).toBeLessThan(600)
  })

  it('asks all three models, and asks the second opinion about the geocoded point', async () => {
    const fetchMock = stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(WTTR))

    await weatherReport('Berlin')

    const [geocode, forecast, second] = requestedUrls(fetchMock)
    expect(geocode?.searchParams.get('name')).toBe('Berlin')
    expect(forecast?.searchParams.get('models')).toBe('icon_seamless,gfs_seamless,ecmwf_ifs025')
    // Local time only means anything when the API resolves the place's own zone.
    expect(forecast?.searchParams.get('timezone')).toBe('auto')
    // By coordinate, so it cannot answer about a different Springfield.
    expect(second?.pathname).toBe('/52.524,13.411')
    expect(second?.searchParams.get('format')).toBe('j1')
  })

  it('says the reading is approximate when the two sources disagree', async () => {
    const apart = { ...WTTR, current_condition: [{ ...WTTR_NOW, temp_C: '23' }] }
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(apart))

    expect(await weatherReport('Berlin')).toContain(
      '3.4 °C apart on the temperature now, so it is approximate',
    )
  })

  it('answers from the surviving source when the second opinion fails', async () => {
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), new Error('wttr.in is down'))

    const report = await weatherReport('Berlin')

    expect(report).toContain('19.6 °C')
    // The absence of a cross-check is itself worth telling the model about.
    expect(report).toContain('Sources: Open-Meteo (ICON, GFS, ECMWF) only, with no second reading')
  })

  it('falls back to the second opinion when the forecast service fails', async () => {
    stubFetch(jsonResponse(BERLIN), new Error('Open-Meteo is down'), jsonResponse(WTTR))

    const report = await weatherReport('Berlin')

    expect(report).toContain(
      'Now (measured 15 min ago): 20 °C, feels 20 °C, sunny, wind 6 km/h from WNW, humidity 58%',
    )
    expect(report).toContain('Today Mon 24 Aug: 12 to 21 °C, 15% chance of rain')
    expect(report).toContain('Sources: wttr.in only')
  })

  /**
   * The reported failure, and the reason this whole freshness pass exists:
   * wttr.in observes every half hour and caches for ten minutes, so its
   * "current" temperature is routinely far behind Open-Meteo's. Averaged in, an
   * hour of warming read as two sources disagreeing, and the answer hedged about
   * a reading that was not actually in doubt.
   */
  it('leaves a stale second opinion out rather than reporting its age as disagreement', async () => {
    const old = { ...WTTR, current_condition: [{ ...WTTR_NOW, observation_time: '11:52 AM', temp_C: '23' }] }
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(old))

    const report = await weatherReport('Berlin')

    expect(report).toContain('Now (measured 7 min ago): 19.6 °C')
    expect(report).not.toContain('apart on the temperature now')
    expect(report).toContain(
      'Sources: Open-Meteo (ICON, GFS, ECMWF) only, with no second reading to check it against.' +
        ' wttr.in answered but was 120 min old, so it was left out.',
    )
  })

  it('quotes the freshest source, not whichever was asked first', async () => {
    // Two minutes newer than the forecast's grid, which is the case that used to
    // be decided by the order the requests happen to be written in.
    const newer = {
      ...WTTR,
      current_condition: [{ ...WTTR_NOW, observation_time: '01:47 PM', temp_C: '21' }],
    }
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(newer))

    const report = await weatherReport('Berlin')

    expect(report).toContain('Now (measured 5 min ago): 21 °C')
    // The clock and the zone still come from the only source that reports them.
    expect(report).toContain('Berlin, Germany — 15:45 local (Europe/Berlin)')
    expect(report).toContain('agreeing within 1.4 °C on the temperature now')
  })

  it('still answers when every source is stale, saying how old the reading is', async () => {
    const old = { ...WTTR, current_condition: [{ ...WTTR_NOW, observation_time: '12:22 PM' }] }
    stubFetch(jsonResponse(BERLIN), new Error('Open-Meteo is down'), jsonResponse(old))

    const report = await weatherReport('Berlin')

    expect(report).toContain('Now (measured 90 min ago): 20 °C')
    expect(report).toContain('Sources: wttr.in only')
  })

  it("reads wttr's clock as yesterday when it lands ahead of ours", async () => {
    // 23:50 UTC observed at 00:10 UTC is twenty minutes old, not 23 hours short
    // of it, and the format carries no date to say which.
    vi.setSystemTime(new Date('2026-08-25T00:10:00Z'))
    const overnight = { ...WTTR, current_condition: [{ ...WTTR_NOW, observation_time: '11:50 PM' }] }
    stubFetch(jsonResponse(BERLIN), new Error('Open-Meteo is down'), jsonResponse(overnight))

    expect(await weatherReport('Berlin')).toContain('Now (measured 20 min ago): 20 °C')
  })

  it('reports a reading with no timestamp on it without inventing an age', async () => {
    const undated = { ...WTTR, current_condition: [{ ...WTTR_NOW, observation_time: undefined }] }
    stubFetch(jsonResponse(BERLIN), new Error('Open-Meteo is down'), jsonResponse(undated))

    expect(await weatherReport('Berlin')).toContain('Now: 20 °C')
  })

  it('asks both services not to answer out of the HTTP cache', async () => {
    const fetchMock = stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(WTTR))

    await weatherReport('Berlin')

    // wttr.in sends `Cache-Control: max-age=600`, which would otherwise add ten
    // minutes to an observation that is already the older of the two.
    const [, forecast, second] = requestedInits(fetchMock)
    expect(forecast?.cache).toBe('no-store')
    expect(second?.cache).toBe('no-store')
  })

  it('gives up with the place named when nothing answers', async () => {
    stubFetch(jsonResponse(BERLIN), new Error('down'), new Error('also down'))

    await expect(weatherReport('Berlin')).rejects.toThrow(
      'No weather source answered for Berlin, Germany: down; also down',
    )
  })

  it('names an unknown place instead of guessing at coordinates', async () => {
    const fetchMock = stubFetch(jsonResponse({ generationtime_ms: 0.5 }))

    await expect(weatherReport('Zzzzqqq')).rejects.toThrow('No place called "Zzzzqqq" was found')
    // No point asking a forecast service about a place that does not exist,
    // and nothing to narrow in a name that is already one word.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tells the model to ask rather than call again with the same phrase', async () => {
    stubFetch(jsonResponse({}), jsonResponse({}))

    await expect(weatherReport('here')).rejects.toThrow('Ask which town or city was meant')
  })

  it('finds the place inside the question the model passed through', async () => {
    // The reported failure: *Wie ist das Wetter in Berlin?* reaches the tool as
    // the whole phrase, the geocoder matches names, and the weather was simply
    // unavailable.
    const fetchMock = stubFetch(
      jsonResponse({}),
      jsonResponse(BERLIN),
      jsonResponse(FORECAST),
      jsonResponse(WTTR),
    )

    expect(await weatherReport('das Wetter in Berlin')).toContain('Berlin, Germany')
    expect(requestedUrls(fetchMock)[1]?.searchParams.get('name')).toBe('Berlin')
  })
})

describe('placeCandidates', () => {
  it.each([
    ['Berlin', ['Berlin']],
    ['New York', ['New York']],
    // Tried whole first, which is what keeps a place whose name contains one of
    // these words from being narrowed into somewhere else.
    ['In Salah', ['In Salah', 'Salah']],
    ['Rio de Janeiro', ['Rio de Janeiro']],
  ])('leaves %j as it was written', (raw, expected) => {
    expect(placeCandidates(raw)).toEqual(expected)
  })

  it.each([
    ['weather in Berlin', 'Berlin'],
    ['das Wetter in Berlin', 'Berlin'],
    ['Wettervorhersage für Rom', 'Rom'],
    ['the forecast for Lisbon this week', 'Lisbon'],
    ['temperature in Oslo today', 'Oslo'],
    ['Hamburg heute', 'Hamburg'],
    ['Berlin right now', 'Berlin'],
    ['Wetter München', 'München'],
    ['weather in Berlin?', 'Berlin'],
  ])('narrows %j to %j once the whole phrase has failed', (raw, expected) => {
    const candidates = placeCandidates(raw)

    expect(candidates[0]).toBe(raw)
    expect(candidates).toContain(expected)
  })

  it('drops a day no model has an opinion on rather than printing blanks', async () => {
    const thin = {
      ...FORECAST,
      daily: { ...FORECAST.daily, time: ['2026-08-24', '2026-08-25', '2026-08-26'] },
    }
    stubFetch(jsonResponse(BERLIN), jsonResponse(thin), jsonResponse(WTTR))

    const report = await weatherReport('Berlin')

    expect(report).toContain('Tue 25 Aug')
    expect(report).not.toContain('Wed 26 Aug')
  })

  it('leaves out a measurement of zero, so a dry day does not read as a wet one', async () => {
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(WTTR))

    const report = await weatherReport('Berlin')

    expect(report).not.toContain('0 mm')
    expect(report).toContain('3% chance of rain')
  })
})
