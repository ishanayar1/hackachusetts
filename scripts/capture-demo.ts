// Capture a demo snapshot of live MBTA alerts plus small test fixtures.
// Run: npx tsx --env-file=.env scripts/capture-demo.ts
// Never prints the API key.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mbtaGet } from '../src/lib/mbta/client';
import { ALERTS_PATH } from '../src/lib/mbta/alerts';
import { predictionsPath, VEHICLES_PATH } from '../src/lib/mbta/live';

const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'tests', 'fixtures');

/* eslint-disable @typescript-eslint/no-explicit-any */
function keepIncluded(json: any, data: any[]): any[] {
  const wanted = new Set<string>();
  for (const row of data) {
    for (const rel of Object.values<any>(row.relationships ?? {})) {
      const d = rel?.data;
      for (const x of Array.isArray(d) ? d : d ? [d] : []) wanted.add(`${x.type}:${x.id}`);
    }
  }
  return (json.included ?? []).filter((i: any) => wanted.has(`${i.type}:${i.id}`));
}

async function main() {
  if (!(process.env.MBTA_API_KEY ?? process.env.mbta)) console.warn('warning: no MBTA key in env, using anonymous limits');
  const capturedAt = new Date().toISOString();

  const alerts = await mbtaGet(ALERTS_PATH, { ttlMs: 0 });
  if (alerts.source !== 'v3') throw new Error('alerts did not come from v3');
  await mkdir(path.join(root, 'public', 'data'), { recursive: true });
  await writeFile(path.join(root, 'public', 'data', 'demo-alerts.json'), JSON.stringify(alerts.body));

  await mkdir(fixtures, { recursive: true });
  const all: any[] = alerts.body.data ?? [];
  const facilityEffects = new Set(['ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'ACCESS_ISSUE', 'FACILITY_ISSUE']);
  const dwnxg = all.filter((a) => (a.attributes.informed_entity ?? []).some((e: any) => e.stop === 'place-dwnxg'));
  const elev = all.filter((a) => a.attributes.effect === 'ELEVATOR_CLOSURE').slice(0, 8);
  const facil = all.filter((a) => facilityEffects.has(a.attributes.effect) && a.attributes.effect !== 'ELEVATOR_CLOSURE').slice(0, 4);
  const other = all.filter((a) => !facilityEffects.has(a.attributes.effect)).slice(0, 6);
  const picked = [...new Map([...dwnxg, ...elev, ...facil, ...other].map((a) => [a.id, a])).values()];
  const alertsFixture = { capturedAt, data: picked, included: keepIncluded(alerts.body, picked) };
  await writeFile(path.join(fixtures, 'alerts.json'), JSON.stringify(alertsFixture, null, 1));

  const preds = await mbtaGet(predictionsPath(['place-pktrm']), { ttlMs: 0 });
  const predData: any[] = (preds.body.data ?? []).slice(0, 60);
  await writeFile(
    path.join(fixtures, 'predictions-pktrm.json'),
    JSON.stringify({ capturedAt, data: predData, included: keepIncluded(preds.body, predData) }, null, 1),
  );

  const veh = await mbtaGet(VEHICLES_PATH, { ttlMs: 0 });
  const vehData: any[] = (veh.body.data ?? []).slice(0, 20);
  await writeFile(
    path.join(fixtures, 'vehicles.json'),
    JSON.stringify({ capturedAt, data: vehData, included: keepIncluded(veh.body, vehData) }, null, 1),
  );

  console.log(
    `alerts=${all.length} (fixture ${picked.length}, dwnxg ${dwnxg.length}, elevator ${elev.length}) ` +
      `predictions=${preds.body.data?.length ?? 0} vehicles=${veh.body.data?.length ?? 0}`,
  );
}

main().catch((e) => {
  console.error('capture failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
