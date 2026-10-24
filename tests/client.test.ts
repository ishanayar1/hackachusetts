import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureMbtaClient, mbtaGet, MbtaHttpError, MBTA_BASE, resetMbtaClient } from '@/lib/mbta/client';
import { ALERTS_PATH } from '@/lib/mbta/alerts';

const FAKE_KEY = 'fake-test-key-not-real';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'network-error';

let clock = 1_000_000_000_000;
let calls: { url: string; headers: Record<string, string> }[] = [];
let replies: Reply[] = [];

function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
  const r = replies.length > 1 ? replies.shift()! : replies[0];
  if (!r) throw new Error('no reply queued');
  if (r === 'network-error') return Promise.reject(new TypeError('fetch failed'));
  const body = r.status === 304 || r.body === undefined ? null : JSON.stringify(r.body);
  return Promise.resolve(new Response(body, { status: r.status, headers: r.headers }));
}

beforeEach(() => {
  resetMbtaClient();
  calls = [];
  replies = [];
  clock = 1_000_000_000_000;
  configureMbtaClient({ fetch: fakeFetch, sleep: async () => {}, now: () => clock, apiKey: () => FAKE_KEY });
});
afterEach(() => {
  configureMbtaClient();
  resetMbtaClient();
});

describe('mbtaGet', () => {
  it('serves a cache hit within TTL without calling upstream', async () => {
    replies = [{ status: 200, body: { data: [1] } }];
    const a = await mbtaGet('/x', { ttlMs: 30_000 });
    clock += 10_000;
    const b = await mbtaGet('/x', { ttlMs: 30_000 });
    expect(calls).toHaveLength(1);
    expect(a.source).toBe('v3');
    expect(b.body).toEqual({ data: [1] });
    expect(b.fetchedAt).toBe(a.fetchedAt);
  });

  it('coalesces concurrent requests for the same path', async () => {
    replies = [{ status: 200, body: { data: [] } }];
    const [a, b] = await Promise.all([mbtaGet('/y', { ttlMs: 1000 }), mbtaGet('/y', { ttlMs: 1000 })]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('sends If-Modified-Since and reuses the body on 304', async () => {
    const lm = 'Sat, 24 Oct 2026 12:00:00 GMT';
    replies = [{ status: 200, body: { data: ['old'] }, headers: { 'last-modified': lm } }, { status: 304 }];
    await mbtaGet('/z', { ttlMs: 1000 });
    clock += 5000;
    const r = await mbtaGet('/z', { ttlMs: 1000 });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers['if-modified-since']).toBe(lm);
    expect(r.body).toEqual({ data: ['old'] });
    expect(r.source).toBe('v3');
    expect(r.fetchedAt).toBe(clock);
  });

  it('on 429 sets a cooldown, serves last-good and does not call upstream again before reset', async () => {
    const reset = String(Math.floor(clock / 1000) + 60);
    replies = [
      { status: 200, body: { data: ['good'] } },
      { status: 429, body: { errors: [{ code: 'rate_limited' }] }, headers: { 'x-ratelimit-reset': reset, 'x-ratelimit-remaining': '0' } },
    ];
    await mbtaGet('/a', { ttlMs: 1000 });
    clock += 2000;
    const r1 = await mbtaGet('/a', { ttlMs: 1000 });
    expect(r1.source).toBe('cache');
    expect(r1.body).toEqual({ data: ['good'] });
    expect(calls).toHaveLength(2); // 429 not retried
    clock += 20_000;
    const r2 = await mbtaGet('/a', { ttlMs: 1000 });
    expect(r2.source).toBe('cache');
    expect(calls).toHaveLength(2); // still cooling down
    clock = Number(reset) * 1000 + 2000;
    replies = [{ status: 200, body: { data: ['fresh'] } }];
    const r3 = await mbtaGet('/a', { ttlMs: 1000 });
    expect(r3.source).toBe('v3');
    expect(calls).toHaveLength(3);
  });

  it('stops calling when x-ratelimit-remaining <= 2 until reset', async () => {
    const reset = String(Math.floor(clock / 1000) + 30);
    replies = [{ status: 200, body: { data: ['ok'] }, headers: { 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': reset } }];
    const r0 = await mbtaGet('/b', { ttlMs: 1000 });
    expect(r0.source).toBe('v3');
    clock += 5000;
    const r1 = await mbtaGet('/b', { ttlMs: 1000 });
    expect(r1.source).toBe('cache');
    expect(calls).toHaveLength(1);
  });

  it('retries 5xx twice, then uses the fallback as demo', async () => {
    replies = [{ status: 503, body: { errors: [] } }];
    const r = await mbtaGet('/c', { ttlMs: 1000, fallback: async () => ({ data: ['demo'] }) });
    expect(calls).toHaveLength(3);
    expect(r.source).toBe('demo');
    expect(r.body).toEqual({ data: ['demo'] });
  });

  it('retries network errors, then serves last-good', async () => {
    replies = [{ status: 200, body: { data: ['lg'] } }];
    await mbtaGet('/d', { ttlMs: 1000 });
    clock += 2000;
    replies = ['network-error'];
    const r = await mbtaGet('/d', { ttlMs: 1000, fallback: async () => ({ data: ['demo'] }) });
    expect(calls).toHaveLength(4);
    expect(r.source).toBe('cache');
    expect(r.body).toEqual({ data: ['lg'] });
  });

  it('does not retry 404 and throws without fallback', async () => {
    replies = [{ status: 404, body: { errors: [{ code: 'not_found' }] } }];
    await expect(mbtaGet('/e', { ttlMs: 1000 })).rejects.toBeInstanceOf(MbtaHttpError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry 400 or 403', async () => {
    replies = [{ status: 403, body: {} }];
    await expect(mbtaGet('/f', { ttlMs: 1000 })).rejects.toThrow(/403/);
    replies = [{ status: 400, body: {} }];
    await expect(mbtaGet('/g', { ttlMs: 1000 })).rejects.toThrow(/400/);
    expect(calls).toHaveLength(2);
  });

  it('sends the key only as the x-api-key header, never in the URL or errors', async () => {
    replies = [{ status: 500, body: {} }];
    const err = await mbtaGet(ALERTS_PATH, { ttlMs: 1000 }).catch((e: Error) => e);
    expect(calls[0].headers['x-api-key']).toBe(FAKE_KEY);
    expect(calls[0].url).toBe(MBTA_BASE + ALERTS_PATH);
    expect(calls[0].url).not.toContain(FAKE_KEY);
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
  });

  it('canonical alerts path always has filter[activity]=ALL', () => {
    expect(ALERTS_PATH).toContain('filter[activity]=ALL');
    expect(ALERTS_PATH.startsWith('/alerts?')).toBe(true);
    expect(ALERTS_PATH).toContain('filter[route_type]=0,1');
    expect(ALERTS_PATH).toContain('include=facilities');
  });
});
