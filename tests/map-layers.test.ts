import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CurbRamp, DangerReport, FatalCrash, Vehicle } from '@/lib/ui/api';
import { arrowIconName, pointsGeojson, vehiclesGeojson } from '@/lib/ui/geo';

const data = (f: string) => JSON.parse(readFileSync(join(process.cwd(), 'public/data', f), 'utf8'));

const train = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: 'R-1',
  routeId: 'Red',
  directionId: 0,
  lat: 42.36994,
  lon: -71.11294,
  bearing: 125,
  status: 'INCOMING_AT',
  stationId: 'place-cntsq',
  headsign: 'Ashmont',
  updatedAt: '2026-10-24T14:26:03-04:00',
  stale: false,
  ...over,
});

describe('vehiclesGeojson', () => {
  it('colors by line, names the arrow icon and keeps the bearing', () => {
    const fc = vehiclesGeojson([train()]);
    expect(fc.features).toHaveLength(1);
    const p = fc.features[0].properties!;
    expect(p.color).toBe('#DA291C');
    expect(p.icon).toBe(arrowIconName('#DA291C'));
    expect(p.icon).toBe('lm-arrow-da291c');
    expect(p.bearing).toBe(125);
    expect(fc.features[0].geometry.coordinates).toEqual([-71.11294, 42.36994]);
  });

  it('skips stale trains and bad coordinates; omits an unknown bearing', () => {
    const fc = vehiclesGeojson([
      train({ id: 'a', stale: true }),
      train({ id: 'b', lat: Number.NaN }),
      train({ id: 'c', bearing: null }),
    ]);
    expect(fc.features.map((f) => f.properties!.id)).toEqual(['c']);
    expect('bearing' in fc.features[0].properties!).toBe(false);
  });
});

describe('static map layers (real files)', () => {
  it('fatalities.json has date/mode/label points', () => {
    const rows = data('fatalities.json') as FatalCrash[];
    const fc = pointsGeojson(rows);
    expect(fc.features.length).toBe(rows.length);
    expect(Object.keys(fc.features[0].properties!).sort()).toEqual(['date', 'id', 'label', 'mode']);
    for (const r of rows) expect(['pedestrian', 'bicyclist', 'motor vehicle']).toContain(r.mode);
  });

  it('safety-concerns.json has concern/date points', () => {
    const rows = data('safety-concerns.json') as DangerReport[];
    const fc = pointsGeojson(rows);
    expect(fc.features.length).toBe(rows.length);
    expect(fc.features[0].properties).toHaveProperty('concern');
  });

  it('ramps.json only has the three conditions the map filters on', () => {
    const rows = data('ramps.json') as CurbRamp[];
    const conditions = new Set(rows.map((r) => r.condition));
    expect([...conditions].sort()).toEqual(['lip at edge', 'poor condition', 'poor condition, lip at edge']);
    expect(pointsGeojson(rows).features.length).toBe(rows.length);
  });

  it('ej.geojson block groups carry the fields the panel shows', () => {
    const fc = data('ej.geojson') as GeoJSON.FeatureCollection;
    const p = fc.features[0].properties!;
    for (const k of ['geoid', 'municipality', 'population', 'limitedEnglishPct', 'criteria']) expect(p).toHaveProperty(k);
  });
});
