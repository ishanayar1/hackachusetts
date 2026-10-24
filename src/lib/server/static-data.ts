import 'server-only';
// Loads the static GTFS-derived files from public/data once per server process.
import path from 'node:path';
import { loadStaticData, type FullStaticData } from '@/lib/static-data-fs';

export type { FullStaticData } from '@/lib/static-data-fs';

let cached: FullStaticData | null = null;

/** Static data from public/data (read once, cached in memory). Throws if the files are missing. */
export function getStaticData(): FullStaticData {
  if (!cached) cached = loadStaticData(path.join(process.cwd(), 'public', 'data'));
  return cached;
}
