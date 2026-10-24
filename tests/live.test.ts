import { describe, expect, it } from 'vitest';
import { normalizePredictions, normalizeVehicles, predictionsPath, VEHICLES_PATH } from '@/lib/mbta/live';
import { SUBWAY_ROUTES } from '@/lib/mbta/types';
import preds from './fixtures/predictions-pktrm.json';
import vehicles from './fixtures/vehicles.json';

const noParent = () => undefined;

describe('normalizePredictions (fixture)', () => {
  const now = new Date(Date.parse(preds.capturedAt) + 2 * 60_000);
  const out = normalizePredictions(preds, now, noParent);

  it('returns rows, none in the past, sorted by time', () => {
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(Date.parse(p.time)).toBeGreaterThanOrEqual(now.getTime());
      expect(p.minutesAway).toBeGreaterThanOrEqual(0);
    }
    const times = out.map((p) => Date.parse(p.time));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('maps platforms to place-pktrm via included stops and caps 3 per route+direction', () => {
    const counts = new Map<string, number>();
    for (const p of out) {
      expect(p.stationId).toBe('place-pktrm');
      const k = `${p.routeId}|${p.directionId}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(3);
  });

  it('fills headsigns from included trips', () => {
    expect(out.some((p) => p.headsign)).toBe(true);
  });
});

describe('normalizePredictions (synthetic)', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const row = (id: string, attrs: Record<string, unknown>, route = 'Red', stop = '70075') => ({
    type: 'prediction',
    id,
    attributes: { direction_id: 0, arrival_uncertainty: 60, update_type: 'MID_TRIP', schedule_relationship: null, ...attrs },
    relationships: { route: { data: { id: route } }, stop: { data: { id: stop } }, trip: { data: { id: `t${id}` } } },
  });
  const json = {
    data: [
      row('past', { departure_time: '2026-10-24T11:58:00Z' }),
      row('cancel', { departure_time: null, arrival_time: null, schedule_relationship: 'CANCELLED' }),
      row('skip', { departure_time: '2026-10-24T12:05:00Z', schedule_relationship: 'SKIPPED' }),
      row('a', { departure_time: '2026-10-24T12:01:30Z' }),
      row('b', { departure_time: null, arrival_time: '2026-10-24T12:03:00Z', arrival_uncertainty: 360 }),
      row('c', { departure_time: '2026-10-24T12:06:00Z', update_type: 'REVERSE_TRIP' }),
      row('d', { departure_time: '2026-10-24T12:09:00Z' }),
    ],
    included: [{ type: 'trip', id: 'ta', attributes: { headsign: 'Ashmont' } }],
  };
  const out = normalizePredictions(json, now, (id) => (id === '70075' ? 'place-pktrm' : undefined));

  it('drops past, cancelled, skipped, and keeps next 3', () => {
    expect(out.map((p) => p.time)).toEqual(['2026-10-24T12:01:30Z', '2026-10-24T12:03:00Z', '2026-10-24T12:06:00Z']);
    expect(out[0].minutesAway).toBe(1);
    expect(out[0].headsign).toBe('Ashmont');
    expect(out[0].stationId).toBe('place-pktrm');
    expect(out.map((p) => p.approximate)).toEqual([false, true, true]);
  });

  it('paths include trip headsigns', () => {
    expect(predictionsPath(['place-pktrm'])).toContain('filter[stop]=place-pktrm');
    expect(predictionsPath(['place-pktrm'])).toContain('include=trip');
    expect(VEHICLES_PATH).toContain('filter[route]=Red,Orange,Blue,Green-B,Green-C,Green-D,Green-E,Mattapan');
  });
});

describe('normalizeVehicles', () => {
  it('fixture: only subway routes, valid coordinates', () => {
    const out = normalizeVehicles(vehicles, noParent);
    expect(out.length).toBeGreaterThan(0);
    for (const v of out) {
      expect(SUBWAY_ROUTES as readonly string[]).toContain(v.routeId);
      expect(Number.isFinite(v.lat)).toBe(true);
      expect([0, 1]).toContain(v.directionId);
    }
    expect(new Set(out.map((v) => v.id)).size).toBe(out.length);
  });

  it('synthetic: drops non-revenue (revenue or revenue_status) and non-subway, maps stop parent', () => {
    const v = (id: string, route: string, attrs: Record<string, unknown>) => ({
      type: 'vehicle',
      id,
      attributes: { latitude: 42.35, longitude: -71.06, bearing: 90, current_status: 'STOPPED_AT', direction_id: 1, updated_at: 'x', ...attrs },
      relationships: { route: { data: { id: route } }, stop: { data: { id: '70075' } }, trip: { data: { id: 'T1' } } },
    });
    const json = {
      data: [
        v('1', 'Red', { revenue: 'REVENUE' }),
        v('2', 'Red', { revenue: 'NON_REVENUE' }),
        v('3', 'Red', { revenue_status: 'NON_REVENUE' }),
        v('4', '741', { revenue: 'REVENUE' }),
        v('5', 'Orange', { revenue_status: 'REVENUE', latitude: null }),
      ],
      included: [{ type: 'trip', id: 'T1', attributes: { headsign: 'Alewife' } }],
    };
    const out = normalizeVehicles(json, (id) => (id === '70075' ? 'place-pktrm' : undefined));
    expect(out.map((x) => x.id)).toEqual(['1']);
    expect(out[0]).toMatchObject({ stationId: 'place-pktrm', headsign: 'Alewife', directionId: 1, bearing: 90 });
  });
});
