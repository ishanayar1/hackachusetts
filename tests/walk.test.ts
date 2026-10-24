import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearWalkCache,
  decodePolyline,
  getWalk,
  parseLatLon,
  walkRoute,
  type FetchLike,
} from '@/lib/walk';

// Real Valhalla response captured 2026-10-24: Park Street (42.3564,-71.0621) -> Downtown Crossing (42.3555,-71.0603),
// pedestrian costing, type wheelchair. summary: time 181.61 s, length 0.212 km,
// bounds lat 42.355396..42.356402, lon -71.062196..-71.06035.
const REAL_SHAPE = 'ejfxoAndhpfCbDvDjBoDf@f@~@~@v@v@Z}@nWos@fI}TbIwT`AiCp@kBq@oAcCqE';
const REAL_VALHALLA = {
  trip: {
    summary: { time: 181.61, length: 0.212 },
    legs: [
      {
        shape: REAL_SHAPE,
        maneuvers: [
          { instruction: 'Walk southwest on Tremont Street.', length: 0.012 },
          { instruction: 'Turn left onto the walkway.', length: 0.009 },
          { instruction: 'Turn right onto the walkway.', length: 0.01 },
          { instruction: 'Turn left onto the walkway.', length: 0.165 },
          { instruction: 'Turn left onto the crosswalk.', length: 0.015 },
          { instruction: 'You have arrived at your destination.', length: 0 },
        ],
      },
    ],
  },
};

const OSRM_OK = {
  code: 'Ok',
  routes: [
    {
      distance: 230.4,
      duration: 165,
      geometry: { coordinates: [[-71.0621, 42.3564], [-71.061, 42.356], [-71.0603, 42.3555]] },
      legs: [
        {
          steps: [
            { distance: 120, name: 'Tremont Street', maneuver: { type: 'depart', modifier: 'southwest' } },
            { distance: 110.4, name: 'Winter Street', maneuver: { type: 'turn', modifier: 'left' } },
            { distance: 0, name: '', maneuver: { type: 'arrive' } },
          ],
        },
      ],
    },
  ],
};

const PARK = { lat: 42.3564, lon: -71.0621 };
const DTX = { lat: 42.3555, lon: -71.0603 };

function fakeFetch(handlers: { valhalla?: unknown | 'fail' | 'throw'; osrm?: unknown | 'fail' | 'throw' }) {
  const calls: string[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push(url);
    expect(init?.headers?.['User-Agent']).toMatch(/LastMile/);
    const which = url.includes('valhalla') ? handlers.valhalla : handlers.osrm;
    if (which === 'throw' || which === undefined) throw new Error('network down');
    if (which === 'fail') return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => which };
  };
  return { f, calls };
}

beforeEach(() => clearWalkCache());

describe('decodePolyline (precision 6)', () => {
  it('decodes a real Valhalla shape', () => {
    const pts = decodePolyline(REAL_SHAPE, 6);
    expect(pts).toHaveLength(14);
    expect(pts[0]).toEqual([42.356403, -71.062104]);
    expect(pts[pts.length - 1]).toEqual([42.355488, -71.06035]);
    for (const [lat, lon] of pts) {
      expect(lat).toBeGreaterThanOrEqual(42.355396 - 1e-5);
      expect(lat).toBeLessThanOrEqual(42.356402 + 1e-5);
      expect(lon).toBeGreaterThanOrEqual(-71.062196 - 1e-5);
      expect(lon).toBeLessThanOrEqual(-71.06035 + 1e-5);
    }
  });

  it('decodes the classic precision-5 example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
});

describe('fallback order', () => {
  it('uses Valhalla when it answers', async () => {
    const { f, calls } = fakeFetch({ valhalla: REAL_VALHALLA, osrm: OSRM_OK });
    const r = await walkRoute(PARK, DTX, { fetch: f, noCache: true });
    expect(r.source).toBe('valhalla');
    expect(r.approximate).toBe(false);
    expect(r.distanceM).toBe(212);
    expect(r.minutes).toBeCloseTo(3.0, 1);
    expect(r.coordinates[0]).toEqual([-71.062104, 42.356403]); // [lon, lat]
    expect(r.steps[3]).toEqual({ instruction: 'Turn left onto the walkway.', distanceM: 165 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('valhalla1.openstreetmap.de/route?json=');
    expect(decodeURIComponent(calls[0])).toContain('"type":"wheelchair"');
  });

  it('valhalla fails -> osrm', async () => {
    const { f, calls } = fakeFetch({ valhalla: 'fail', osrm: OSRM_OK });
    const r = await walkRoute(PARK, DTX, { fetch: f, noCache: true });
    expect(r.source).toBe('osrm');
    expect(r.approximate).toBe(true);
    expect(r.distanceM).toBe(230);
    expect(r.coordinates).toHaveLength(3);
    expect(r.steps[0].instruction).toBe('Head southwest on Tremont Street');
    expect(r.steps[1].instruction).toBe('Turn left onto Winter Street');
    expect(calls[1]).toContain('/routed-foot/route/v1/foot/-71.0621,42.3564;-71.0603,42.3555');
  });

  it('valhalla returns no route (bad body) -> osrm', async () => {
    const { f } = fakeFetch({ valhalla: { error: 'No path' }, osrm: OSRM_OK });
    expect((await walkRoute(PARK, DTX, { fetch: f, noCache: true })).source).toBe('osrm');
  });

  it('both fail -> straight line', async () => {
    const { f, calls } = fakeFetch({ valhalla: 'throw', osrm: 'fail' });
    const r = await walkRoute(PARK, DTX, { fetch: f, noCache: true });
    expect(calls).toHaveLength(2);
    expect(r.source).toBe('straight');
    expect(r.approximate).toBe(true);
    expect(r.distanceM).toBeGreaterThan(150);
    expect(r.distanceM).toBeLessThan(200);
    expect(r.minutes).toBeCloseTo(r.distanceM / 60, 1);
    expect(r.coordinates).toEqual([[-71.0621, 42.3564], [-71.0603, 42.3555]]);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].instruction).toMatch(/^Head (south)?east toward/);
  });

  it('caches by rounded coords', async () => {
    const { f, calls } = fakeFetch({ valhalla: REAL_VALHALLA });
    const a = await getWalk(PARK, DTX, { fetch: f });
    const b = await getWalk({ lat: 42.356400001, lon: -71.0621 }, DTX, { fetch: f });
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('parseLatLon (Greater Boston bbox)', () => {
  it('accepts points inside the bbox', () => {
    expect(parseLatLon('42.3564,-71.0621')).toEqual({ lat: 42.3564, lon: -71.0621 });
    expect(parseLatLon(' 42.1 , -70.8 ')).toEqual({ lat: 42.1, lon: -70.8 });
  });
  it.each([
    null,
    '',
    '42.3564',
    '42.3564,-71.0621,5',
    'abc,-71.0621',
    '42.3564,',
    '-71.0621,42.3564', // swapped
    '40.7128,-74.0060', // New York
    '42.7,-71.0',
    '42.35,-71.5',
    '42.35,-70.7',
  ])('rejects %s', (raw) => {
    expect(parseLatLon(raw)).toBeNull();
  });
});
