// Client-side crash helpers: map-layer properties -> panel item, and the offline list fallback.
import { describe, expect, it } from 'vitest';
import { binLabel, crashSpotsFromGeojson, hexFromProps, RECORDED_BINS } from '@/lib/ui/format';

const props = {
  site: 'ALBANY ST & MASSACHUSETTS AVE', label: 'Albany St & Massachusetts Ave', neighborhood: 'South End',
  lat: 42.3335, lng: -71.0735, ped: 44, bike: 17, mv: 53, total_crashes: 114, risk_yr: 10.2,
  first: '2015-01-12', last: '2026-06-05',
};

describe('hexFromProps', () => {
  it('reads the intersection site id and neighborhood', () => {
    const h = hexFromProps(props);
    expect(h.site).toBe('ALBANY ST & MASSACHUSETTS AVE');
    expect(h.neighborhood).toBe('South End');
    expect(h.pedBike).toBe(61);
    expect(h.last).toBe('2026-06-05');
  });
});

describe('crashSpotsFromGeojson', () => {
  it('matches the neighborhood as well as the label', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: null }] };
    const rows = crashSpotsFromGeojson(fc as unknown as GeoJSON.FeatureCollection, 'south end', 'recorded');
    expect(rows.map((r) => r.site)).toEqual(['ALBANY ST & MASSACHUSETTS AVE']);
  });
});

describe('RECORDED_BINS', () => {
  it('fits per-intersection counts (most intersections have 0-1 ped+bike crashes)', () => {
    expect(binLabel(1, RECORDED_BINS)).toBe('0 to 1 recorded');
    expect(binLabel(61, RECORDED_BINS)).toBe('10 or more recorded');
  });
});
