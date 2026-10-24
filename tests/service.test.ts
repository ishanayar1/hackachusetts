import { describe, it, expect } from 'vitest';
import { getAlertsOrDemo, type LiveAlerts } from '@/lib/lastmile-service';
import { identityParent } from '@/lib/mbta/alerts';

const demoBody = {
  data: [
    {
      type: 'alert',
      id: 'demo-1',
      attributes: {
        effect: 'ELEVATOR_CLOSURE',
        header: 'Elevator 999 unavailable',
        lifecycle: 'ONGOING',
        severity: 3,
        active_period: [{ start: '2020-01-01T00:00:00-05:00', end: null }],
        informed_entity: [{ stop: 'place-pktrm', facility: '999', activities: ['USING_WHEELCHAIR'] }],
      },
    },
  ],
};

describe('getAlertsOrDemo', () => {
  it('uses demo closures (source demo) when live alerts fail', async () => {
    const r = await getAlertsOrDemo(identityParent, async () => demoBody, () => Promise.reject(new Error('MBTA down')));
    expect(r.result.source).toBe('demo');
    expect(r.closedFacilityIds).toEqual(['999']);
    expect(r.alerts.map((a) => a.id)).toEqual(['demo-1']);
  });

  it('passes live alerts through untouched when they load', async () => {
    const live: LiveAlerts = { alerts: [], closedFacilityIds: ['1'], result: { body: {}, source: 'v3', fetchedAt: 1 } };
    let demoCalls = 0;
    const r = await getAlertsOrDemo(identityParent, async () => (demoCalls++, demoBody), async () => live);
    expect(r).toBe(live);
    expect(demoCalls).toBe(0);
  });

  it('throws only when the demo snapshot is unavailable too', async () => {
    await expect(
      getAlertsOrDemo(identityParent, () => Promise.reject(new Error('no file')), () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('no file');
  });
});
