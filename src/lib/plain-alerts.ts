// Plain-language alert text (S5). With an Anthropic key (ANTHROPIC_API_KEY or "anthropic" in .env), Claude
// rewrites an MBTA accessibility alert as one short sentence for wheelchair users. Without a key, or on any
// error, the MBTA header text is used as-is (source 'mbta').
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, claudeClient, replyText, type ClaudeOptions } from '@/lib/claude';
import { FACILITY_CLOSURE_EFFECTS } from '@/lib/mbta/alerts';
import type { NormalizedAlert } from '@/lib/mbta/types';

export type PlainAlert = { text: string; source: 'claude' | 'mbta' };
export type PlainAlertItem = PlainAlert & { id: string };

export interface PlainAlertOptions extends ClaudeOptions {
  now?: () => number;
}

export const PLAIN_MODEL = CLAUDE_MODEL;
const TTL_MS = 60 * 60 * 1000; // 1 h per alert id + updated_at
const ERROR_TTL_MS = 5 * 60 * 1000; // after a failed call, use the MBTA text for 5 min before retrying
const MAX_CACHE = 500;
const MAX_TEXT = 300;
const CONCURRENCY = 4;

/** Effects that are accessibility alerts in their own right. */
const ACCESS_EFFECTS = new Set(['ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'ACCESS_ISSUE']);

/**
 * Current accessibility alert: elevator/escalator closures, access issues, and closures of other step-free
 * facilities (mini-high subplatforms, portable lifts, ramps) that MBTA tags with USING_WHEELCHAIR.
 */
export function isAccessibilityAlert(a: NormalizedAlert): boolean {
  if (!a.activeNow || a.informational) return false;
  if (ACCESS_EFFECTS.has(a.effect)) return true;
  return a.facilityIds.length > 0 && (FACILITY_CLOSURE_EFFECTS.has(a.effect) || a.activities.includes('USING_WHEELCHAIR'));
}

/** The MBTA's own text, trimmed. Never empty. */
export function mbtaText(a: Pick<NormalizedAlert, 'header' | 'shortHeader'>): string {
  const t = (a.header || a.shortHeader || '').replace(/\s+/g, ' ').trim();
  return t || 'Accessibility alert (the MBTA gave no details).';
}

const SYSTEM = [
  'You rewrite MBTA subway accessibility alerts for wheelchair users.',
  'Reply with exactly one short plain-English sentence, under 30 words: what is out, where, and what to do.',
  'Use only facts stated in the alert. Do not invent dates, times, alternatives, shuttles or elevator numbers.',
  'If the alert gives no advice, say to plan a step-free route that avoids it.',
  'Never call anything "safe". No markdown, no quotes, no preamble.',
].join(' ');

function userPrompt(a: NormalizedAlert): string {
  const desc = (a.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return [`Effect: ${a.effect}`, `Alert: ${mbtaText(a)}`, desc ? `Details: ${desc}` : ''].filter(Boolean).join('\n');
}

const cache = new Map<string, { value: PlainAlert; expires: number }>();

/** Test hook. */
export function clearPlainAlertCache(): void {
  cache.clear();
}

async function askClaude(a: NormalizedAlert, client: Anthropic): Promise<string | null> {
  try {
    const msg = await client.messages.create({
      model: PLAIN_MODEL,
      max_tokens: 2000, // thinking is always on for this model; leave room beyond the one-sentence answer
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(a) }],
    });
    const text = replyText(msg)?.replace(/\s+/g, ' ');
    if (!text || text.length > MAX_TEXT) return null;
    if (/\bsafe(ly|ty)?\b/i.test(text)) return null; // house rule: never say "safe"
    return text;
  } catch {
    return null;
  }
}

/** One plain sentence for an alert: Claude when a key is set and the call works, else the MBTA header. */
export async function plainAlertText(a: NormalizedAlert, opts: PlainAlertOptions = {}): Promise<PlainAlert> {
  const fallback: PlainAlert = { text: mbtaText(a), source: 'mbta' };
  const client = claudeClient({ timeoutMs: 8000, ...opts });
  if (!client) return fallback;
  const now = (opts.now ?? Date.now)();
  const key = `${a.id}|${a.updatedAt}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;
  const text = await askClaude(a, client);
  const value: PlainAlert = text ? { text, source: 'claude' } : fallback;
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: now + (text ? TTL_MS : ERROR_TTL_MS) });
  return value;
}

/** plainAlertText for many alerts, at most 4 Claude calls in flight. Keeps input order. */
export async function plainAlertTexts(alerts: NormalizedAlert[], opts: PlainAlertOptions = {}): Promise<PlainAlertItem[]> {
  const out: PlainAlertItem[] = new Array(alerts.length);
  let next = 0;
  const worker = async () => {
    while (next < alerts.length) {
      const i = next++;
      out[i] = { id: alerts[i].id, ...(await plainAlertText(alerts[i], opts)) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, alerts.length) }, worker));
  return out;
}
