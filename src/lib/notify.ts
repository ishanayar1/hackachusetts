// Phone alerts through ntfy.sh (free, no account). One topic per station: "lastmile-" + stationId,
// e.g. lastmile-place-dwnxg. Riders subscribe in the ntfy app or at https://ntfy.sh/<topic>.
//
// Stateless: each run (GitHub Actions cron every 10 min, .github/workflows/notify.yml) publishes the
// accessibility alerts created or updated in the last 11 minutes. The 1-minute overlap can rarely repeat a
// message; a cron run GitHub delays by more than a minute can miss one. That is the price of no database.
// In-app alerts remain the primary channel.
//
// Out of scope: email (needs a mail-provider API key) and browser Web Push (needs VAPID keys plus storage
// for each browser's subscription). ntfy needs neither.
import { timingSafeEqual, createHash } from 'node:crypto';
import type { NormalizedAlert } from '@/lib/mbta/types';
import { isAccessibilityAlert } from '@/lib/plain-alerts';

export const NTFY_BASE = 'https://ntfy.sh';
export const TOPIC_PREFIX = 'lastmile-';
export const TEST_TOPIC = 'lastmile-test-hackachusetts';
export const DEFAULT_WINDOW_MIN = 11;
export const MAX_WINDOW_MIN = 24 * 60;
const MAX_MESSAGE = 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function topicFor(stationId: string): string {
  return TOPIC_PREFIX + stationId;
}

export function subscribeUrl(stationId: string): string {
  return `${NTFY_BASE}/${topicFor(stationId)}`;
}

/** Accessibility alerts whose updated_at (or created_at when MBTA sends no update) is within the window. */
export function recentAccessibilityAlerts(alerts: NormalizedAlert[], now: Date, windowMin = DEFAULT_WINDOW_MIN): NormalizedAlert[] {
  const t = now.getTime();
  return alerts.filter((a) => {
    if (!isAccessibilityAlert(a)) return false;
    const u = Date.parse(a.updatedAt);
    return !Number.isNaN(u) && u <= t + CLOCK_SKEW_MS && t - u <= windowMin * 60_000;
  });
}

const EFFECT_LABEL: Record<string, string> = {
  ELEVATOR_CLOSURE: 'elevator out of service',
  ESCALATOR_CLOSURE: 'escalator out of service',
  ACCESS_ISSUE: 'accessibility issue',
};

export interface NtfyMessage {
  topic: string;
  stationId: string;
  title: string;
  message: string;
  tags: 'wheelchair';
  click: string;
  alertIds: string[];
}

/** HTTP header values must be Latin-1; keep titles plain ASCII. */
export function asciiHeader(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** One message per affected station. `texts` maps alert id -> sentence (plain-language or MBTA header). */
export function buildMessages(
  alerts: NormalizedAlert[],
  texts: Map<string, string>,
  stationName: (id: string) => string | undefined,
  appUrl: string,
): NtfyMessage[] {
  const byStation = new Map<string, NormalizedAlert[]>();
  for (const a of alerts) {
    for (const s of a.stationIds) {
      const list = byStation.get(s) ?? [];
      if (!list.some((x) => x.id === a.id)) list.push(a);
      byStation.set(s, list);
    }
  }
  return [...byStation.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([stationId, list]) => {
      const name = stationName(stationId) ?? stationId;
      const label = list.length === 1 ? (EFFECT_LABEL[list[0].effect] ?? 'accessibility alert') : `${list.length} accessibility alerts`;
      const message = list
        .map((a) => texts.get(a.id) ?? (a.header || a.shortHeader || 'Accessibility alert'))
        .join('\n')
        .slice(0, MAX_MESSAGE);
      return {
        topic: topicFor(stationId),
        stationId,
        title: asciiHeader(`${name}: ${label}`),
        message,
        tags: 'wheelchair' as const,
        click: appUrl,
        alertIds: list.map((a) => a.id),
      };
    });
}

export interface PublishResult {
  topic: string;
  ok: boolean;
  status: number; // 0 when the request itself failed
}

export async function publish(m: NtfyMessage, f: FetchLike = (u, i) => fetch(u, i)): Promise<PublishResult> {
  try {
    const res = await f(`${NTFY_BASE}/${m.topic}`, {
      method: 'POST',
      headers: { Title: m.title, Tags: m.tags, Click: m.click, 'Content-Type': 'text/plain; charset=utf-8' },
      body: m.message,
      signal: AbortSignal.timeout(5000),
    });
    return { topic: m.topic, ok: res.ok, status: res.status };
  } catch {
    return { topic: m.topic, ok: false, status: 0 };
  }
}

/** True when no secret is configured, or the header matches it (constant-time). */
export function secretOk(expected: string | undefined, given: string | null): boolean {
  if (!expected) return true;
  if (!given) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(expected), h(given));
}

export interface RunOptions {
  alerts: NormalizedAlert[];
  source: string; // 'v3' | 'cache' | 'demo'
  now: Date;
  windowMin?: number;
  dryRun?: boolean;
  test?: boolean; // send at most one message, to TEST_TOPIC instead of the station topic
  texts: (alerts: NormalizedAlert[]) => Promise<Map<string, string>>;
  stationName: (id: string) => string | undefined;
  appUrl: string;
  fetch?: FetchLike;
}

export interface RunResult {
  dryRun: boolean;
  windowMin: number;
  alertsChecked: number;
  recentAlertIds: string[];
  messages: NtfyMessage[];
  sent: PublishResult[];
  skipped?: string;
}

export async function runNotify(o: RunOptions): Promise<RunResult> {
  const windowMin = Math.min(MAX_WINDOW_MIN, Math.max(1, Math.round(o.windowMin ?? DEFAULT_WINDOW_MIN)));
  const recent = recentAccessibilityAlerts(o.alerts, o.now, windowMin);
  const texts = recent.length ? await o.texts(recent) : new Map<string, string>();
  let messages = buildMessages(recent, texts, o.stationName, o.appUrl);
  if (o.test) messages = messages.slice(0, 1).map((m) => ({ ...m, topic: TEST_TOPIC }));
  const base = { dryRun: !!o.dryRun, windowMin, alertsChecked: o.alerts.length, recentAlertIds: recent.map((a) => a.id), messages };
  if (o.dryRun) return { ...base, sent: [] };
  // Never push a bundled demo snapshot to riders' phones.
  if (o.source === 'demo') return { ...base, sent: [], skipped: 'live alerts unavailable (demo data); nothing sent' };
  const sent: PublishResult[] = [];
  for (const m of messages) sent.push(await publish(m, o.fetch));
  return { ...base, sent };
}
