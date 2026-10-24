import { describe, expect, it } from 'vitest';
import { latestVehicleUpdate, normalizePredictions, normalizeVehicles, predictionsPath, VEHICLES_PATH } from '@/lib/mbta/live';
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
      row('arrive-only', { departure_time: null, arrival_time: '2026-10-24T12:03:00Z', arrival_uncertainty: 360 }),
      row('sl', { departure_time: '2026-10-24T12:02:00Z' }, '741'),
      row('cr', { departure_time: '2026-10-24T12:02:30Z' }, 'CR-Fairmount'),
      row('c', { departure_time: '2026-10-24T12:06:00Z', update_type: 'REVERSE_TRIP' }),
      row('d', { departure_time: '2026-10-24T12:09:00Z' }),
      row('e', { departure_time: '2026-10-24T12:12:00Z' }),
      // Terminal departure: no arrival_time, has departure_time.
      row('term', { arrival_time: null, departure_time: '2026-10-24T12:04:00Z', direction_id: 1 }),
    ],
    included: [{ type: 'trip', id: 'ta', attributes: { headsign: 'Ashmont' } }],
  };
  const out = normalizePredictions(json, now, (id) => (id === '70075' ? 'place-pktrm' : undefined));

  it('drops past, cancelled, skipped, arrival-only and non-subway rows; keeps next 3 per group', () => {
    const dir0 = out.filter((p) => p.directionId === 0);
    expect(dir0.map((p) => p.time)).toEqual(['2026-10-24T12:01:30Z', '2026-10-24T12:06:00Z', '2026-10-24T12:09:00Z']);
    expect(out[0].minutesAway).toBe(1);
    expect(out[0].headsign).toBe('Ashmont');
    expect(out[0].stationId).toBe('place-pktrm');
    expect(dir0.map((p) => p.approximate)).toEqual([false, true, false]);
    expect(out.every((p) => p.routeId === 'Red')).toBe(true);
  });

  it('keeps terminal departures (no arrival_time)', () => {
    expect(out.filter((p) => p.directionId === 1).map((p) => p.time)).toEqual(['2026-10-24T12:04:00Z']);
  });

  it('fixture: every row has a departure and is subway', () => {
    const fx = normalizePredictions(preds, new Date(preds.capturedAt), noParent);
    const departs = new Set(
      preds.data.filter((r) => r.attributes.departure_time).map((r) => r.attributes.departure_time as string),
    );
    for (const p of fx) {
      expect(departs.has(p.time)).toBe(true);
      expect(SUBWAY_ROUTES as readonly string[]).toContain(p.routeId);
    }
  });

  it('paths include trip headsigns and the subway route_type filter', () => {
    expect(predictionsPath(['place-pktrm'])).toContain('filter[stop]=place-pktrm');
    expect(predictionsPath(['place-pktrm'])).toContain('filter[route_type]=0,1');
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

  it('flags vehicles not updated for more than 5 minutes as stale', () => {
    const now = new Date('2026-10-24T17:30:00Z');
    const v = (id: string, updated: string) => ({
      type: 'vehicle',
      id,
      attributes: { latitude: 42.35, longitude: -71.06, current_status: 'STOPPED_AT', direction_id: 0, updated_at: updated },
      relationships: { route: { data: { id: 'Green-E' } } },
    });
    const json = {
      data: [
        v('fresh', '2026-10-24T13:29:30-04:00'),
        v('edge', '2026-10-24T13:25:00-04:00'), // exactly 5 min: not stale
        v('old', '2026-10-24T07:29:41-04:00'), // G-10008 case: 6 h old
        v('noTime', ''),
      ],
    };
    const byId = Object.fromEntries(normalizeVehicles(json, noParent, now).map((x) => [x.id, x.stale]));
    expect(byId).toEqual({ fresh: false, edge: false, old: true, noTime: false });
    expect(latestVehicleUpdate(json)?.toISOString()).toBe('2026-10-24T17:29:30.000Z');
    expect(latestVehicleUpdate({ data: [] })).toBeNull();
  });

  it('fixture: stale is set on every vehicle', () => {
    const at = latestVehicleUpdate(vehicles)!;
    const out = normalizeVehicles(vehicles, noParent, at);
    expect(out.every((x) => typeof x.stale === 'boolean')).toBe(true);
  });
});
