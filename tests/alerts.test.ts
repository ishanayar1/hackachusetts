import { describe, expect, it } from 'vitest';
import { closedFacilityIds, normalizeAlerts, toStationId } from '@/lib/mbta/alerts';
import fixture from './fixtures/alerts.json';

const now = new Date(fixture.capturedAt);
const platformParent: Record<string, string> = { '70078': 'place-dwnxg', '70077': 'place-dwnxg' };
const parentOf = (id: string) => platformParent[id];

function rawAlert(id: string, attrs: Record<string, unknown>) {
  return {
    type: 'alert',
    id,
    attributes: {
      effect: 'ELEVATOR_CLOSURE',
      header: 'Elevator 1 unavailable',
      short_header: '',
      description: null,
      url: null,
      severity: 3,
      lifecycle: 'ONGOING',
      active_period: [{ start: '2026-10-01T00:00:00-04:00', end: null }],
      informed_entity: [],
      updated_at: '2026-10-24T10:00:00-04:00',
      ...attrs,
    },
  };
}

describe('normalizeAlerts (fixture)', () => {
  const alerts = normalizeAlerts(fixture, parentOf, now);

  it('keeps every alert once', () => {
    expect(alerts.length).toBe(new Set(fixture.data.map((a) => a.id)).size);
    expect(new Set(alerts.map((a) => a.id)).size).toBe(alerts.length);
  });

  it('station ids are deduped parent place-* ids', () => {
    for (const a of alerts) {
      expect(new Set(a.stationIds).size).toBe(a.stationIds.length);
      for (const s of a.stationIds) expect(s).toMatch(/^place-/);
      expect(new Set(a.facilityIds).size).toBe(a.facilityIds.length);
      expect(new Set(a.routeIds).size).toBe(a.routeIds.length);
      expect(a.shortHeader.length).toBeGreaterThan(0);
    }
  });

  it('Downtown Crossing elevator closure is mapped and closed', () => {
    const dw = alerts.find((a) => a.effect === 'ELEVATOR_CLOSURE' && a.stationIds.includes('place-dwnxg'));
    expect(dw).toBeDefined();
    expect(dw!.activeNow).toBe(true);
    const closed = closedFacilityIds(alerts, now);
    for (const f of dw!.facilityIds) expect(closed).toContain(f);
  });

  it('every active ELEVATOR_CLOSURE facility is in closedFacilityIds', () => {
    const closed = new Set(closedFacilityIds(alerts, now));
    const elev = alerts.filter((a) => a.effect === 'ELEVATOR_CLOSURE' && a.activeNow);
    expect(elev.length).toBeGreaterThan(0);
    for (const a of elev) for (const f of a.facilityIds) expect(closed.has(f)).toBe(true);
  });

  it('alerts whose periods are all in the future are not active', () => {
    for (const a of alerts) {
      if (a.activePeriods.length && a.activePeriods.every((p) => Date.parse(p.start) > now.getTime())) {
        expect(a.activeNow).toBe(false);
      }
    }
  });
});

describe('normalizeAlerts (synthetic)', () => {
  it('dedupes entities, maps platforms and doors, falls back shortHeader', () => {
    const json = {
      data: [
        rawAlert('1', {
          informed_entity: [
            { stop: 'place-dwnxg', facility: '869', activities: ['USING_WHEELCHAIR'], route: 'Red' },
            { stop: '70078', facility: '869', activities: ['USING_WHEELCHAIR'], route: 'Red' },
            { stop: 'door-dwnxg-franklinelev', facility: '869', activities: ['USING_WHEELCHAIR'], route: 'Orange' },
            { stop: '99999', facility: '869', activities: ['USING_WHEELCHAIR'] },
          ],
        }),
        rawAlert('1', {}), // duplicate id
      ],
    };
    const [a, ...rest] = normalizeAlerts(json, parentOf, now);
    expect(rest).toHaveLength(0);
    expect(a.stationIds).toEqual(['place-dwnxg']);
    expect(a.facilityIds).toEqual(['869']);
    expect(a.routeIds.sort()).toEqual(['Orange', 'Red']);
    expect(a.activities).toEqual(['USING_WHEELCHAIR']);
    expect(a.shortHeader).toBe('Elevator 1 unavailable');
  });

  it('activeNow follows active_period and lifecycle', () => {
    const json = {
      data: [
        rawAlert('past', { active_period: [{ start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' }], informed_entity: [{ facility: '1' }] }),
        rawAlert('future', { lifecycle: 'UPCOMING', active_period: [{ start: '2027-01-01T00:00:00Z', end: null }], informed_entity: [{ facility: '2' }] }),
        rawAlert('noperiod-up', { lifecycle: 'UPCOMING', active_period: [], informed_entity: [{ facility: '3' }] }),
        rawAlert('noperiod-on', { active_period: [], informed_entity: [{ facility: '4' }] }),
        rawAlert('notice-wheelchair', { effect: 'NOTICE', informed_entity: [{ facility: '5', activities: ['USING_WHEELCHAIR'] }] }),
        rawAlert('notice-other', { effect: 'NOTICE', informed_entity: [{ facility: '6', activities: ['BOARD'] }] }),
        rawAlert('ramp', { effect: 'ACCESS_ISSUE', informed_entity: [{ facility: '7' }] }),
      ],
    };
    const alerts = normalizeAlerts(json, parentOf, now);
    const byId = Object.fromEntries(alerts.map((a) => [a.id, a]));
    expect(byId.past.activeNow).toBe(false);
    expect(byId.future.activeNow).toBe(false);
    expect(byId['noperiod-up'].activeNow).toBe(false);
    expect(byId['noperiod-on'].activeNow).toBe(true);
    expect(closedFacilityIds(alerts, now)).toEqual(['4', '5', '7']);
  });

  it('toStationId maps or drops unknown ids', () => {
    expect(toStationId('place-pktrm', () => undefined)).toBe('place-pktrm');
    expect(toStationId('70078', parentOf)).toBe('place-dwnxg');
    expect(toStationId('door-pktrm-tremont', () => undefined)).toBe('place-pktrm');
    expect(toStationId('12345', () => undefined)).toBeUndefined();
  });

  it('tolerates garbage input', () => {
    expect(normalizeAlerts(null, parentOf, now)).toEqual([]);
    expect(normalizeAlerts({ data: [null, { type: 'alert' }] }, parentOf, now)).toEqual([]);
  });
});
