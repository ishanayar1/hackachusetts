// Recorded crash spots: filtering, sorting and limits, plus the shipped public/data/crash-risk.geojson.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCrashQuery, queryCrashSpots, toCrashSpots } from '@/lib/crash';

const feature = (props: Record<string, unknown>) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'Point', coordinates: [0, 0] },
});

const FIXTURE = {
  type: 'FeatureCollection',
  features: [
    feature({ site: 'a', label: 'Mass Ave, Roxbury', neighborhood: 'Roxbury', lat: 42.33, lng: -71.08, risk_yr: 2, total_crashes: 50, mv: 40, ped: 6, bike: 4 }),
    feature({ site: 'b', label: 'Blue Hill Avenue, Roxbury', lat: 42.3, lng: -71.09, risk_yr: 9, total_crashes: 30, mv: 20, ped: 8, bike: 2 }),
    feature({ site: 'c', label: 'Boylston Street', neighborhood: 'Back Bay', lat: 42.35, lng: -71.07, risk_yr: 5, total_crashes: 80, mv: 75, ped: 3, bike: 2 }),
    feature({ site: 'd', label: 'Tremont <b>St</b>', lat: 42.355, lng: -71.06, risk_yr: 1, total_crashes: 12, mv: 2, ped: 5, bike: 5 }),
    feature({ site: 'e', lat: 42.36, lng: -71.05, risk_yr: 0.5, total_crashes: 1, mv: 1, ped: 0, bike: 0 }),
    feature({ site: 'bad', label: 'No coords', lat: null, lng: 'x' }),
    { type: 'Feature', properties: null },
  ],
};

describe('toCrashSpots', () => {
  const spots = toCrashSpots(FIXTURE);
  it('maps properties and skips features without coordinates', () => {
    expect(spots.map((s) => s.site)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(spots[0]).toEqual({
      site: 'a', label: 'Mass Ave, Roxbury', neighborhood: 'Roxbury', lat: 42.33, lng: -71.08,
      pedBike: 10, ped: 6, bike: 4, mv: 40, total: 50, estimatePerYear: 2,
    });
    expect(spots.find((s) => s.site === 'e')!.label).toBe('Unknown location');
    expect(spots.find((s) => s.site === 'e')!.neighborhood).toBe('');
  });
  it('returns [] for junk input', () => {
    expect(toCrashSpots(null)).toEqual([]);
    expect(toCrashSpots({ features: 'no' })).toEqual([]);
  });
});

describe('queryCrashSpots', () => {
  const spots = toCrashSpots(FIXTURE);

  it('sorts by recorded ped+bike crashes, then total (default)', () => {
    const r = queryCrashSpots(spots);
    // a, b, d all have 10 ped+bike (totals 50, 30, 12); then c: 5, e: 0
    expect(r.results.map((s) => s.site)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(r.count).toBe(5);
  });

  it('sort=model orders by estimatePerYear', () => {
    expect(queryCrashSpots(spots, { sort: 'model' }).results.map((s) => s.site)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('q filters labels case-insensitively; count is matches before the limit', () => {
    const r = queryCrashSpots(spots, { q: '  ROXBURY ', limit: 1 });
    expect(r.count).toBe(2);
    expect(r.results.map((s) => s.site)).toEqual(['a']);
    expect(queryCrashSpots(spots, { q: 'nowhere' })).toEqual({ count: 0, results: [] });
  });

  it('q also matches the neighborhood', () => {
    expect(queryCrashSpots(spots, { q: 'back bay' }).results.map((s) => s.site)).toEqual(['c']);
  });

  it('clamps limit to 1..200 and does not mutate the input', () => {
    const before = spots.map((s) => s.site);
    expect(queryCrashSpots(spots, { limit: 0 }).results).toHaveLength(1);
    expect(queryCrashSpots(spots, { limit: 2 }).results).toHaveLength(2);
    expect(queryCrashSpots(spots, { limit: 10_000 }).results).toHaveLength(5);
    expect(spots.map((s) => s.site)).toEqual(before);
  });
});

describe('parseCrashQuery', () => {
  const p = (qs: string) => parseCrashQuery(new URLSearchParams(qs));
  it('defaults', () => {
    expect(p('')).toEqual({ ok: true, value: { q: '', limit: 50, sort: 'recorded' } });
  });
  it('accepts valid params', () => {
    expect(p('q=mass&limit=200&sort=model')).toEqual({ ok: true, value: { q: 'mass', limit: 200, sort: 'model' } });
  });
  it('rejects bad params', () => {
    for (const qs of ['limit=0', 'limit=201', 'limit=abc', 'limit=1.5', 'limit=-3', 'sort=risk', `q=${'x'.repeat(101)}`]) {
      expect(p(qs).ok, qs).toBe(false);
    }
  });
});

const FILE = path.resolve(__dirname, '..', 'public', 'data', 'crash-risk.geojson');

describe.skipIf(!existsSync(FILE))('public/data/crash-risk.geojson', () => {
  const spots = toCrashSpots(JSON.parse(readFileSync(FILE, 'utf8')));
  it('has 4,059 intersection spots, each with a label and numeric lat/lng in Boston', () => {
    expect(spots).toHaveLength(4059);
    for (const s of spots) {
      expect(s.label.length, s.site).toBeGreaterThan(0);
      expect(Number.isFinite(s.lat) && Number.isFinite(s.lng), s.site).toBe(true);
      expect(s.lat).toBeGreaterThan(42.1);
      expect(s.lat).toBeLessThan(42.5);
      expect(s.lng).toBeGreaterThan(-71.3);
      expect(s.lng).toBeLessThan(-70.9);
    }
    expect(new Set(spots.map((s) => s.site)).size).toBe(4059);
  });
  it('top recorded spot has the most ped+bike crashes', () => {
    const top = queryCrashSpots(spots, { limit: 1 }).results[0];
    expect(top.pedBike).toBe(Math.max(...spots.map((s) => s.pedBike)));
  });
});
