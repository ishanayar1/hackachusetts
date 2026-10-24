import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedAlert } from '@/lib/mbta/types';
import {
  PLAIN_MODEL,
  clearPlainAlertCache,
  isAccessibilityAlert,
  mbtaText,
  plainAlertText,
  plainAlertTexts,
} from '@/lib/plain-alerts';

function alert(over: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    id: '1040976',
    effect: 'ELEVATOR_CLOSURE',
    header: 'Downtown Crossing Elevator 804 (Lobby to Orange Line platform) unavailable due to maintenance.',
    shortHeader: 'Downtown Crossing Elevator 804 unavailable',
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
    updatedAt: '2026-10-24T13:19:01-04:00',
    ...over,
  };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply();
  };
  return { f, calls };
}

const claudeReply = (text: string, stop = 'end_turn') => () =>
  Response.json({ content: [{ type: 'text', text }], stop_reason: stop });

beforeEach(() => clearPlainAlertCache());

describe('plainAlertText', () => {
  it('falls back to the MBTA header without a key and never calls fetch', async () => {
    const { f, calls } = fakeFetch(claudeReply('x'));
    const r = await plainAlertText(alert(), { apiKey: '', fetch: f });
    expect(r).toEqual({ text: alert().header, source: 'mbta' });
    expect(calls).toHaveLength(0);
  });

  it('calls the Messages API with the right model, headers and limits', async () => {
    const { f, calls } = fakeFetch(claudeReply('The Orange Line elevator at Downtown Crossing is out; plan a step-free route that avoids it.'));
    const r = await plainAlertText(alert(), { apiKey: 'test-key', fetch: f });
    expect(r.source).toBe('claude');
    expect(r.text).toMatch(/Downtown Crossing/);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].url)).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe(PLAIN_MODEL);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.messages[0].content).toContain('Elevator 804');
  });

  it('caches per alert id + updated_at for an hour', async () => {
    let n = 0;
    const { f, calls } = fakeFetch(() => Response.json({ content: [{ type: 'text', text: `Sentence ${++n}.` }] }));
    let now = 1_000_000;
    const opts = { apiKey: 'k', fetch: f, now: () => now };
    expect((await plainAlertText(alert(), opts)).text).toBe('Sentence 1.');
    expect((await plainAlertText(alert(), opts)).text).toBe('Sentence 1.');
    expect(calls).toHaveLength(1);
    // updated alert -> new call
    expect((await plainAlertText(alert({ updatedAt: '2026-10-24T14:00:00-04:00' }), opts)).text).toBe('Sentence 2.');
    // after 1 h the first entry expires
    now += 60 * 60 * 1000 + 1;
    expect((await plainAlertText(alert(), opts)).text).toBe('Sentence 3.');
    expect(calls).toHaveLength(3);
  });

  it('falls back on HTTP errors, network errors, refusals, empty text and the word "safe"', async () => {
    const cases: (() => Response | Promise<Response>)[] = [
      () => new Response('overloaded', { status: 529 }),
      () => Promise.reject(new Error('network down')),
      claudeReply('', 'end_turn'),
      claudeReply('No.', 'refusal'),
      claudeReply('Downtown Crossing is safe to use via the Franklin St elevator.'),
      () => new Response('not json', { status: 200 }),
    ];
    for (const reply of cases) {
      clearPlainAlertCache();
      const { f } = fakeFetch(reply);
      const r = await plainAlertText(alert(), { apiKey: 'k', fetch: f });
      expect(r).toEqual({ text: alert().header, source: 'mbta' });
    }
  });

  it('mbtaText is never empty', () => {
    expect(mbtaText({ header: '', shortHeader: '' })).toMatch(/Accessibility alert/);
    expect(mbtaText({ header: '  Elevator  out \n now ', shortHeader: '' })).toBe('Elevator out now');
  });
});

describe('plainAlertTexts', () => {
  it('keeps order and ids', async () => {
    const { f } = fakeFetch(() => Promise.reject(new Error('x')));
    const items = await plainAlertTexts([alert({ id: 'a' }), alert({ id: 'b', header: 'B text' })], { apiKey: 'k', fetch: f });
    expect(items.map((i) => [i.id, i.text, i.source])).toEqual([
      ['a', alert().header, 'mbta'],
      ['b', 'B text', 'mbta'],
    ]);
  });
});

describe('isAccessibilityAlert', () => {
  it('matches elevator/escalator/access effects and wheelchair facility closures only when active', () => {
    expect(isAccessibilityAlert(alert())).toBe(true);
    expect(isAccessibilityAlert(alert({ effect: 'ESCALATOR_CLOSURE', activities: ['USING_ESCALATOR'] }))).toBe(true);
    // real shape: Central Avenue mini-high platform, ACCESS_ISSUE on facility subplat-cenav-1
    expect(isAccessibilityAlert(alert({ effect: 'ACCESS_ISSUE', facilityIds: ['subplat-cenav-1'] }))).toBe(true);
    expect(isAccessibilityAlert(alert({ effect: 'FACILITY_ISSUE', facilityIds: ['lift-x'], activities: [] }))).toBe(true);
    expect(isAccessibilityAlert(alert({ activeNow: false }))).toBe(false);
    expect(isAccessibilityAlert(alert({ effect: 'DELAY', facilityIds: [], activities: ['BOARD'] }))).toBe(false);
    expect(isAccessibilityAlert(alert({ effect: 'NOTICE', facilityIds: [], informational: true }))).toBe(false);
  });
});
