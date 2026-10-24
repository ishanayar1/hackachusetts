import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clearBluebikesCache,
  feedUrl,
  getNearbyBikes,
  nearestStations,
  parseRadius,
  parseStationInfo,
  parseStationStatus,
} from '@/lib/bluebikes';
import { haversineM } from '@/lib/walk';

// Fixtures trimmed from the real GBFS 1.1 feeds on 2026-10-24 (no network in tests).
const INFO_URL = 'https://gbfs.lyft.com/gbfs/1.1/bos/en/station_information.json';
const STATUS_URL = 'https://gbfs.lyft.com/gbfs/1.1/bos/en/station_status.json';
const DISCOVERY = {
  last_updated: 1792865514,
  ttl: 60,
  version: '1.1',
  data: {
    fr: { feeds: [{ name: 'station_information', url: 'https://gbfs.lyft.com/gbfs/1.1/bos/fr/station_information.json' }] },
    en: {
      feeds: [
        { name: 'system_information', url: 'https://gbfs.lyft.com/gbfs/1.1/bos/en/system_information.json' },
        { name: 'station_information', url: INFO_URL },
        { name: 'station_status', url: STATUS_URL },
      ],
    },
  },
};
const INFO = {
  last_updated: 1792865514,
  ttl: 60,
  data: {
    stations: [
      { station_id: '2093488029445054742', name: 'Park Street T Stop - Tremont St at Park St', short_name: 'B32068', lon: -71.062457, lat: 42.3566271, capacity: 28 },
      { station_id: '1676a6f7-c417-48d2-92e8-5ce21995efc3', name: 'Tremont St at Hamilton Pl', lon: -71.06159030555888, lat: 42.35675589876239, capacity: 17 },
      { station_id: '1991922092203192944', name: 'Washington St at Temple Pl', lon: -71.06097685, lat: 42.35496799, capacity: 19 },
      { station_id: 'far-away', name: 'Harvard Square', lon: -71.1189, lat: 42.3734, capacity: 20 },
      { station_id: '8e7c1984-dc81-43b0-a0d3-58c6de45225a', name: 'Uninstalled', lon: -71.0622, lat: 42.3563, capacity: 0 },
      { station_id: 'near-4th', name: 'Boston Common', lon: -71.0655, lat: 42.355, capacity: 15 },
      { station_id: 'no-status', name: 'No status row', lon: -71.0625, lat: 42.3564, capacity: 10 },
      { station_id: 'zero', name: 'Bad coords', lon: 0, lat: 0 },
    ],
  },
};
const status = (id: string, over: Record<string, unknown> = {}) => ({
  station_id: id,
  num_bikes_available: 3,
  num_bikes_disabled: 0,
  num_docks_available: 25,
  num_docks_disabled: 0,
  is_installed: 1,
  is_renting: 1,
  is_returning: 1,
  last_reported: 1792865378,
  num_ebikes_available: 2,
  ...over,
});
const STATUS = {
  last_updated: 1792865454,
  ttl: 60,
  data: {
    stations: [
      status('2093488029445054742'),
      status('1676a6f7-c417-48d2-92e8-5ce21995efc3', { num_bikes_available: 0, num_ebikes_available: 0, num_docks_available: 17 }),
      status('1991922092203192944', { num_bikes_available: 13, num_ebikes_available: 10, num_docks_available: 6 }),
      status('far-away'),
      // Real placeholder row for an uninstalled station.
      status('8e7c1984-dc81-43b0-a0d3-58c6de45225a', { num_bikes_available: 0, num_docks_available: 0, num_ebikes_available: 0, is_installed: 0, is_renting: 0, is_returning: 0, last_reported: 86400 }),
      status('near-4th', { is_renting: 0 }),
    ],
  },
};
const PARK_ST = { lat: 42.356, lon: -71.062 };

function mockFetch(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {
    'https://gbfs.bluebikes.com/gbfs/gbfs.json': DISCOVERY,
    [INFO_URL]: INFO,
    [STATUS_URL]: STATUS,
  };
  const fn = async (url: string): Promise<Response> => {
    calls.push(url);
    if (overrides[url]) return overrides[url]();
    if (url in bodies) return new Response(JSON.stringify(bodies[url]), { status: 200 });
    return new Response('not found', { status: 404 });
  };
  return { fn, calls };
}

beforeEach(() => clearBluebikesCache());

describe('parsing', () => {
  it('finds English feed URLs in gbfs.json', () => {
    expect(feedUrl(DISCOVERY, 'station_information')).toBe(INFO_URL);
    expect(feedUrl(DISCOVERY, 'station_status')).toBe(STATUS_URL);
    expect(feedUrl(DISCOVERY, 'nope')).toBeNull();
    expect(feedUrl({}, 'station_status')).toBeNull();
  });

  it('parses station information and drops 0,0 coordinates', () => {
    const info = parseStationInfo(INFO);
    expect(info).toHaveLength(7);
    expect(info[0]).toEqual({ id: '2093488029445054742', name: 'Park Street T Stop - Tremont St at Park St', lat: 42.3566271, lon: -71.062457 });
  });

  it('parses status, marks uninstalled stations and caps e-bikes at total bikes', () => {
    const st = parseStationStatus({
      data: { stations: [...STATUS.data.stations, status('weird', { num_bikes_available: 1, num_ebikes_available: 4, num_docks_available: -2 })] },
    });
    expect(st.get('2093488029445054742')).toEqual({ id: '2093488029445054742', bikes: 3, ebikes: 2, docks: 25, installed: true, renting: true });
    expect(st.get('8e7c1984-dc81-43b0-a0d3-58c6de45225a')).toMatchObject({ installed: false, renting: false });
    expect(st.get('near-4th')?.renting).toBe(false);
    expect(st.get('weird')).toMatchObject({ bikes: 1, ebikes: 1, docks: 0 });
  });

  it('parses the radius with a 400 m default', () => {
    expect(parseRadius(null)).toBe(400);
    expect(parseRadius('')).toBe(400);
    expect(parseRadius('250')).toBe(250);
    expect(parseRadius('10')).toBe(50);
    expect(parseRadius('99999')).toBe(2000);
    expect(parseRadius('abc')).toBeNull();
  });
});

describe('nearestStations', () => {
  const info = parseStationInfo(INFO);
  const st = parseStationStatus(STATUS);

  it('returns the nearest 3 installed stations within the radius, closest first', () => {
    const out = nearestStations(info, st, PARK_ST, 400);
    expect(out.map((s) => s.name)).toEqual(['Park Street T Stop - Tremont St at Park St', 'Tremont St at Hamilton Pl', 'Washington St at Temple Pl']);
    expect(out.map((s) => s.distanceM)).toEqual([79, 91, 142]);
    expect(out[2]).toMatchObject({ bikes: 13, ebikes: 10, docks: 6, renting: true });
  });

  it('includes stations that are not renting, flagged, and skips uninstalled or unknown ones', () => {
    const out = nearestStations(info, st, PARK_ST, 400, 10);
    const ids = out.map((s) => s.id);
    expect(ids).toContain('near-4th');
    expect(out.find((s) => s.id === 'near-4th')?.renting).toBe(false);
    expect(ids).not.toContain('8e7c1984-dc81-43b0-a0d3-58c6de45225a');
    expect(ids).not.toContain('no-status');
    expect(ids).not.toContain('far-away');
  });

  it('returns an empty list when nothing is in range', () => {
    expect(nearestStations(info, st, { lat: 42.2, lon: -71.3 }, 400)).toEqual([]);
  });

  it('property: at most 3, all within radius, sorted by distance', () => {
    const station = fc.record({
      id: fc.uuid(),
      name: fc.string(),
      lat: fc.double({ min: 42.3, max: 42.4, noNaN: true }),
      lon: fc.double({ min: -71.12, max: -71.0, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(station, { selector: (s) => s.id, maxLength: 30 }),
        fc.integer({ min: 50, max: 2000 }),
        (stations, radius) => {
          const statusMap = new Map(stations.map((s) => [s.id, { id: s.id, bikes: 1, ebikes: 0, docks: 1, installed: true, renting: true }]));
          const out = nearestStations(stations, statusMap, PARK_ST, radius);
          expect(out.length).toBeLessThanOrEqual(3);
          for (let i = 0; i < out.length; i++) {
            expect(out[i].distanceM).toBeLessThanOrEqual(radius);
            if (i > 0) expect(out[i].distanceM).toBeGreaterThanOrEqual(out[i - 1].distanceM);
          }
          const inRange = stations.filter((s) => Math.round(haversineM(PARK_ST, s)) <= radius).length;
          expect(out.length).toBe(Math.min(3, inRange));
        },
      ),
    );
  });
});

describe('getNearbyBikes', () => {
  const T0 = 1792865500_000;

  it('caches station_information for 1 h and station_status for 60 s', async () => {
    const m = mockFetch();
    const a = await getNearbyBikes(PARK_ST, 400, { fetch: m.fn, now: T0 });
    expect(a.fromCache).toBe(false);
    expect(a.stations).toHaveLength(3);
    expect(m.calls.sort()).toEqual(['https://gbfs.bluebikes.com/gbfs/gbfs.json', INFO_URL, STATUS_URL].sort());

    const b = await getNearbyBikes(PARK_ST, 400, { fetch: m.fn, now: T0 + 30_000 });
    expect(b.fromCache).toBe(true);
    expect(m.calls).toHaveLength(3);

    m.calls.length = 0;
    await getNearbyBikes(PARK_ST, 400, { fetch: m.fn, now: T0 + 61_000 });
    expect(m.calls).toEqual([STATUS_URL]);

    m.calls.length = 0;
    await getNearbyBikes(PARK_ST, 400, { fetch: m.fn, now: T0 + 61 * 60_000 });
    expect(m.calls.sort()).toEqual(['https://gbfs.bluebikes.com/gbfs/gbfs.json', INFO_URL, STATUS_URL].sort());
  });

  it('serves counts up to 10 min old when GBFS fails, then throws', async () => {
    await getNearbyBikes(PARK_ST, 400, { fetch: mockFetch().fn, now: T0 });
    const down = mockFetch({ [STATUS_URL]: () => new Response('x', { status: 503 }) });
    const stale = await getNearbyBikes(PARK_ST, 400, { fetch: down.fn, now: T0 + 5 * 60_000 });
    expect(stale.fromCache).toBe(true);
    expect(stale.fetchedAt).toBe(T0);
    expect(stale.stations).toHaveLength(3);
    await expect(getNearbyBikes(PARK_ST, 400, { fetch: down.fn, now: T0 + 11 * 60_000 })).rejects.toThrow();
  });

  it('throws when GBFS is down and nothing is cached', async () => {
    const down = mockFetch({ 'https://gbfs.bluebikes.com/gbfs/gbfs.json': () => new Response('x', { status: 500 }) });
    await expect(getNearbyBikes(PARK_ST, 400, { fetch: down.fn, now: T0 })).rejects.toThrow();
  });
});
