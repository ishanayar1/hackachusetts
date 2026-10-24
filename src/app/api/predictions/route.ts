// `dynamic` route config is removed under cacheComponents; `await connection()` keeps this request-time.
import { connection } from 'next/server';
import {
  envelope,
  getParentOf,
  jsonWithCache,
  MAX_PREDICTION_STOPS,
  mbtaGet,
  normalizePredictions,
  predictionsPath,
  STOP_ID_RE,
  unavailable,
} from '@/lib/server/mbta';

export async function GET(request: Request) {
  await connection();
  const raw = new URL(request.url).searchParams.get('stop') ?? '';
  const stops = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!stops.length || stops.length > MAX_PREDICTION_STOPS || !stops.every((s) => STOP_ID_RE.test(s))) {
    return Response.json(
      { error: `stop must be 1-${MAX_PREDICTION_STOPS} comma-separated ids like place-pktrm` },
      { status: 400 },
    );
  }
  stops.sort(); // stable cache key regardless of order
  try {
    const r = await mbtaGet(predictionsPath(stops), { ttlMs: 20_000 });
    return jsonWithCache(envelope(normalizePredictions(r.body, new Date(), getParentOf()), r), 20, 40);
  } catch {
    return unavailable('Predictions');
  }
}
