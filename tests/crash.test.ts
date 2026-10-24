// Recorded crash spots: filtering, sorting and limits, plus the shipped public/data/crash-risk.geojson.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { crashLabel, parseCrashQuery, queryCrashSpots, toCrashSpots } from '@/lib/crash';

const feature = (props: Record<string, unknown>) => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'Polygon', coordinates: [] },
});

const FIXTURE = {
  type: 'FeatureCollection',
  features: [
    feature({ hex: 'a', label: 'Mass Ave, Roxbury', lat: 42.33, lng: -71.08, risk_yr: 2, total_crashes: 50, mv: 40, ped: 6, bike: 4 }),
    feature({ hex: 'b', label: 'Blue Hill Avenue, Roxbury', lat: 42.3, lng: -71.09, risk_yr: 9, total_crashes: 30, mv: 20, ped: 8, bike: 2 }),
    feature({ hex: 'c', label: 'Boylston Street, Back Bay', lat: 42.35, lng: -71.07, risk_yr: 5, total_crashes: 80, mv: 75, ped: 3, bike: 2 }),
    feature({ hex: 'd', label: 'Tremont <b>St</b>', lat: 42.355, lng: -71.06, risk_yr: 1, total_crashes: 12, mv: 2, ped: 5, bike: 5 }),
    feature({ hex: 'e', lat: 42.36, lng: -71.05, risk_yr: 0.5, total_crashes: 1, mv: 1, ped: 0, bike: 0 }),
    feature({ hex: 'bad', label: 'No coords', lat: null, lng: 'x' }),
    { type: 'Feature', properties: null },
  ],
};

describe('toCrashSpots', () => {
  const spots = toCrashSpots(FIXTURE);
  it('maps properties and skips features without coordinates', () => {
    expect(spots.map((s) => s.hex)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(spots[0]).toEqual({
      hex: 'a', label: 'Mass Ave', area: 'Roxbury', osmLabel: 'Mass Ave, Roxbury', lat: 42.33, lng: -71.08,
      pedBike: 10, ped: 6, bike: 4, mv: 40, total: 50, estimatePerYear: 2,
    });
    expect(spots.find((s) => s.hex === 'e')!.label).toBe('Unknown location');
  });
  it('returns [] for junk input', () => {
    expect(toCrashSpots(null)).toEqual([]);
    expect(toCrashSpots({ features: 'no' })).toEqual([]);
  });
});

describe('crashLabel', () => {
  it('prefers the CSV crash intersection over the OSM nearest way, with the OSM neighbourhood as area', () => {
    expect(
      crashLabel({ label_csv: 'Boylston St @ Massachusetts Ave', label_osm: 'Massachusetts Turnpike, Back Bay', label: 'Massachusetts Turnpike, Back Bay' }),
    ).toEqual({ label: 'Boylston St & Massachusetts Ave', area: 'Back Bay' });
    expect(crashLabel({ label_csv: 'Massachusetts Ave @ Melnea Cass Blvd', label_osm: 'Albany Street, South End' })).toEqual({
      label: 'Massachusetts Ave & Melnea Cass Blvd',
      area: 'South End',
    });
  });
  it('falls back to the OSM street for highway-only, ramp or unknown CSV names', () => {
    for (const csv of ['Massachusetts Tpke', 'Interstate 93', 'I93', 'I90', 'Ramp - To I-93 North', 'Unknown location', 'Dead End', 'Us Hwy 1', '']) {
      expect(crashLabel({ label_csv: csv, label_osm: 'Atlantic Avenue, Waterfront' }), csv).toEqual({ label: 'Atlantic Avenue', area: 'Waterfront' });
    }
    expect(crashLabel({ label_csv: 'Ramp Null @ Leverett Connector', label_osm: 'Charlestown Avenue, East Cambridge' }).label).toBe('Charlestown Avenue');
    expect(crashLabel({})).toEqual({ label: 'Unknown location' });
    expect(crashLabel({ label_osm: 'Moon Island Road' })).toEqual({ label: 'Moon Island Road' });
    expect(crashLabel({ label_osm: 'Somerville Community Path, Winter Hill, Somerville, Massachusetts' }).area).toBe('Winter Hill');
  });
  it('drops dead ends and highway parts of an intersection and fixes casing', () => {
    expect(crashLabel({ label_csv: 'William F Mcclellan Hwy @ Dead End' }).label).toBe('William F McClellan Hwy');
    expect(crashLabel({ label_csv: 'Vfw Pkwy @ Providence Hwy' }).label).toBe('VFW Pkwy & Providence Hwy');
    expect(crashLabel({ label_csv: 'Science Park @ Monsignor Obrien Hwy' }).label).toBe("Science Park & Monsignor O'Brien Hwy");
    expect(crashLabel({ label_csv: 'BOYLSTON ST @ I93' }).label).toBe('Boylston St');
  });
});

describe('unique labels', () => {
  const fc = (props: Record<string, unknown>[]) => ({
    features: props.map((p, i) => feature({ hex: `h${i}`, lat: 42.35, lng: -71.06, ...p })),
  });
  it('adds the area, then a nearby street, then a number (most crashes keeps no number)', () => {
    const spots = toCrashSpots(
      fc([
        { label_csv: 'Dudley St @ Washington St', label_osm: 'Dudley Street, Nubian Square', ped: 5 },
        { label_csv: 'Dudley St @ Washington St', label_osm: 'Warren Street, Roxbury', ped: 9 },
        { label_csv: 'A St @ B St', label_osm: 'C Street, Area', ped: 1 },
        { label_csv: 'A St @ B St', label_osm: 'D Street, Area', ped: 2 },
        { label_csv: 'X St @ Y St', label_osm: 'Z Street, Same', ped: 1 },
        { label_csv: 'X St @ Y St', label_osm: 'Z Street, Same', ped: 3 },
        { label_csv: 'Q St', label_osm: 'Q Street, Lonely', ped: 3 },
      ]),
    );
    expect(spots.map((s) => s.label)).toEqual([
      'Dudley St & Washington St, Nubian Square',
      'Dudley St & Washington St, Roxbury',
      'A St & B St, Area (near C Street)',
      'A St & B St, Area (near D Street)',
      'X St & Y St, Same (2)',
      'X St & Y St, Same',
      'Q St',
    ]);
  });
});

describe('queryCrashSpots', () => {
  const spots = toCrashSpots(FIXTURE);

  it('sorts by recorded ped+bike crashes, then total (default)', () => {
    const r = queryCrashSpots(spots);
    // a, b, d all have 10 ped+bike (totals 50, 30, 12); then c: 5, e: 0
    expect(r.results.map((s) => s.hex)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(r.count).toBe(5);
  });

  it('sort=model orders by estimatePerYear', () => {
    expect(queryCrashSpots(spots, { sort: 'model' }).results.map((s) => s.hex)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('q filters labels case-insensitively; count is matches before the limit', () => {
    const r = queryCrashSpots(spots, { q: '  ROXBURY ', limit: 1 });
    expect(r.count).toBe(2);
    expect(r.results.map((s) => s.hex)).toEqual(['a']);
    expect(queryCrashSpots(spots, { q: 'nowhere' })).toEqual({ count: 0, results: [] });
  });

  it('q also searches the CSV intersection, OSM label and area; every word must match; street aliases', () => {
    const s = toCrashSpots({
      features: [
        feature({ hex: 'x', lat: 42.35, lng: -71.08, label_csv: 'Boylston St @ Massachusetts Ave', label_osm: 'Massachusetts Turnpike, Back Bay', ped: 9 }),
        feature({ hex: 'y', lat: 42.33, lng: -71.07, label_csv: 'Massachusetts Ave @ Melnea Cass Blvd', label_osm: 'Albany Street, South End', ped: 20 }),
      ],
    });
    const hexes = (q: string) => queryCrashSpots(s, { q }).results.map((r) => r.hex);
    expect(hexes('Boylston')).toEqual(['x']);
    expect(hexes('mass ave')).toEqual(['y', 'x']);
    expect(hexes('Massachusetts Avenue')).toEqual(['y', 'x']);
    expect(hexes('boylston & mass')).toEqual(['x']);
    expect(hexes('Boylston and Massachusetts')).toEqual(['x']);
    expect(hexes('turnpike')).toEqual(['x']);
    expect(hexes('albany street')).toEqual(['y']);
    expect(hexes('back bay')).toEqual(['x']);
    expect(hexes('boylston albany')).toEqual([]);
  });

  it('clamps limit to 1..200 and does not mutate the input', () => {
    const before = spots.map((s) => s.hex);
    expect(queryCrashSpots(spots, { limit: 0 }).results).toHaveLength(1);
    expect(queryCrashSpots(spots, { limit: 2 }).results).toHaveLength(2);
    expect(queryCrashSpots(spots, { limit: 10_000 }).results).toHaveLength(5);
    expect(spots.map((s) => s.hex)).toEqual(before);
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
  it('has 1,081 spots, each with a label and numeric lat/lng in Boston', () => {
    expect(spots).toHaveLength(1081);
    for (const s of spots) {
      expect(s.label.length, s.hex).toBeGreaterThan(0);
      expect(Number.isFinite(s.lat) && Number.isFinite(s.lng), s.hex).toBe(true);
      expect(s.lat).toBeGreaterThan(42.1);
      expect(s.lat).toBeLessThan(42.5);
      expect(s.lng).toBeGreaterThan(-71.3);
      expect(s.lng).toBeLessThan(-70.9);
    }
    expect(new Set(spots.map((s) => s.hex)).size).toBe(1081);
  });
  it('top recorded spot has the most ped+bike crashes', () => {
    const top = queryCrashSpots(spots, { limit: 1 }).results[0];
    expect(top.pedBike).toBe(Math.max(...spots.map((s) => s.pedBike)));
  });
  it('labels are unique, and the worst areas carry their crash intersection, not the nearest highway', () => {
    expect(new Set(spots.map((s) => s.label.toLowerCase())).size).toBe(spots.length);
    const top = queryCrashSpots(spots, { limit: 10 }).results.map((s) => s.label);
    expect(top.slice(0, 4)).toEqual([
      'Massachusetts Ave & Melnea Cass Blvd',
      'Massachusetts Ave & Gerard St',
      'Beacon St & Massachusetts Ave',
      'Boylston St & Massachusetts Ave',
    ]);
    const top50 = queryCrashSpots(spots, { limit: 50 }).results;
    expect(top50.filter((s) => /turnpike|tpke|interstate|\bI-?9[03]\b/i.test(s.label))).toEqual([]);
    expect(queryCrashSpots(spots, { q: 'Boylston', limit: 1 }).results[0].label).toBe('Boylston St & Massachusetts Ave');
    expect(queryCrashSpots(spots, { q: 'Mass Ave', limit: 1 }).results[0].pedBike).toBe(top50[0].pedBike);
  });
});
