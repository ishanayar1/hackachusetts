// LastMile MBTA MCP server (stdio). Run from the repo root:
//   npx tsx --env-file=.env mcp/mbta/server.ts
// Logs go to stderr only (stdout carries JSON-RPC). The API key is never logged.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mbtaGet } from '../../src/lib/mbta/client';
import { normalizePredictions, predictionsPath, STOP_ID_RE } from '../../src/lib/mbta/live';
import {
  getLiveAlerts,
  parentOfFromStatic,
  planWithClosures,
  stationDetail,
} from '../../src/lib/lastmile-service';
import { loadStaticData, type FullStaticData } from '../../src/lib/static-data-fs';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const log = (...args: unknown[]) => console.error('[lastmile-mbta]', ...args);

let data: FullStaticData | null = null;
function staticData(): FullStaticData {
  if (!data) data = loadStaticData(DATA_DIR);
  return data;
}

const demoAlerts = async () => JSON.parse(await readFile(path.join(DATA_DIR, 'demo-alerts.json'), 'utf8'));
const alertsNow = () => getLiveAlerts(parentOfFromStatic(staticData()), demoAlerts);

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const stationId = z.string().regex(STOP_ID_RE).describe('Parent station id, e.g. place-pktrm');

const server = new McpServer({ name: 'lastmile-mbta', version: '0.1.0' });

server.registerTool(
  'get_alerts',
  {
    title: 'Get MBTA subway alerts',
    description:
      'Current MBTA subway alerts (incl. elevator/escalator closures), optionally filtered by station or route. Also returns closedFacilityIds.',
    inputSchema: {
      stationId: stationId.optional(),
      routeId: z.string().max(20).optional().describe('Route id, e.g. Red, Orange, Green-B'),
    },
  },
  async ({ stationId: sid, routeId }) => {
    try {
      const live = await alertsNow();
      const alerts = live.alerts.filter(
        (a) => (!sid || a.stationIds.includes(sid)) && (!routeId || a.routeIds.includes(routeId)),
      );
      return json({ source: live.result.source, count: alerts.length, closedFacilityIds: live.closedFacilityIds, alerts });
    } catch (e) {
      log('get_alerts failed', e instanceof Error ? e.message : 'error');
      return fail('Alerts temporarily unavailable');
    }
  },
);

server.registerTool(
  'get_station',
  {
    title: 'Get station accessibility',
    description: 'Station details: facilities with closed flags, step-free status (and which closures block it), parking, alerts.',
    inputSchema: { stationId },
  },
  async ({ stationId: sid }) => {
    try {
      const d = staticData();
      if (!d.stationById.has(sid)) return fail(`Unknown station ${sid}`);
      const live = await alertsNow();
      return json({ source: live.result.source, ...stationDetail(d, sid, live.alerts, live.closedFacilityIds) });
    } catch (e) {
      log('get_station failed', e instanceof Error ? e.message : 'error');
      return fail('Station temporarily unavailable');
    }
  },
);

server.registerTool(
  'plan_step_free_route',
  {
    title: 'Plan a step-free subway trip',
    description:
      'Step-free (no stairs/escalators) subway route between two stations, avoiding facilities closed by live alerts plus any extra closed facility ids.',
    inputSchema: {
      from: stationId,
      to: stationId,
      closed: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).max(50).optional().describe('Extra facility ids to treat as closed'),
    },
  },
  async ({ from, to, closed }) => {
    try {
      const d = staticData();
      const live = await alertsNow();
      return json({ source: live.result.source, ...planWithClosures(d, from, to, live.closedFacilityIds, closed ?? []) });
    } catch (e) {
      log('plan_step_free_route failed', e instanceof Error ? e.message : 'error');
      return fail('Route planning temporarily unavailable');
    }
  },
);

server.registerTool(
  'get_predictions',
  {
    title: 'Get next trains',
    description: 'Next subway departures at a station (up to 3 per route and direction).',
    inputSchema: { stationId },
  },
  async ({ stationId: sid }) => {
    try {
      const r = await mbtaGet(predictionsPath([sid]), { ttlMs: 20_000 });
      const predictions = normalizePredictions(r.body, new Date(), parentOfFromStatic(staticData()));
      return json({ source: r.source, count: predictions.length, predictions });
    } catch (e) {
      log('get_predictions failed', e instanceof Error ? e.message : 'error');
      return fail('Predictions temporarily unavailable');
    }
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
  log('ready (stdio)');
}

main().catch((e) => {
  log('fatal', e instanceof Error ? e.message : 'error');
  process.exit(1);
});
