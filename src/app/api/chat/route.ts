// POST /api/chat  { message: string }
// Agentic safe-route assistant: turns "from A to B" into the lowest-crash-risk
// walking route, using OSM Nominatim (geocoding), Valhalla/OSRM (real street
// routes), the crash-risk model (scoring + risk-zone avoidance), and Gemini
// (intent + natural-language reply). Everything server-side; no key reaches
// the browser. Falls back gracefully when Gemini has no key.
import { connection } from 'next/server';
import type { CrashSpot } from '@/lib/crash';
import { getCrashSpots } from '@/lib/server/crash-data';
import { riskExclusionPolygons, scorePath, type RiskScore } from '@/lib/safe-route';

const UA = 'HackachusettsLastMile/1.0 (safe-route chatbot)';
const BOS_VIEWBOX = '-71.20,42.20,-70.98,42.45'; // lon,lat,lon,lat

// ---------------------------------------------------------------- Gemini cost guard
// Defense-in-depth so a loop/abuse can't run up a bill. The REAL hard cap must be
// set in Google (API-key rate limit + a Cloud Billing budget, or no billing at
// all = free tier). These app-side limits just keep normal usage cheap.
//
// GEMINI_DAILY_LIMIT  — max Gemini-backed requests per server-day (default 200).
// GEMINI_MAX_INPUT    — reject messages longer than this many chars (default 500).
// Output tokens are capped per call via maxOutputTokens below (the costly part).
const GEMINI_DAILY_LIMIT = Number(process.env.GEMINI_DAILY_LIMIT ?? 200);
const GEMINI_MAX_INPUT = Number(process.env.GEMINI_MAX_INPUT ?? 500);

// In-memory daily counter. Note: resets on server restart and is per-instance
// (not shared across serverless replicas) — fine as a cheap guard, but the
// authoritative cap is the Google-side one.
let geminiDay = '';
let geminiCount = 0;

function geminiBudgetLeft(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== geminiDay) {
    geminiDay = today;
    geminiCount = 0;
  }
  return geminiCount < GEMINI_DAILY_LIMIT;
}

/** Call once right before an actual Gemini HTTP request. */
function geminiSpend(): void {
  geminiCount += 1;
}

/** True only if a key is set, input is sane, and we're under the daily cap. */
function geminiUsable(message: string): boolean {
  if (!process.env.GEMINI_API_KEY?.trim()) return false;
  if (message.length > GEMINI_MAX_INPUT) return false;
  return geminiBudgetLeft();
}

type LngLat = [number, number];
type Geo = { lat: number; lng: number; name: string };
type WalkRoute = { coords: LngLat[]; distanceM: number; durationS: number; via: string };

// --------------------------------------------------------------- geocoding
async function geocode(place: string): Promise<Geo | null> {
  const base = 'https://nominatim.openstreetmap.org/search';
  const tryUrl = async (bounded: boolean) => {
    const p = new URLSearchParams({ q: `${place}, Boston, MA`, format: 'json', limit: '1' });
    if (bounded) {
      p.set('viewbox', BOS_VIEWBOX);
      p.set('bounded', '1');
    }
    const res = await fetch(`${base}?${p}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data.length) return null;
    const r = data[0];
    return { lat: Number(r.lat), lng: Number(r.lon), name: r.display_name.split(',')[0] };
  };
  try {
    return (await tryUrl(true)) ?? (await tryUrl(false));
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- routing
function decodePolyline6(str: string): LngLat[] {
  const coords: LngLat[] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < str.length) {
    for (const isLat of [true, false]) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (isLat) lat += d;
      else lng += d;
    }
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

async function valhalla(a: Geo, b: Geo, excludePolygons?: number[][][]): Promise<WalkRoute[]> {
  const body: Record<string, unknown> = {
    locations: [
      { lat: a.lat, lon: a.lng },
      { lat: b.lat, lon: b.lng },
    ],
    costing: 'bicycle',
    alternates: 3,
    directions_options: { units: 'kilometers' },
  };
  if (excludePolygons?.length) body.exclude_polygons = excludePolygons;
  try {
    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(18000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      trip?: Trip;
      alternates?: Array<{ trip?: Trip }>;
      error_code?: number;
    };
    if (data.error_code) return [];
    const trips: Trip[] = [];
    if (data.trip) trips.push(data.trip);
    for (const alt of data.alternates ?? []) if (alt.trip) trips.push(alt.trip);
    const routes: WalkRoute[] = [];
    for (const trip of trips) {
      if (trip.status !== 0) continue;
      const coords: LngLat[] = [];
      for (const leg of trip.legs ?? []) if (leg.shape) coords.push(...decodePolyline6(leg.shape));
      if (coords.length) {
        routes.push({
          coords,
          distanceM: (trip.summary?.length ?? 0) * 1000,
          durationS: trip.summary?.time ?? 0,
          via: 'valhalla',
        });
      }
    }
    return routes;
  } catch {
    return [];
  }
}

type Trip = { status?: number; summary?: { length?: number; time?: number }; legs?: Array<{ shape?: string }> };

async function osrm(a: Geo, b: Geo): Promise<WalkRoute[]> {
  const coords = `${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}`;
  // The public OSRM demo only hosts the car/bike/foot "driving" profile reliably;
  // the bike profile is the closest cycling fallback when Valhalla is down.
  const url = `https://router.project-osrm.org/route/v1/bike/${coords}?overview=full&geometries=geojson&alternatives=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      code: string;
      routes: Array<{ distance: number; duration: number; geometry: { coordinates: LngLat[] } }>;
    };
    if (data.code !== 'Ok') return [];
    return data.routes.map((r) => ({
      coords: r.geometry.coordinates,
      distanceM: r.distance,
      durationS: r.duration,
      via: 'osrm',
    }));
  } catch {
    return [];
  }
}

// --------------------------------------------------------------- intent (Gemini)
function parseFromTo(text: string): { from: string; to: string } | null {
  const t = ` ${text.trim()} `;
  let m = t.match(/\bfrom\s+(.+?)\s+to\s+(.+?)\s*[?.!]*\s*$/i);
  if (m) return { from: m[1].trim(), to: m[2].trim() };
  m = t.match(/^\s*(.+?)\s+to\s+(.+?)\s*[?.!]*\s*$/i);
  if (m) {
    const from = m[1]
      .replace(/^(how (do|can) i get|get|go|route|directions?|navigate|walk|take me|whats|what's|the safest way)\b[:,]?\s*/i, '')
      .trim();
    return { from, to: m[2].trim() };
  }
  return null;
}

async function geminiExtract(message: string): Promise<{ from: string; to: string } | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return parseFromTo(message);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest'}:generateContent?key=${key}`;
  const prompt =
    'Extract the start and destination from this Boston travel request as strict JSON ' +
    '{"from":"...","to":"..."}. If it is not a request for directions, return {"from":"","to":""}. ' +
    `Request: ${JSON.stringify(message)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    const parsed = JSON.parse(text) as { from?: string; to?: string };
    if (parsed.from && parsed.to) return { from: parsed.from, to: parsed.to };
    return null;
  } catch {
    return parseFromTo(message); // fall back to regex if Gemini errors
  }
}

async function geminiExplain(facts: object): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest'}:generateContent?key=${key}`;
  const prompt =
    'You are a Boston cycling-safety assistant. Using ONLY these facts (JSON), write a short, ' +
    'friendly answer (3-5 sentences). Recommend the safest BIKE route, give distance/time, say ' +
    'whether we routed around high-crash zones, name the riskiest point to watch, and mention the ' +
    'nearest MBTA stops (useful for bringing a bike or bike-share). Do not invent numbers.\nFacts: ' +
    JSON.stringify(facts);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return text.trim() || null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- MBTA stops
async function nearestStop(g: Geo): Promise<string | null> {
  const p = new URLSearchParams({
    'filter[latitude]': g.lat.toFixed(5),
    'filter[longitude]': g.lng.toFixed(5),
    'filter[radius]': '0.02',
    sort: 'distance',
    'page[limit]': '1',
  });
  const key = process.env.MBTA_API_KEY?.trim();
  if (key) p.set('api_key', key);
  try {
    const res = await fetch(`https://api-v3.mbta.com/stops?${p}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ attributes?: { name?: string } }> };
    return data.data?.[0]?.attributes?.name ?? null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- handler
export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = (body.message ?? '').trim();
  if (!message) {
    return Response.json({ reply: 'Ask me for a safe route, e.g. "from Fenway Park to Boston Common".', ok: false });
  }

  const places = await geminiExtract(message);
  if (!places?.from || !places?.to) {
    return Response.json({ reply: `I can't help with that. Please tell me where do you want to go.`, ok: false });

  }

  const [from, to] = await Promise.all([geocode(places.from), geocode(places.to)]);
  if (!from || !to) {
    const missing = !from ? places.from : places.to;
    return Response.json({ reply: `I couldn't find "${missing}" in Boston. Try a more specific name.`, ok: false });
  }

  let spots: readonly CrashSpot[] = [];
  try {
    spots = (await getCrashSpots(new URL(request.url).origin)).spots;
  } catch {
    // risk data missing — we can still route, just without scoring
  }

  // Try to route AROUND the worst risk zones; if that boxes in the path, fall
  // back to plain routing (and report avoided=false honestly).
  const excl = spots.length ? riskExclusionPolygons([from.lng, from.lat], [to.lng, to.lat], spots) : [];
  let plain = (await valhalla(from, to)) ;
  if (!plain.length) plain = await osrm(from, to);

  const bestRisk = (routes: WalkRoute[]) =>
    routes.length && spots.length ? Math.min(...routes.map((x) => scorePath(x.coords, spots).riskTotal)) : Infinity;

  let avoided = false;
  let chosen = plain;
  let chosenRisk = bestRisk(plain);

  if (excl.length && spots.length) {
    // Try excluding progressively fewer high-risk sites. Excluding all of them
    // often boxes in the destination (Valhalla 442 "no path"); fewer exclusions
    // still steers the route off the worst corners. Keep the lowest-risk result
    // that beats the plain route — don't stop at the first routable one.
    const ks = Array.from(new Set([excl.length, Math.ceil(excl.length / 2), 3, 2, 1].filter((k) => k >= 1 && k <= excl.length)));
    for (const k of ks) {
      const r = await valhalla(from, to, excl.slice(0, k));
      if (!r.length) continue; // 442 no-path at this k: relax further
      const risk = bestRisk(r);
      if (risk < chosenRisk) {
        chosen = r;
        chosenRisk = risk;
        avoided = true;
      }
    }
  }

  if (!chosen.length) {
    return Response.json({
      reply: `I found ${from.name} and ${to.name}, but the routing service is temporarily unavailable, so I can't draw a real street route right now. Try again in a moment.`,
      ok: false,
    });
  }

  // Score + pick the safest route.
  const scored = chosen
    .map((r) => ({ ...r, score: spots.length ? scorePath(r.coords, spots) : emptyScore() }))
    .sort((x, y) => x.score.riskTotal - y.score.riskTotal);
  const safest = scored[0];

  const [oStop, dStop] = await Promise.all([nearestStop(from), nearestStop(to)]);

  const facts = {
    from: from.name,
    to: to.name,
    distance_m: Math.round(safest.distanceM),
    minutes: Math.round(safest.durationS / 60),
    risk_score: safest.score.riskTotal,
    avoided_high_risk_zones: avoided,
    riskiest_point: safest.score.hotspot,
    riskiest_point_estimate_per_year: safest.score.riskPeak,
    mbta_origin_stop: oStop,
    mbta_destination_stop: dStop,
  };

  const reply = (await geminiExplain(facts)) ?? fallbackReply(facts);

  return Response.json({
    ok: true,
    reply,
    route: { coords: safest.coords, from, to },
    avoided,
    riskScore: safest.score,
    facts,
  });
}

function emptyScore(): RiskScore {
  return { riskTotal: 0, riskPeak: 0, hotspot: null, siteCount: 0 };
}

function fallbackReply(f: {
  from: string;
  to: string;
  distance_m: number;
  minutes: number;
  risk_score: number;
  avoided_high_risk_zones: boolean;
  riskiest_point: string | null;
  mbta_origin_stop: string | null;
  mbta_destination_stop: string | null;
}): string {
  const km = (f.distance_m / 1000).toFixed(1);
  const lines = [
    `🚲 Safest bike ride from ${f.from} to ${f.to}: about ${km} km (~${f.minutes} min), crash-risk score ${f.risk_score} (lower is safer).`,
  ];
  lines.push(
    f.avoided_high_risk_zones
      ? 'I routed you around the highest-crash zones in the area.'
      : "I couldn't fully avoid the high-risk zones here, so take extra care.",
  );
  if (f.riskiest_point) lines.push(`Watch out near ${f.riskiest_point}.`);
  if (f.mbta_origin_stop && f.mbta_destination_stop) {
    lines.push(`By MBTA: nearest stops are ${f.mbta_origin_stop} (start) and ${f.mbta_destination_stop} (end).`);
  }
  return lines.join(' ');
}
