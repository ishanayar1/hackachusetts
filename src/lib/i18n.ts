'use client';
// Interface text in other languages. English strings are the keys; anything not translated yet shows in English.
// Translations come from Claude through /api/translate (needs an Anthropic key on the server) and are cached
// in this browser per language. MBTA alert text, station and street names and data values stay as published.
import { useMemo, useSyncExternalStore } from 'react';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ht', label: 'Kreyòl ayisyen' },
  { code: 'zh-Hans', label: '中文 (简体)' },
  { code: 'vi', label: 'Tiếng Việt' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];
export type Vars = Record<string, string | number>;

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && LANGUAGES.some((l) => l.code === x);
}

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

// ---------- store: current language + translations, one value for the whole page ----------
const LANG_KEY = 'lastmile.lang';
const TABLE_KEY = (lang: Lang) => `lastmile.tr.${lang}`;
let current: Lang | null = null;
let version = 0;
const tables: Partial<Record<Lang, Record<string, string>>> = {};
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  for (const l of listeners) l();
};

function readLang(): Lang {
  if (current) return current;
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANG_KEY);
  } catch {
    // storage blocked: stay on English
  }
  current = isLang(saved) ? saved : 'en';
  return current;
}

function table(lang: Lang): Record<string, string> {
  if (!tables[lang]) {
    let saved: unknown = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(TABLE_KEY(lang)) ?? '{}');
    } catch {
      // no storage (tests, private mode): start empty
    }
    tables[lang] = saved && typeof saved === 'object' ? (saved as Record<string, string>) : {};
  }
  return tables[lang]!;
}

/** Add translations from /api/translate, keeping only strings with the same {placeholders}. Returns how many. */
export function mergeTranslations(lang: Lang, reply: unknown): number {
  if (lang === 'en' || !reply || typeof reply !== 'object') return 0;
  const t = table(lang);
  let added = 0;
  for (const [en, tr] of Object.entries(reply as Record<string, unknown>)) {
    if (typeof tr !== 'string' || !tr.trim() || placeholders(tr) !== placeholders(en)) continue;
    t[en] = tr;
    added++;
  }
  if (added) {
    try {
      window.localStorage.setItem(TABLE_KEY(lang), JSON.stringify(t));
    } catch {
      // not saved; still used for this visit
    }
    notify();
  }
  return added;
}

// ---------- fetch missing strings in batches ----------
const BATCH = 60;
const requested = new Set<string>(); // lang|key, asked once per page load (no retry storms on errors)
const pending: Partial<Record<Lang, Set<string>>> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

function request(lang: Lang, key: string) {
  if (typeof window === 'undefined') return;
  const id = `${lang}|${key}`;
  if (requested.has(id)) return;
  requested.add(id);
  (pending[lang] ??= new Set()).add(key);
  timer ??= setTimeout(flush, 150);
}

async function flush() {
  timer = null;
  for (const lang of Object.keys(pending) as Lang[]) {
    const keys = [...(pending[lang] ?? [])];
    pending[lang] = new Set();
    for (let i = 0; i < keys.length; i += BATCH) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lang, strings: keys.slice(i, i + BATCH) }),
        });
        if (res.ok) mergeTranslations(lang, ((await res.json()) as { translations?: unknown }).translations);
      } catch {
        // offline or server error: these strings stay English
      }
    }
  }
}

/** Translate an English interface string (English until a translation arrives), then fill {placeholders}. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  if (lang === 'en') return fill(key, vars);
  const hit = table(lang)[key];
  if (hit === undefined) request(lang, key);
  return fill(hit ?? key, vars);
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // not saved, still switches for this visit
  }
  try {
    document.documentElement.lang = lang;
  } catch {
    // no document (tests)
  }
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Current interface language. Server render and hydration use English, then the saved choice. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => 'en' as Lang);
}

export type T = ((key: string, vars?: Vars) => string) & { lang: Lang };

/** t('English text', { vars }) in the current language; re-renders when new translations arrive. */
export function useT(): T {
  const lang = useLang();
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  return useMemo(
    () => Object.assign((key: string, vars?: Vars) => translate(lang, key, vars), { lang }),
    // v: new translations arrived
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, v],
  );
}
