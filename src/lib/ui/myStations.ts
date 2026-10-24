'use client';
// "My stations": starred station ids kept in localStorage (on this device only).
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'lastmile.myStations';
const EMPTY: string[] = [];
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: string[]) {
  cache = ids;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked (private mode): keep the list for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

export function useMyStations() {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((id: string) => {
    const cur = read();
    write(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }, []);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, toggle, has };
}

/**
 * Saved stations that got worse since the last refresh: step-free -> partly or not step-free, or
 * partly -> not step-free. Values are true (step-free), 'partial', or false (not step-free).
 */
export type StepFreeLevel = boolean | 'partial';
const rank = (v: StepFreeLevel | undefined) => (v === true ? 2 : v === 'partial' ? 1 : v === false ? 0 : -1);

export function newlyBlocked(
  ids: string[],
  prev: Map<string, StepFreeLevel> | null,
  now: Map<string, StepFreeLevel>,
): string[] {
  if (!prev) return [];
  return ids.filter((id) => {
    const a = rank(prev.get(id));
    const b = rank(now.get(id));
    return a > 0 && b >= 0 && b < a;
  });
}
