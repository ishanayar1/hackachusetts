import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CrashSpot } from '@/lib/crash';
import {
  clearWarningDataCache,
  distanceToLineM,
  loadWarningDataFromDisk,
  walkWarnings,
  type Fatality,
  type Hazard,
  type Ramp,
  type SafetyConcern,
  type WarningData,
} from '@/lib/warnings';

// Synthetic east-west line along lat 42.35 in Boston, about 825 m long.
const LAT = 42.35;
const LINE: [number, number][] = [
  [-71.07, LAT],
  [-71.065, LAT],
  [-71.06, LAT],
];
const M_PER_DEG_LAT = 111_320;
/** Latitude offset (degrees) for a point `m` meters north of the line. */
const north = (m: number) => LAT + m / M_PER_DEG_LAT;

const DAY_MS = 86_400_000;
// Relative to the real clock so the runtime 120-day filter never ages these fixtures out.
const RECENT = new Date(Date.now() - 2 * DAY_MS).toISOString();
const hazard = (id: string, lat: number, lon = -71.065, extra: Partial<Hazard> = {}): Hazard => ({
  id,
  type: 'Sidewalk Repair',
  label: `Sidewalk repair reported (${id})`,
  openedAt: RECENT,
  lat,
  lon,
  ...extra,
});
const ramp = (id: string, lat: number, lon = -71.065, condition = 'poor condition'): Ramp => ({ id, condition, lat, lon });
const lonPerM = 1 / (M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180));
const spot = (site: string, lat: number, pedBike: number, lng = -71.065): CrashSpot => ({
  site,
  label: `Spot ${site}`,
  neighborhood: '',
  lat,
  lng,
  pedBike,
  ped: pedBike,
  bike: 0,
  mv: 0,
  total: pedBike,
  estimatePerYear: 0,
});

describe('distanceToLineM', () => {
  it('measures perpendicular distance to a segment', () => {
    expect(distanceToLineM(-71.065, north(30), LINE)).toBeCloseTo(30, 0);
  });
  it('measures to the nearest endpoint beyond the line ends', () => {
    expect(distanceToLineM(-71.06 + 50 * lonPerM, LAT, LINE)).toBeCloseTo(50, 0);
  });
  it('returns Infinity for an empty line', () => {
    expect(distanceToLineM(-71.065, LAT, [])).toBe(Infinity);
  });
});

describe('walkWarnings', () => {
  it('keeps hazards and ramps inside the radius and drops those outside', () => {
    const data: WarningData = {
      crashSpots: [],
      hazards: [hazard('in', north(20)), hazard('out', north(60)), hazard('far-end', LAT, -71.05)],
      ramps: [ramp('r-in', north(-35)), ramp('r-out', north(-45))],
    };
    const w = walkWarnings(LINE, data);
    expect(w.hazards.map((h) => h.id)).toEqual(['in']);
    expect(w.poorRamps.map((r) => r.id)).toEqual(['r-in']);
    expect(w.poorRamps[0]).toEqual({ id: 'r-in', condition: 'poor condition', lat: north(-35), lon: -71.065 });
  });

  it('honours a custom radius', () => {
    const data: WarningData = { crashSpots: [], hazards: [hazard('h', north(60))], ramps: [] };
    expect(walkWarnings(LINE, data, { radiusM: 70 }).hazards).toHaveLength(1);
    expect(walkWarnings(LINE, data, { radiusM: 50 }).hazards).toHaveLength(0);
  });

  it('uses 60 m for crash intersections, sorts by pedBike desc and keeps at most 5', () => {
    const crashSpots = [
      spot('a', north(100), 3),
      spot('b', north(10), 9),
      spot('c', north(-50), 7),
      spot('d', north(0), 1),
      spot('e', north(110), 12),
      spot('f', north(20), 5),
      spot('g', north(-30), 2),
      spot('h', north(40), 4),
      spot('far', north(200), 99),
    ];
    const w = walkWarnings(LINE, { crashSpots, hazards: [], ramps: [] });
    expect(w.crashAreas.map((c) => c.site)).toEqual(['b', 'c', 'f', 'h', 'g']);
    expect(w.crashAreas[0]).toEqual({ site: 'b', label: 'Spot b', pedBike: 9 });
  });

  it('drops crash areas with 0 pedestrian/bike crashes', () => {
    const w = walkWarnings(LINE, { crashSpots: [spot('zero', north(5), 0), spot('one', north(5), 1)], hazards: [], ramps: [] });
    expect(w.crashAreas.map((c) => c.site)).toEqual(['one']);
  });

  it('caps hazards and ramps at 10, nearest first, and reports uncapped totals', () => {
    const hazards = Array.from({ length: 15 }, (_, i) => hazard(`h${i}`, north(30 - i * 2)));
    const ramps = Array.from({ length: 15 }, (_, i) => ramp(`r${i}`, north(i * 2)));
    const w = walkWarnings(LINE, { crashSpots: [], hazards, ramps });
    expect(w.hazards).toHaveLength(10);
    expect(w.hazards[0].id).toBe('h14');
    expect(w.hazardTotal).toBe(15);
    expect(w.poorRamps).toHaveLength(10);
    expect(w.poorRamps[0].id).toBe('r0');
    expect(w.rampTotal).toBe(15);
  });

  it('counts poor-condition ramps separately from lip-only ramps', () => {
    const ramps = [
      ramp('p', north(1), -71.065, 'poor condition'),
      ramp('pl', north(2), -71.065, 'poor condition, lip at edge'),
      ...Array.from({ length: 12 }, (_, i) => ramp(`l${i}`, north(3 + i), -71.065, 'lip at edge')),
    ];
    const w = walkWarnings(LINE, { crashSpots: [], hazards: [], ramps });
    expect(w.rampTotal).toBe(14);
    expect(w.poorRampTotal).toBe(2);
    expect(w.lipOnlyRampTotal).toBe(12);
    expect(w.poorRamps.map((r) => r.condition).slice(0, 3)).toEqual([
      'poor condition',
      'poor condition, lip at edge',
      'lip at edge',
    ]);
  });

  it('merges duplicate 311 cases (same type + label, same day, within 15 m), keeping the nearest', () => {
    const same = { label: 'Street light out on Columbia Rd', type: 'Street Light Outage' };
    const hazards = [
      hazard('a', north(5), -71.065, same),
      hazard('b', north(10), -71.065, same), // 5 m from a: duplicate
      hazard('c', north(10), -71.065 + 30 * lonPerM, same), // ~30 m away: separate
      hazard('d', north(5), -71.065, { ...same, type: 'Sidewalk Repair' }), // other type: separate
      hazard('e', north(5), -71.065, { ...same, openedAt: new Date(Date.now() - 5 * DAY_MS).toISOString() }), // other day
    ];
    const w = walkWarnings(LINE, { crashSpots: [], hazards, ramps: [] });
    expect(w.hazards.map((h) => h.id).sort()).toEqual(['a', 'c', 'd', 'e']);
    expect(w.hazardTotal).toBe(4);
  });

  it('drops hazards opened more than 120 days before the request', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const hazards = [
      hazard('old', north(5), -71.065, { openedAt: '2026-06-20T00:00:00Z' }),
      hazard('ok', north(5), -71.065, { openedAt: '2026-06-30T00:00:00Z' }),
      hazard('nodate', north(5), -71.065, { openedAt: '' }),
    ];
    const w = walkWarnings(LINE, { crashSpots: [], hazards, ramps: [] }, { now });
    expect(w.hazards.map((h) => h.id).sort()).toEqual(['nodate', 'ok']);
    expect(w.hazardTotal).toBe(2);
  });

  it('tolerates missing data and empty or bad lines', () => {
    const empty = {
      crashAreas: [],
      hazards: [],
      poorRamps: [],
      hazardTotal: 0,
      rampTotal: 0,
      poorRampTotal: 0,
      lipOnlyRampTotal: 0,
      safetyConcerns: [],
      safetyConcernTotal: 0,
      fatalCrashes: [],
      fatalTotal: 0,
    };
    expect(walkWarnings(LINE, null)).toEqual(empty);
    expect(walkWarnings(LINE, {} as WarningData)).toEqual(empty);
    expect(walkWarnings([], { crashSpots: [spot('a', LAT, 1)], hazards: [hazard('h', LAT)], ramps: [] })).toEqual(empty);
    const bad = [[NaN, NaN]] as [number, number][];
    expect(walkWarnings(bad, { crashSpots: [], hazards: [hazard('h', LAT)], ramps: [] })).toEqual(empty);
  });

  it('lists resident-reported safety concerns within 40 m, nearest first, capped at 5 with a total', () => {
    const concern = (id: string, m: number, c = 'speeding', date = '2025-05-01'): SafetyConcern => ({
      id, date, mode: 'walking', concern: c, lat: north(m), lon: -71.065,
    });
    const safetyConcerns = [
      concern('c-far', 45),
      concern('c1', 30, 'double parking'),
      concern('c2', 5, 'people run red lights or stop signs', '2024-01-02'),
      concern('c3', 10), concern('c4', 15), concern('c5', 20), concern('c6', 25),
    ];
    const w = walkWarnings(LINE, { crashSpots: [], hazards: [], ramps: [], safetyConcerns });
    expect(w.safetyConcernTotal).toBe(6);
    expect(w.safetyConcerns).toHaveLength(5);
    expect(w.safetyConcerns?.[0]).toEqual({ concern: 'people run red lights or stop signs', date: '2024-01-02' });
    expect(w.safetyConcerns?.map((c) => c.concern)).not.toContain('double parking');
    // No free-text or coordinates leak into the warning.
    expect(Object.keys(w.safetyConcerns?.[0] ?? {}).sort()).toEqual(['concern', 'date']);
  });

  it('lists recorded fatal crashes within 60 m, newest first, capped at 5 with a total', () => {
    const fatal = (id: string, m: number, date: string, mode = 'pedestrian'): Fatality => ({
      id, date, mode, label: `Main St & ${id} St`, lat: north(m), lon: -71.065,
    });
    const fatalities = [
      fatal('far', 65, '2026-01-01'),
      fatal('a', 50, '2019-03-04', 'bicyclist'),
      fatal('b', 0, '2025-07-09'),
      fatal('c', 10, '2016-01-01'), fatal('d', 20, '2017-01-01'), fatal('e', 30, '2018-01-01'), fatal('f', 40, '2015-01-01'),
    ];
    const w = walkWarnings(LINE, { crashSpots: [], hazards: [], ramps: [], fatalities });
    expect(w.fatalTotal).toBe(6);
    expect(w.fatalCrashes?.map((f) => f.date)).toEqual(['2025-07-09', '2019-03-04', '2018-01-01', '2017-01-01', '2016-01-01']);
    expect(w.fatalCrashes?.[1]).toEqual({ date: '2019-03-04', mode: 'bicyclist', label: 'Main St & a St' });
  });

  it('works with a single-point line', () => {
    const w = walkWarnings([[-71.065, LAT]], { crashSpots: [], hazards: [hazard('h', north(10))], ramps: [] });
    expect(w.hazards).toHaveLength(1);
  });
});

describe('loadWarningDataFromDisk', () => {
  beforeEach(() => clearWarningDataCache());

  it('returns empty arrays when files are missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'warn-empty-'));
    expect(loadWarningDataFromDisk(dir)).toEqual({ crashSpots: [], hazards: [], ramps: [], fatalities: [], safetyConcerns: [] });
  });

  it('reads hazards, ramps and crash spots, and caches per dir', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'warn-data-'));
    writeFileSync(path.join(dir, 'hazards.json'), JSON.stringify([hazard('h1', LAT)]));
    writeFileSync(path.join(dir, 'ramps.json'), JSON.stringify([ramp('r1', LAT)]));
    writeFileSync(
      path.join(dir, 'crash-risk.geojson'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { site: 'X1', label: 'Main St', lat: LAT, lng: -71.065, ped: 2, bike: 1 } }],
      }),
    );
    const d1 = loadWarningDataFromDisk(dir);
    expect(d1.hazards.map((h) => h.id)).toEqual(['h1']);
    expect(d1.ramps.map((r) => r.id)).toEqual(['r1']);
    expect(d1.crashSpots[0]).toMatchObject({ site: 'X1', pedBike: 3 });
    expect(loadWarningDataFromDisk(dir)).toBe(d1);
  });

  it('reads fatalities.json and safety-concerns.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'warn-vz-'));
    const f: Fatality = { id: 'vzf-1', date: '2025-01-02', mode: 'pedestrian', label: 'A St & B St', lat: LAT, lon: -71.065 };
    const c: SafetyConcern = { id: 'vzc-1', date: '2025-03-04', mode: 'walking', concern: 'speeding', lat: LAT, lon: -71.065 };
    writeFileSync(path.join(dir, 'fatalities.json'), JSON.stringify([f]));
    writeFileSync(path.join(dir, 'safety-concerns.json'), JSON.stringify([c]));
    const d = loadWarningDataFromDisk(dir);
    expect(d.fatalities).toEqual([f]);
    expect(d.safetyConcerns).toEqual([c]);
  });

  it('tolerates malformed JSON', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'warn-bad-'));
    writeFileSync(path.join(dir, 'hazards.json'), '{not json');
    writeFileSync(path.join(dir, 'ramps.json'), '{"a":1}');
    expect(loadWarningDataFromDisk(dir)).toEqual({ crashSpots: [], hazards: [], ramps: [], fatalities: [], safetyConcerns: [] });
  });
});
