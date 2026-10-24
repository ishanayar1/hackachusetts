// Interface translation with Claude (server side of /api/translate). English UI strings in, translations out;
// each (language, string) pair is translated once per server process and cached.
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, replyText } from './claude';

export const TRANSLATE_LANGS = {
  es: 'Spanish',
  pt: 'Brazilian Portuguese',
  ht: 'Haitian Creole',
  'zh-Hans': 'Simplified Chinese',
  vi: 'Vietnamese',
} as const;
export type TranslateLang = keyof typeof TRANSLATE_LANGS;

export const MAX_STRINGS = 80;
export const MAX_LEN = 400;

export function isTranslateLang(x: unknown): x is TranslateLang {
  return typeof x === 'string' && Object.hasOwn(TRANSLATE_LANGS, x);
}

/** Sorted {placeholder} names, so a translation must keep exactly the same ones. */
export const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

function system(lang: TranslateLang): string {
  return [
    `You translate the interface text of LastMile, a step-free MBTA subway trip planner for wheelchair users in Boston, into ${TRANSLATE_LANGS[lang]}.`,
    'The user message is a JSON array of English interface strings.',
    'Reply with only a JSON array of the same length: the translations, in the same order. No markdown, no comments.',
    'Keep every {placeholder} token exactly as written, untranslated.',
    'Keep station names, street names, MBTA, Bluebikes, Vision Zero, 311, numbers and units unchanged.',
    'Use plain, friendly wording a rider understands. Never describe a place or route as safe.',
  ].join(' ');
}

/** Pull the JSON array out of the reply and keep only well-formed translations (same placeholders). */
export function parseTranslations(source: string[], text: string | null): Record<string, string> {
  if (!text) return {};
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return {};
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!Array.isArray(arr) || arr.length !== source.length) return {};
  const out: Record<string, string> = {};
  source.forEach((en, i) => {
    const t = arr[i];
    if (typeof t !== 'string' || !t.trim() || t.length > MAX_LEN * 4) return;
    if (placeholders(t) !== placeholders(en)) return;
    out[en] = t.trim();
  });
  return out;
}

const cache = new Map<string, string>(); // per server process; UI strings are a bounded set
const cacheKey = (lang: string, s: string) => `${lang}\u0000${s}`;

/** Translations for the strings Claude handled; strings it skipped are simply absent (the UI shows English). */
export async function translateStrings(
  client: Anthropic,
  lang: TranslateLang,
  strings: string[],
): Promise<Record<string, string>> {
  const todo = [...new Set(strings)].filter((s) => !cache.has(cacheKey(lang, s)));
  if (todo.length) {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: system(lang),
      messages: [{ role: 'user', content: JSON.stringify(todo) }],
    });
    for (const [en, t] of Object.entries(parseTranslations(todo, replyText(msg)))) cache.set(cacheKey(lang, en), t);
  }
  const out: Record<string, string> = {};
  for (const s of strings) {
    const t = cache.get(cacheKey(lang, s));
    if (t !== undefined) out[s] = t;
  }
  return out;
}
