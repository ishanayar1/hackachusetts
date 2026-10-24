import { describe, expect, it } from 'vitest';
import type { NormalizedAlert } from '@/lib/mbta/types';
import {
  NTFY_BASE,
  TEST_TOPIC,
  asciiHeader,
  buildMessages,
  recentAccessibilityAlerts,
  runNotify,
  secretOk,
  subscribeUrl,
  topicFor,
} from '@/lib/notify';

const NOW = new Date('2026-10-24T17:25:00Z');

function alert(over: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    id: '1040976',
    effect: 'ELEVATOR_CLOSURE',
    header: 'Downtown Crossing Elevator 804 unavailable due to maintenance.',
    shortHeader: 'Downtown Crossing Elevator 804 unavailable due to maintenance.',
    description: null,
    url: null,
    severity: 3,
    lifecycle: 'NEW',
    activePeriods: [{ start: '2026-10-24T13:19:01-04:00', end: null }],
    activeNow: true,
    stationIds: ['place-dwnxg'],
    routeIds: ['Orange'],
    facilityIds: ['804'],
    activities: ['USING_WHEELCHAIR'],
    updatedAt: '2026-10-24T13:19:01-04:00', // 17:19:01Z, 6 min before NOW
    ...over,
  };
}

const names: Record<string, string> = { 'place-dwnxg': 'Downtown Crossing', 'place-cenav': 'Central Avenue' };
const stationName = (id: string) => names[id];

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  };
  return { f, calls };
}

const texts = async (alerts: NormalizedAlert[]) => new Map(alerts.map((a) => [a.id, a.header]));

describe('topics', () => {
  it('is lastmile- + station id', () => {
    expect(topicFor('place-dwnxg')).toBe('lastmile-place-dwnxg');
    expect(subscribeUrl('place-dwnxg')).toBe('https://ntfy.sh/lastmile-place-dwnxg');
    expect(TEST_TOPIC).toBe('lastmile-test-hackachusetts');
  });
});

describe('recentAccessibilityAlerts', () => {
  it('keeps accessibility alerts updated within the window (offset timestamps parsed)', () => {
    const fresh = alert();
    const old = alert({ id: 'old', updatedAt: '2026-10-24T13:10:00-04:00' }); // 15 min before NOW
    const delay = alert({ id: 'delay', effect: 'DELAY', facilityIds: [], activities: ['BOARD'] });
    const ended = alert({ id: 'ended', activeNow: false });
    const bad = alert({ id: 'bad', updatedAt: '' });
    expect(recentAccessibilityAlerts([fresh, old, delay, ended, bad], NOW).map((a) => a.id)).toEqual(['1040976']);
    expect(recentAccessibilityAlerts([fresh, old], NOW, 20).map((a) => a.id)).toEqual(['1040976', 'old']);
  });
});

describe('buildMessages', () => {
  it('groups by station: one message per station with title, wheelchair tag and app link', () => {
    const a = alert();
    const b = alert({ id: 'b', effect: 'ESCALATOR_CLOSURE', header: 'Downtown Crossing Escalator 1 unavailable.' });
    const c = alert({ id: 'c', effect: 'ACCESS_ISSUE', stationIds: ['place-cenav'], facilityIds: ['subplat-cenav-1'], header: 'The Central Avenue mini-high platform is out of service.' });
    const msgs = buildMessages([a, b, c], new Map([['a', 'x']]), stationName, 'https://lastmile.test');
    expect(msgs.map((m) => m.topic)).toEqual(['lastmile-place-cenav', 'lastmile-place-dwnxg']);
    expect(msgs[0]).toMatchObject({ title: 'Central Avenue: accessibility issue', tags: 'wheelchair', click: 'https://lastmile.test', alertIds: ['c'] });
    expect(msgs[1].title).toBe('Downtown Crossing: 2 accessibility alerts');
    expect(msgs[1].message).toBe(`${a.header}\nDowntown Crossing Escalator 1 unavailable.`);
  });

  it('uses the station id when the name is unknown and keeps headers ASCII', () => {
    const [m] = buildMessages([alert({ stationIds: ['place-zzz'] })], new Map(), stationName, 'https://x');
    expect(m.title).toBe('place-zzz: elevator out of service');
    expect(asciiHeader('Café – Line')).toBe('Cafe - Line');
  });
});

describe('runNotify', () => {
  const base = { now: NOW, texts, stationName, appUrl: 'https://lastmile.test' };

  it('dryRun returns the messages and sends nothing', async () => {
    const { f, calls } = fakeFetch();
    const r = await runNotify({ ...base, alerts: [alert()], source: 'v3', dryRun: true, fetch: f });
    expect(r.dryRun).toBe(true);
    expect(r.messages).toHaveLength(1);
    expect(r.sent).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('publishes to https://ntfy.sh/<topic> with Title, Tags and Click headers', async () => {
    const { f, calls } = fakeFetch();
    const r = await runNotify({ ...base, alerts: [alert()], source: 'v3', fetch: f });
    expect(r.sent).toEqual([{ topic: 'lastmile-place-dwnxg', ok: true, status: 200 }]);
    expect(calls[0].url).toBe(`${NTFY_BASE}/lastmile-place-dwnxg`);
    expect(calls[0].init.method).toBe('POST');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Title).toBe('Downtown Crossing: elevator out of service');
    expect(h.Tags).toBe('wheelchair');
    expect(h.Click).toBe('https://lastmile.test');
    expect(calls[0].init.body).toBe(alert().header);
  });

  it('test mode sends at most one message, to the test topic', async () => {
    const { f, calls } = fakeFetch();
    const two = [alert(), alert({ id: 'x', stationIds: ['place-cenav'] })];
    const r = await runNotify({ ...base, alerts: two, source: 'v3', test: true, fetch: f });
    expect(calls.map((c) => c.url)).toEqual([`${NTFY_BASE}/${TEST_TOPIC}`]);
    expect(r.sent[0].topic).toBe(TEST_TOPIC);
  });

  it('never sends demo-snapshot alerts, reports failures, and sends nothing when nothing is new', async () => {
    const { f, calls } = fakeFetch();
    const demo = await runNotify({ ...base, alerts: [alert()], source: 'demo', fetch: f });
    expect(demo.sent).toEqual([]);
    expect(demo.skipped).toMatch(/demo/);
    expect(calls).toHaveLength(0);

    const failing = fakeFetch(429);
    const r = await runNotify({ ...base, alerts: [alert()], source: 'v3', fetch: failing.f });
    expect(r.sent).toEqual([{ topic: 'lastmile-place-dwnxg', ok: false, status: 429 }]);

    const none = await runNotify({ ...base, alerts: [alert({ updatedAt: '2026-10-24T12:00:00-04:00' })], source: 'v3', fetch: f });
    expect(none.messages).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('clamps windowMin to 1..1440', async () => {
    expect((await runNotify({ ...base, alerts: [], source: 'v3', windowMin: 99999, dryRun: true })).windowMin).toBe(1440);
    expect((await runNotify({ ...base, alerts: [], source: 'v3', windowMin: 0.2, dryRun: true })).windowMin).toBe(1);
  });
});

describe('secretOk', () => {
  it('is open without a secret and exact-match with one', () => {
    expect(secretOk(undefined, null)).toBe(true);
    expect(secretOk('', null)).toBe(true);
    expect(secretOk('s3cret', 's3cret')).toBe(true);
    expect(secretOk('s3cret', 'nope')).toBe(false);
    expect(secretOk('s3cret', null)).toBe(false);
  });
});
