import { beforeEach, describe, expect, it } from 'vitest';
import {
  WEATHER_USER_AGENT,
  activeAlerts,
  buildWeather,
  clearWeatherCache,
  currentPeriod,
  getWeather,
  maxWindMph,
  parseAlerts,
  parseForecastUrl,
  parseHourly,
  walkNoteFor,
} from '@/lib/weather';

// Fixtures trimmed from real weather.gov responses for 42.36,-71.06 on 2026-10-24 (no network in tests).
const POINTS = {
  properties: {
    gridId: 'BOX',
    gridX: 71,
    gridY: 101,
    forecastHourly: 'https://api.weather.gov/gridpoints/BOX/71,101/forecast/hourly',
  },
};
const period = (start: string, end: string, over: Record<string, unknown> = {}) => ({
  number: 1,
  name: '',
  startTime: start,
  endTime: end,
  isDaytime: true,
  temperature: 60,
  temperatureUnit: 'F',
  temperatureTrend: null,
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 0 },
  windSpeed: '3 mph',
  windDirection: 'NW',
  shortForecast: 'Sunny',
  detailedForecast: '',
  ...over,
});
const HOURLY = {
  properties: {
    periods: [
      period('2026-10-24T14:00:00-04:00', '2026-10-24T15:00:00-04:00'),
      period('2026-10-24T15:00:00-04:00', '2026-10-24T16:00:00-04:00', {
        temperature: 58,
        shortForecast: 'Chance Light Rain',
        probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 40 },
        windSpeed: '10 to 15 mph',
        windDirection: 'N',
      }),
    ],
  },
};
// Real alert shape; `expires` in the past with `ends` in the future was common in the live feed.
const alert = (over: Record<string, unknown> = {}) => ({
  properties: {
    event: 'Wind Advisory',
    headline: 'Wind Advisory issued October 24 at 2:10PM EDT until October 25 at 9:00AM EDT by NWS Boston/Norton MA',
    messageType: 'Alert',
    status: 'Actual',
    expires: '2026-10-24T13:00:00-04:00',
    ends: '2026-10-25T09:00:00-04:00',
    ...over,
  },
});
const ALERTS = { features: [alert()] };

const T_1430 = Date.parse('2026-10-24T14:30:00-04:00');
const T_1530 = Date.parse('2026-10-24T15:30:00-04:00');

type Call = { url: string; init?: RequestInit };
function mockFetch(routes: Record<string, unknown | (() => Response)>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        if (typeof body === 'function') return (body as () => Response)();
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  };
  return { fn, calls };
}
const ROUTES = {
  'https://api.weather.gov/points/': POINTS,
  'https://api.weather.gov/gridpoints/': HOURLY,
  'https://api.weather.gov/alerts/active': ALERTS,
};

beforeEach(() => clearWeatherCache());

describe('parsing', () => {
  it('reads the forecastHourly URL and rejects other hosts', () => {
    expect(parseForecastUrl(POINTS)).toBe('https://api.weather.gov/gridpoints/BOX/71,101/forecast/hourly');
    expect(parseForecastUrl({ properties: { forecastHourly: 'https://evil.example/x' } })).toBeNull();
    expect(parseForecastUrl(null)).toBeNull();
  });

  it('normalizes hourly periods and skips broken ones', () => {
    const periods = parseHourly({
      properties: {
        periods: [
          ...HOURLY.properties.periods,
          period('1969-12-31T19:00:00-05:00', '1969-12-31T20:00:00-05:00'), // placeholder date
          period('2026-10-24T16:00:00-04:00', '2026-10-24T17:00:00-04:00', { temperature: null }),
          period('2026-10-24T17:00:00-04:00', '2026-10-24T18:00:00-04:00', { temperature: 10, temperatureUnit: 'C' }),
        ],
      },
    });
    expect(periods).toHaveLength(3);
    expect(periods[0]).toMatchObject({ tempF: 60, summary: 'Sunny', precipChance: 0, wind: '3 mph NW' });
    expect(periods[1]).toMatchObject({ tempF: 58, precipChance: 40, wind: '10 to 15 mph N' });
    expect(periods[2].tempF).toBe(50);
    expect(parseHourly({})).toEqual([]);
  });

  it('keeps null precipitation chance as null', () => {
    const [p] = parseHourly({
      properties: { periods: [period('2026-10-24T14:00:00-04:00', '2026-10-24T15:00:00-04:00', { probabilityOfPrecipitation: { value: null } })] },
    });
    expect(p.precipChance).toBeNull();
  });

  it('picks the current hour by time, not by index', () => {
    const periods = parseHourly(HOURLY);
    expect(currentPeriod(periods, T_1430)?.tempF).toBe(60);
    expect(currentPeriod(periods, T_1530)?.tempF).toBe(58); // periods[0] is already over
    expect(currentPeriod(periods, Date.parse('2026-10-24T13:00:00-04:00'))?.tempF).toBe(60); // next within 90 min
    expect(currentPeriod(periods, Date.parse('2026-10-24T20:00:00-04:00'))).toBeNull();
  });

  it('uses `ends` before `expires`, drops ended, cancelled, test and duplicate alerts', () => {
    const raw = parseAlerts({
      features: [
        alert(),
        alert(), // same alert repeated for another zone
        alert({ event: 'Flood Watch', headline: 'Flood Watch', ends: '2026-10-24T12:00:00-04:00' }),
        alert({ event: 'Frost Advisory', headline: 'Frost', ends: null, expires: '2026-10-24T22:00:00-04:00' }),
        alert({ event: 'Winter Storm Warning', headline: 'Cancelled', messageType: 'Cancel' }),
        alert({ event: 'Heat Advisory', headline: 'Test', status: 'Test' }),
        alert({ event: 'Gale Warning', headline: 'Gale', ends: '1969-12-31T19:00:00-05:00', expires: '2026-10-24T10:00:00-04:00' }),
        { properties: { headline: 'no event' } },
      ],
    });
    expect(activeAlerts(raw, T_1430)).toEqual([
      { event: 'Wind Advisory', headline: alert().properties.headline },
      { event: 'Frost Advisory', headline: 'Frost' },
    ]);
  });

  it('reads the top wind speed', () => {
    expect(maxWindMph('3 mph')).toBe(3);
    expect(maxWindMph('10 to 25 mph')).toBe(25);
    expect(maxWindMph('')).toBeNull();
  });
});

describe('walkNoteFor', () => {
  const calm = { tempF: 60, summary: 'Sunny', precipChance: 0, wind: '3 mph NW' };
  it('says nothing when the weather does not change the trip', () => {
    expect(walkNoteFor(calm, [])).toBeNull();
  });
  it('covers snow, ice, freezing temps, rain and wind advisories', () => {
    expect(walkNoteFor({ ...calm, summary: 'Light Snow Likely' }, [])).toMatch(/^Snow expected: .*curb ramps/);
    expect(walkNoteFor({ ...calm, summary: 'Freezing Rain' }, [])).toMatch(/icy/);
    expect(walkNoteFor({ ...calm, tempF: 28 }, [])).toMatch(/^Freezing temperatures/);
    expect(walkNoteFor({ ...calm, summary: 'Chance Light Rain', precipChance: 40 }, [])).toMatch(/^Rain expected/);
    expect(walkNoteFor({ ...calm, precipChance: 70 }, [])).toMatch(/^Rain expected/);
    expect(walkNoteFor(calm, [{ event: 'Wind Advisory', headline: '' }])).toMatch(/^Strong wind/);
    expect(walkNoteFor({ ...calm, wind: '20 to 30 mph' }, [])).toMatch(/^Strong wind/);
    expect(walkNoteFor(calm, [{ event: 'Winter Storm Warning', headline: '' }])).toMatch(/^Snow expected/);
    expect(walkNoteFor(calm, [{ event: 'Frost Advisory', headline: '' }])).toMatch(/^Frost possible/);
    expect(walkNoteFor(calm, [{ event: 'Coastal Flood Advisory', headline: '' }])).toMatch(/^Flood alert/);
  });
  it('never says "safe"', () => {
    const notes = [
      walkNoteFor({ ...calm, summary: 'Snow' }, []),
      walkNoteFor({ ...calm, tempF: 20 }, []),
      walkNoteFor({ ...calm, summary: 'Rain' }, []),
      walkNoteFor({ ...calm, tempF: 95 }, []),
    ];
    for (const n of notes) expect(n?.toLowerCase()).not.toMatch(/safe/);
  });
});

describe('buildWeather', () => {
  it('builds the API shape from the current hour', () => {
    const w = buildWeather(parseHourly(HOURLY), parseAlerts(ALERTS), T_1430);
    expect(w).toEqual({
      tempF: 60,
      summary: 'Sunny',
      precipChance: 0,
      wind: '3 mph NW',
      alerts: [{ event: 'Wind Advisory', headline: alert().properties.headline }],
      walkNote: 'Strong wind: gusts can push a wheelchair on bridges and open plazas.',
    });
  });
});

describe('getWeather', () => {
  it('calls points, hourly and alerts with the User-Agent, then serves from cache for 10 min', async () => {
    const m = mockFetch(ROUTES);
    const first = await getWeather(42.3601, -71.0589, { fetch: m.fn, now: T_1430 });
    expect(first.fromCache).toBe(false);
    expect(first.data.tempF).toBe(60);
    expect(m.calls.map((c) => c.url)).toEqual([
      'https://api.weather.gov/points/42.36,-71.06',
      'https://api.weather.gov/gridpoints/BOX/71,101/forecast/hourly',
      'https://api.weather.gov/alerts/active?point=42.36,-71.06',
    ]);
    for (const c of m.calls) expect((c.init?.headers as Record<string, string>)['User-Agent']).toBe(WEATHER_USER_AGENT);

    const second = await getWeather(42.3604, -71.0591, { fetch: m.fn, now: T_1430 + 5 * 60_000 });
    expect(second.fromCache).toBe(true);
    expect(m.calls).toHaveLength(3);

    // After 10 min it refetches the hourly forecast but reuses the cached points lookup.
    await getWeather(42.3601, -71.0589, { fetch: m.fn, now: T_1430 + 11 * 60_000 });
    expect(m.calls).toHaveLength(5);
    expect(m.calls.slice(3).every((c) => !c.url.includes('/points/'))).toBe(true);
  });

  it('still returns the forecast when the alerts call fails', async () => {
    const m = mockFetch({ ...ROUTES, 'https://api.weather.gov/alerts/active': () => new Response('x', { status: 500 }) });
    const w = await getWeather(42.36, -71.06, { fetch: m.fn, now: T_1430 });
    expect(w.data.alerts).toEqual([]);
    expect(w.data.tempF).toBe(60);
  });

  it('throws when weather.gov is down and nothing is cached', async () => {
    const m = mockFetch({});
    await expect(getWeather(42.36, -71.06, { fetch: m.fn, now: T_1430 })).rejects.toThrow();
  });

  it('serves a cached answer up to 1 h old when weather.gov goes down', async () => {
    await getWeather(42.36, -71.06, { fetch: mockFetch(ROUTES).fn, now: T_1430 });
    const down = mockFetch({});
    const later = await getWeather(42.36, -71.06, { fetch: down.fn, now: T_1430 + 45 * 60_000 });
    expect(later.fromCache).toBe(true);
    expect(later.data.tempF).toBe(58); // 15:15: the cached 15:00 period, not periods[0]
    await expect(getWeather(42.36, -71.06, { fetch: down.fn, now: T_1430 + 61 * 60_000 })).rejects.toThrow();
  });
});
