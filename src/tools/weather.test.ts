import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { weatherReport } from './weather'

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

const BERLIN = {
  results: [{ name: 'Berlin', country: 'Germany', latitude: 52.52437, longitude: 13.41053 }],
}

/**
 * Trimmed from a real response. `models` makes every daily key carry a model
 * suffix and drops the unsuffixed ones, which is the detail a naive parser gets
 * wrong, so the fixture keeps that shape exactly.
 */
const FORECAST = {
  timezone: 'Europe/Berlin',
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('weatherReport', () => {
  it('reports one reading built from every source, taking the median of the models', async () => {
    stubFetch(jsonResponse(BERLIN), jsonResponse(FORECAST), jsonResponse(WTTR))

    const report = await weatherReport('Berlin')

    expect(report).toBe(
      [
        'Berlin, Germany — 15:45 local (Europe/Berlin)',
        'Now: 19.6 °C, feels 19.5 °C, partly cloudy, wind 4 km/h from NW, humidity 59%',
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

    expect(report).toContain('Now: 19.6 °C')
    // The absence of a cross-check is itself worth telling the model about.
    expect(report).toContain('Sources: Open-Meteo (ICON, GFS, ECMWF) only, with no second reading')
  })

  it('falls back to the second opinion when the forecast service fails', async () => {
    stubFetch(jsonResponse(BERLIN), new Error('Open-Meteo is down'), jsonResponse(WTTR))

    const report = await weatherReport('Berlin')

    expect(report).toContain('Now: 20 °C, feels 20 °C, sunny, wind 6 km/h from WNW, humidity 58%')
    expect(report).toContain('Today Mon 24 Aug: 12 to 21 °C, 15% chance of rain')
    expect(report).toContain('Sources: wttr.in only')
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
    // No point asking a forecast service about a place that does not exist.
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
