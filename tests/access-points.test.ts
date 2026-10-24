import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { facilityPosition } from '@/lib/access-points';
import type { LatLon } from '@/lib/walk';

const station = { lat: 42.35, lon: -71.06 };
const coords: Record<string, LatLon> = { a: { lat: 42.351, lon: -71.061 }, b: { lat: 42.353, lon: -71.063 } };
const nodeCoord = (id: string) => coords[id] ?? null;

describe('facilityPosition', () => {
  it('prefers the GTFS coordinate', () => {
    expect(facilityPosition('e1', [], nodeCoord, { lat: 42.36, lon: -71.07 }, station)).toEqual({
      lat: 42.36,
      lon: -71.07,
      approx: false,
    });
  });

  it('falls back to the middle of the elevator pathway', () => {
    expect(facilityPosition('e1', [{ from: 'a', to: 'b', facilityId: 'e1' }], nodeCoord, null, station)).toEqual({
      lat: 42.352,
      lon: -71.062,
      approx: false,
    });
  });

  it('uses the one end that has coordinates', () => {
    expect(facilityPosition('e1', [{ from: 'x', to: 'b', facilityId: 'e1' }], nodeCoord, null, station)).toEqual({
      ...coords.b,
      approx: false,
    });
  });

  it('falls back to the station point and says so', () => {
    expect(facilityPosition('e1', [{ from: 'x', to: 'y', facilityId: 'e1' }], nodeCoord, null, station)).toEqual({
      ...station,
      approx: true,
    });
  });
});

describe.runIf(existsSync('public/data/access.geojson'))('built access.geojson', () => {
  const read = <T,>(f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8')) as T;

  it('has every subway facility and no points outside Boston', () => {
    const fc = read<GeoJSON.FeatureCollection<GeoJSON.Point>>('access.geojson');
    const fac = read<{ id: string }[]>('facilities.json');
    const ids = new Set(fc.features.map((f) => f.properties?.id));
    expect(fac.every((f) => ids.has(f.id))).toBe(true);
    expect(fc.features.every((f) => f.geometry.coordinates[1] > 42 && f.geometry.coordinates[0] < -70)).toBe(true);
  });

  it('includes station doors', () => {
    const fc = read<GeoJSON.FeatureCollection<GeoJSON.Point>>('access.geojson');
    expect(fc.features.some((f) => f.properties?.kind === 'ENTRANCE')).toBe(true);
  });
});
