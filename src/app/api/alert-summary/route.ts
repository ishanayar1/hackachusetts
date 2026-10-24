// GET /api/alert-summary -> ApiEnvelope<{ items: { id, text, source: 'claude' | 'mbta' }[] }>
// One plain-English sentence per current accessibility alert (Claude Haiku when ANTHROPIC_API_KEY is set,
// otherwise the MBTA header text). Cached at the edge for 10 minutes; per-alert results cached 1 h in memory.
import { connection } from 'next/server';
import { getAlertsOrDemo } from '@/lib/lastmile-service';
import { isAccessibilityAlert, plainAlertTexts, type PlainAlertItem } from '@/lib/plain-alerts';
import { envelope, getParentOf, jsonWithCache, loadDemoAlerts, unavailable } from '@/lib/server/mbta';

export async function GET(request: Request) {
  await connection();
  try {
    const live = await getAlertsOrDemo(getParentOf(), () => loadDemoAlerts(new URL(request.url).origin));
    const items: PlainAlertItem[] = await plainAlertTexts(live.alerts.filter(isAccessibilityAlert));
    return jsonWithCache(envelope({ items }, live.result), 600, 300);
  } catch {
    return unavailable('Alert summary');
  }
}
