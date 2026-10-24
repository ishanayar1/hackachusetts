// POST or GET /api/notify/run -> publish new accessibility alerts to per-station ntfy.sh topics.
// Called every 10 minutes by .github/workflows/notify.yml. Stateless: see src/lib/notify.ts.
//   ?dryRun=1      return what would be sent, send nothing
//   ?windowMin=N   look back N minutes instead of 11 (1-1440; for testing)
//   ?test=1        send at most one message, to the test topic lastmile-test-hackachusetts
// When env NOTIFY_SECRET is set, every call needs header x-notify-secret with that value.
import { connection } from 'next/server';
import { getAlertsOrDemo } from '@/lib/lastmile-service';
import { runNotify, secretOk } from '@/lib/notify';
import { plainAlertTexts } from '@/lib/plain-alerts';
import { getParentOf, loadDemoAlerts } from '@/lib/server/mbta';
import { getStaticData } from '@/lib/server/static-data';

const NO_STORE = { 'Cache-Control': 'no-store' };

function stationNames(): (id: string) => string | undefined {
  try {
    const data = getStaticData();
    return (id) => data.stationById.get(id)?.name;
  } catch {
    return () => undefined;
  }
}

async function handle(request: Request): Promise<Response> {
  await connection();
  if (!secretOk(process.env.NOTIFY_SECRET, request.headers.get('x-notify-secret'))) {
    return Response.json({ error: 'missing or wrong x-notify-secret' }, { status: 401, headers: NO_STORE });
  }
  const url = new URL(request.url);
  const flag = (k: string) => ['1', 'true', 'yes'].includes((url.searchParams.get(k) ?? '').toLowerCase());
  const w = Number(url.searchParams.get('windowMin'));
  try {
    const live = await getAlertsOrDemo(getParentOf(), () => loadDemoAlerts(url.origin));
    const result = await runNotify({
      alerts: live.alerts,
      source: live.result.source,
      now: new Date(),
      windowMin: Number.isFinite(w) && w > 0 ? w : undefined,
      dryRun: flag('dryRun'),
      test: flag('test'),
      texts: async (alerts) => new Map((await plainAlertTexts(alerts)).map((i) => [i.id, i.text])),
      stationName: stationNames(),
      appUrl: (process.env.LASTMILE_URL || url.origin).replace(/\/+$/, ''),
    });
    return Response.json({ ...result, source: live.result.source }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: 'Notify run temporarily unavailable' }, { status: 503, headers: NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
