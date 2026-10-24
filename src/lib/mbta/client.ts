// Framework-agnostic MBTA V3 client. No 'server-only' here so scripts, tests and the MCP server can use it.
// Never log or echo the API key. It is sent only as the x-api-key header.
import type { DataSource } from './types';

export const MBTA_BASE = 'https://api-v3.mbta.com';
export const TIMEOUT_MS = 5000;
export const MAX_RETRIES = 2;
const MAX_CACHE_ENTRIES = 300;

export interface MbtaResult {
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  source: DataSource;
  fetchedAt: number; // epoch ms of the last successful upstream fetch (or 304 revalidation)
}

export interface MbtaGetOptions {
  ttlMs: number;
  fallback?: () => Promise<unknown>;
}

export class MbtaHttpError extends Error {
  constructor(public status: number, path: string) {
    super(`MBTA ${status} for ${path.split('?')[0]}`);
    this.name = 'MbtaHttpError';
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface Hooks {
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  apiKey: () => string | undefined;
}

const defaultHooks: Hooks = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  apiKey: () => process.env.MBTA_API_KEY ?? process.env.mbta,
};
let hooks: Hooks = { ...defaultHooks };

interface Entry {
  body: unknown;
  fetchedAt: number;
  lastModified?: string;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<MbtaResult>>();
let cooldownUntil = 0; // epoch ms; the rate limit is per key, so this is global

/** Test/script hook: override fetch, sleep, clock or key lookup. Pass nothing to restore defaults. */
export function configureMbtaClient(over: Partial<Hooks> = {}): void {
  hooks = { ...defaultHooks, ...over };
}

/** Clears cache, in-flight map and rate-limit cooldown. */
export function resetMbtaClient(): void {
  cache.clear();
  inflight.clear();
  cooldownUntil = 0;
}

export function rateLimitCooldownUntil(): number {
  return cooldownUntil;
}

/**
 * GET an MBTA V3 path (e.g. "/alerts?filter[activity]=ALL") with TTL cache, request coalescing,
 * If-Modified-Since, retries, rate-limit cooldown and a last-good -> fallback -> throw chain.
 */
export async function mbtaGet(path: string, opts: MbtaGetOptions): Promise<MbtaResult> {
  const hit = cache.get(path);
  if (hit && hooks.now() - hit.fetchedAt < opts.ttlMs) {
    return { body: hit.body, source: 'v3', fetchedAt: hit.fetchedAt };
  }
  const pending = inflight.get(path);
  if (pending) return pending;
  const p = load(path, opts).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

function backoffMs(attempt: number): number {
  const base = attempt === 1 ? 500 : 1500;
  return base + Math.floor(Math.random() * 250);
}

function noteRateLimit(res: Response): void {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const resetMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 + 1000 : hooks.now() + 60_000;
  if (res.status === 429) {
    cooldownUntil = Math.max(cooldownUntil, resetMs);
  } else if (remaining !== null && Number(remaining) <= 2) {
    cooldownUntil = Math.max(cooldownUntil, resetMs);
  }
}

function store(path: string, entry: Entry): void {
  if (!cache.has(path) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(path);
  cache.set(path, entry);
}

async function load(path: string, opts: MbtaGetOptions): Promise<MbtaResult> {
  const prev = cache.get(path);
  let lastErr: unknown = new Error('MBTA request not attempted');

  if (hooks.now() < cooldownUntil) {
    lastErr = new MbtaHttpError(429, path);
  } else {
    const headers: Record<string, string> = { accept: 'application/vnd.api+json' };
    const key = hooks.apiKey();
    if (key) headers['x-api-key'] = key;
    if (prev?.lastModified) headers['if-modified-since'] = prev.lastModified;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await hooks.sleep(backoffMs(attempt));
      let res: Response;
      try {
        res = await hooks.fetch(MBTA_BASE + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        lastErr = e; // network error or timeout: retry
        continue;
      }
      if (res.status === 304 && prev) {
        prev.fetchedAt = hooks.now();
        return { body: prev.body, source: 'v3', fetchedAt: prev.fetchedAt };
      }
      noteRateLimit(res);
      if (res.ok) {
        try {
          const body = await res.json();
          const fetchedAt = hooks.now();
          store(path, { body, fetchedAt, lastModified: res.headers.get('last-modified') ?? undefined });
          return { body, source: 'v3', fetchedAt };
        } catch (e) {
          lastErr = e; // truncated/invalid body: treat like a transient failure
          continue;
        }
      }
      lastErr = new MbtaHttpError(res.status, path);
      if (res.status >= 500) continue; // retry 5xx
      break; // 429 (cooldown set) and other 4xx: never retry
    }
  }

  if (prev) return { body: prev.body, source: 'cache', fetchedAt: prev.fetchedAt };
  if (opts.fallback) {
    try {
      const body = await opts.fallback();
      if (body != null) return { body, source: 'demo', fetchedAt: hooks.now() };
    } catch {
      // fall through to throw the upstream error
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('MBTA request failed');
}
