import 'server-only';
// Loads public/data/crash-risk.geojson once per server process (static, precomputed; nothing here calls out at runtime
// unless the file is missing on disk, in which case it is fetched once from our own origin).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { toCrashSpots, type CrashSpot } from '@/lib/crash';

const FILE = path.join(process.cwd(), 'public', 'data', 'crash-risk.geojson');

let cached: { spots: CrashSpot[]; loadedAt: number } | null = null;
let pending: Promise<{ spots: CrashSpot[]; loadedAt: number }> | null = null;

async function load(origin?: string): Promise<{ spots: CrashSpot[]; loadedAt: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    if (!origin) throw new Error('crash data unavailable');
    const res = await fetch(`${origin}/data/crash-risk.geojson`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('crash data unavailable');
    raw = await res.json();
  }
  const spots = toCrashSpots(raw);
  if (!spots.length) throw new Error('crash data empty');
  return { spots, loadedAt: Date.now() };
}

/** All crash spots (cached in memory after the first successful load). Throws when the data cannot be read. */
export async function getCrashSpots(origin?: string): Promise<{ spots: CrashSpot[]; loadedAt: number }> {
  if (cached) return cached;
  if (!pending) {
    pending = load(origin)
      .then((r) => (cached = r))
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
