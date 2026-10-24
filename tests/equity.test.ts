import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { equitySummary, polygonCentroid, type EjFeature } from '@/lib/equity';

const M_PER_DEG_LAT = 111_320;
const LAT = 42.35;
const LON = -71.06;
const north = (m: number) => LAT + m / M_PER_DEG_LAT;

/** A ~100 m square block group centred `m` meters north of (LAT, LON). */
function bg(geoid: string, m: number, population: number, limitedEnglishPct: number | null = 10): EjFeature {
  const c = north(m);
  const d = 0.0005;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[LON - d, c - d], [LON + d, c - d], [LON + d, c + d], [LON - d, c + d], [LON - d, c - d]]],
    },
    properties: { geoid, municipality: 'Boston', population, limitedEnglishPct, criteria: 'Minority' },
  };
}

const stations = [
  { id: 'place-a', name: 'Alpha', lat: LAT, lon: LON },
  { id: 'place-b', name: 'Bravo', lat: north(1000), lon: LON },
  { id: 'place-c', name: 'Charlie', lat: north(5000), lon: LON },
];

describe('polygonCentroid', () => {
  it('finds the centre of a square', () => {
    const c = polygonCentroid(bg('x', 0, 1).geometry)!;
    expect(c[0]).toBeCloseTo(LON, 6);
    expect(c[1]).toBeCloseTo(LAT, 6);
  });
  it('handles MultiPolygon and bad geometry', () => {
    const sq = (bg('x', 0, 1).geometry!.coordinates as unknown[])[0];
    const c = polygonCentroid({ type: 'MultiPolygon', coordinates: [[sq]] })!;
    expect(c[1]).toBeCloseTo(LAT, 6);
    expect(polygonCentroid(null)).toBeNull();
    expect(polygonCentroid({ type: 'Point', coordinates: [LON, LAT] })).toBeNull();
  });
});

describe('equitySummary', () => {
  const features = [bg('g1', 100, 1000, 20), bg('g2', 700, 500, 5), bg('g3', 900, 300, null), bg('g4', 3000, 9999)];

  it('counts EJ residents within 800 m of blocked stations, each block group once in the total', () => {
    const s = equitySummary(
      [
        { id: 'place-a', stepFree: false },
        { id: 'place-b', stepFree: true, partial: true },
        { id: 'place-c', stepFree: true, partial: false },
      ],
      stations,
      features,
    );
    expect(s.radiusM).toBe(800);
    expect(s.blockedStations.map((b) => b.stationId)).toEqual(['place-a', 'place-b']);
    const a = s.blockedStations[0];
    // Alpha: g1 (100 m) + g2 (700 m); g3 at 900 m is outside.
    expect(a).toMatchObject({ name: 'Alpha', status: 'not step-free', ejPopulationWithin800m: 1500, ejBlockGroups: 2 });
    expect(a.limitedEnglishPct).toBeCloseTo((20 * 1000 + 5 * 500) / 1500, 1);
    // Bravo (1000 m north): g1 (900 m) out; g2 (300 m), g3 (100 m) in; g3 has no limited-English figure.
    expect(s.blockedStations[1]).toMatchObject({ status: 'partly step-free', ejPopulationWithin800m: 800, limitedEnglishPct: 5 });
    // g1 + g2 + g3 once each.
    expect(s.totalEjPopulationAffected).toBe(1800);
  });

  it('sorts by EJ population and returns zero rows when everything is step-free', () => {
    const s = equitySummary(
      [
        { id: 'place-c', stepFree: false },
        { id: 'place-a', stepFree: false },
      ],
      stations,
      features,
    );
    expect(s.blockedStations.map((b) => [b.stationId, b.ejPopulationWithin800m])).toEqual([
      ['place-a', 1500],
      ['place-c', 0],
    ]);
    expect(s.blockedStations[1].limitedEnglishPct).toBeNull();
    expect(equitySummary([{ id: 'place-a', stepFree: true }], stations, features)).toEqual({
      blockedStations: [],
      totalEjPopulationAffected: 0,
      radiusM: 800,
    });
  });

  it('ignores unknown stations and malformed features', () => {
    const bad = [{ geometry: null, properties: null }, { geometry: { type: 'Polygon', coordinates: [] }, properties: {} }] as EjFeature[];
    const s = equitySummary([{ id: 'nope', stepFree: false }, { id: 'place-a', stepFree: false }], stations, [...bad, bg('g1', 0, Number.NaN)]);
    expect(s.blockedStations).toHaveLength(1);
    expect(s.blockedStations[0]).toMatchObject({ ejPopulationWithin800m: 0, ejBlockGroups: 1 });
  });

  it('runs on the real public/data/ej.geojson and stations.json', () => {
    const dir = path.join(process.cwd(), 'public', 'data');
    const ej = JSON.parse(readFileSync(path.join(dir, 'ej.geojson'), 'utf8')) as { features: EjFeature[] };
    const st = JSON.parse(readFileSync(path.join(dir, 'stations.json'), 'utf8')) as typeof stations;
    const s = equitySummary(st.map((x) => ({ id: x.id, stepFree: false })), st, ej.features);
    expect(s.blockedStations.length).toBe(st.length);
    expect(s.totalEjPopulationAffected).toBeGreaterThan(100_000);
  });
});
