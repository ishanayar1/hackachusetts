// Weather on the walk, from weather.gov (NWS). No key; NWS asks for an identifying User-Agent.
// Framework-agnostic: no Next imports. `fetch` is injectable so tests never touch the network.
//
// Real responses (checked 2026-10-24):
//  - /points/{lat},{lon} -> properties.forecastHourly, e.g. ".../gridpoints/BOX/71,101/forecast/hourly"
//  - forecastHourly -> properties.periods[]: { startTime, endTime (ISO with offset), temperature (number),
//    temperatureUnit "F", probabilityOfPrecipitation { value: number | null }, windSpeed "3 mph" or
//    "10 to 15 mph", shortForecast "Sunny" }. periods[0] can already be over (it ended 7 min before the
//    request in our sample), so the current hour is picked by time, never by index.
//  - /alerts/active?point= -> features[].properties: { event, headline, messageType, expires, ends | null }.
//    `expires` is when the message expires, not the hazard: on 2026-10-24, 77 of 345 active US alerts had
//    `expires` in the past but `ends` in the future. So `ends` is read first, then `expires`; ended ones drop.

export const WEATHER_USER_AGENT = 'LastMile hackathon app';
const NWS = 'https://api.weather.gov';
const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_MAX_MS = 60 * 60 * 1000; // serve a cached answer up to 1 h old if weather.gov is down
const POINTS_TTL_MS = 24 * 60 * 60 * 1000; // the grid for a point practically never changes
const TIMEOUT_MS = 8000;

export interface WeatherAlert {
  event: string;
  headline: string;
}
export interface WeatherNow {
  tempF: number;
  summary: string;
  precipChance: number | null;
  wind: string;
  alerts: WeatherAlert[];
  walkNote: string | null;
}

/** One hourly period, as normalized from weather.gov. */
export interface HourlyPeriod {
  start: number; // epoch ms
  end: number; // epoch ms
  tempF: number;
  summary: string;
  precipChance: number | null;
  wind: string;
}
/** One alert with its end time (epoch ms, null when NWS gives none). */
export interface RawAlert extends WeatherAlert {
  endsAt: number | null;
  cancelled: boolean;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---------- parsing (pure) ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Plausible epoch ms, or null. Rejects 1969/1970-style placeholders. */
function parseTime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1)) return null;
  return t;
}

export function parseForecastUrl(points: unknown): string | null {
  const p = isObj(points) && isObj(points.properties) ? points.properties : null;
  const url = p?.forecastHourly;
  return typeof url === 'string' && url.startsWith('https://api.weather.gov/') ? url : null;
}

export function parseHourly(body: unknown): HourlyPeriod[] {
  const props = isObj(body) && isObj(body.properties) ? body.properties : null;
  const periods = props && Array.isArray(props.periods) ? props.periods : [];
  const out: HourlyPeriod[] = [];
  for (const p of periods) {
    if (!isObj(p)) continue;
    const start = parseTime(p.startTime);
    const end = parseTime(p.endTime);
    if (start === null || end === null || end <= start) continue;
    if (typeof p.temperature !== 'number' || !Number.isFinite(p.temperature)) continue;
    const tempF = p.temperatureUnit === 'C' ? p.temperature * 1.8 + 32 : p.temperature;
    const pop = isObj(p.probabilityOfPrecipitation) ? p.probabilityOfPrecipitation.value : null;
    out.push({
      start,
      end,
      tempF: Math.round(tempF),
      summary: typeof p.shortForecast === 'string' ? p.shortForecast : '',
      precipChance: typeof pop === 'number' && Number.isFinite(pop) ? Math.max(0, Math.min(100, Math.round(pop))) : null,
      wind: typeof p.windSpeed === 'string' ? `${p.windSpeed}${typeof p.windDirection === 'string' && p.windDirection ? ` ${p.windDirection}` : ''}` : '',
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parseAlerts(body: unknown): RawAlert[] {
  const features = isObj(body) && Array.isArray(body.features) ? body.features : [];
  const out: RawAlert[] = [];
  for (const f of features) {
    const p = isObj(f) && isObj(f.properties) ? f.properties : null;
    if (!p || typeof p.event !== 'string' || !p.event) continue;
    out.push({
      event: p.event,
      headline: typeof p.headline === 'string' && p.headline ? p.headline : p.event,
      endsAt: parseTime(p.ends) ?? parseTime(p.expires),
      cancelled: p.messageType === 'Cancel' || p.status === 'Test' || p.status === 'Exercise',
    });
  }
  return out;
}

/** The period covering `now`; else the next one if it starts within 90 min; else null. */
export function currentPeriod(periods: HourlyPeriod[], now: number): HourlyPeriod | null {
  const covering = periods.find((p) => p.start <= now && now < p.end);
  if (covering) return covering;
  const next = periods.find((p) => p.start > now);
  return next && next.start - now <= 90 * 60 * 1000 ? next : null;
}

/** Drops cancelled, ended and duplicate alerts (NWS repeats one alert per zone). */
export function activeAlerts(alerts: RawAlert[], now: number): WeatherAlert[] {
  const seen = new Set<string>();
  const out: WeatherAlert[] = [];
  for (const a of alerts) {
    if (a.cancelled) continue;
    if (a.endsAt !== null && a.endsAt <= now) continue;
    const key = `${a.event}|${a.headline}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ event: a.event, headline: a.headline });
  }
  return out;
}

/** Highest number in "10 to 15 mph" / "3 mph". null when there is none. */
export function maxWindMph(wind: string): number | null {
  const nums = (wind.match(/\d+(\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return null;
  const max = Math.max(...nums);
  return /km\/h/i.test(wind) ? max / 1.609 : max;
}

/**
 * One plain sentence for wheelchair users, or null when the weather does not change the trip.
 * Order matters: ice and snow first (curb ramps and sidewalks), then cold, flooding, rain, wind, heat.
 */
export function walkNoteFor(p: { tempF: number; summary: string; precipChance: number | null; wind: string }, alerts: WeatherAlert[]): string | null {
  const s = p.summary.toLowerCase();
  const events = alerts.map((a) => a.event.toLowerCase()).join(' | ');
  const pop = p.precipChance ?? 0;

  if (/ice storm|freezing rain|freezing drizzle/.test(events) || /freezing rain|freezing drizzle|\bice\b/.test(s)) {
    return 'Freezing rain or ice expected: sidewalks and curb ramps may be icy.';
  }
  if (/winter|blizzard|snow|sleet/.test(events) || /snow|flurr|sleet|wintry/.test(s)) {
    return 'Snow expected: sidewalks and curb ramps may be icy or not yet cleared.';
  }
  if (p.tempF <= 32) {
    return 'Freezing temperatures: watch for ice on sidewalks, curb ramps and metal plates.';
  }
  if (/frost|freeze/.test(events)) {
    return 'Frost possible: ramps and metal plates may be slippery, especially early in the day.';
  }
  if (/flood/.test(events)) {
    return 'Flood alert: low streets and curb ramps may be under water.';
  }
  if (/rain|shower|thunder|drizzle/.test(s) || pop >= 50) {
    return 'Rain expected: ramps and metal plates may be slippery, so allow extra time.';
  }
  const mph = maxWindMph(p.wind);
  if (/wind|gale|hurricane|tropical storm/.test(events) || (mph !== null && mph >= 25)) {
    return 'Strong wind: gusts can push a wheelchair on bridges and open plazas.';
  }
  if (/heat/.test(events) || p.tempF >= 90) {
    return 'Heat alert: bring water and plan shaded stops.';
  }
  return null;
}

export function buildWeather(periods: HourlyPeriod[], rawAlerts: RawAlert[], now: number): WeatherNow | null {
  const cur = currentPeriod(periods, now);
  if (!cur) return null;
  const alerts = activeAlerts(rawAlerts, now);
  const base = { tempF: cur.tempF, summary: cur.summary, precipChance: cur.precipChance, wind: cur.wind };
  return { ...base, alerts, walkNote: walkNoteFor(base, alerts) };
}

// ---------- fetching + cache ----------
interface Entry {
  periods: HourlyPeriod[];
  alerts: RawAlert[];
  fetchedAt: number;
}
const cache = new Map<string, Entry>();
const pointsCache = new Map<string, { url: string; at: number }>();
const MAX_ENTRIES = 300;

export function clearWeatherCache(): void {
  cache.clear();
  pointsCache.clear();
}

/** ~1 km cells: nearby requests share one upstream lookup. */
export function weatherCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

async function getJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': WEATHER_USER_AGENT, Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`weather.gov ${res.status}`);
  return res.json();
}

export interface WeatherLookup {
  data: WeatherNow;
  fromCache: boolean;
  fetchedAt: number;
}

/** Throws when weather.gov fails and there is no cached answer younger than 1 h. */
export async function getWeather(
  lat: number,
  lon: number,
  opts: { fetch?: FetchLike; now?: number } = {},
): Promise<WeatherLookup> {
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now();
  const key = weatherCacheKey(lat, lon);
  const hit = cache.get(key);

  const fromEntry = (e: Entry): WeatherLookup => {
    const data = buildWeather(e.periods, e.alerts, now);
    if (!data) throw new Error('no current forecast period');
    return { data, fromCache: true, fetchedAt: e.fetchedAt };
  };

  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    try {
      return fromEntry(hit);
    } catch {
      // cached periods no longer cover now: refetch below
    }
  }

  try {
    const [qLat, qLon] = key.split(',');
    let forecastUrl = pointsCache.get(key);
    if (!forecastUrl || now - forecastUrl.at > POINTS_TTL_MS) {
      const url = parseForecastUrl(await getJson(fetchFn, `${NWS}/points/${qLat},${qLon}`));
      if (!url) throw new Error('no forecastHourly');
      forecastUrl = { url, at: now };
      pointsCache.set(key, forecastUrl);
    }
    const [hourly, alertsBody] = await Promise.all([
      getJson(fetchFn, forecastUrl.url),
      // Alerts are optional: a failure here must not hide the forecast.
      getJson(fetchFn, `${NWS}/alerts/active?point=${qLat},${qLon}`).catch(() => null),
    ]);
    const entry: Entry = { periods: parseHourly(hourly), alerts: parseAlerts(alertsBody), fetchedAt: now };
    const data = buildWeather(entry.periods, entry.alerts, now);
    if (!data) throw new Error('no current forecast period');
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, entry);
    return { data, fromCache: false, fetchedAt: now };
  } catch (err) {
    if (hit && now - hit.fetchedAt < STALE_MAX_MS) return fromEntry(hit);
    throw err;
  }
}
