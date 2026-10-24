import 'server-only';
// Server-only access to the walking-route warning data in public/data (read once per process, cached in warnings.ts).
import path from 'node:path';
import { loadWarningDataFromDisk, type WarningData } from '@/lib/warnings';

export function getWarningData(): WarningData {
  return loadWarningDataFromDisk(path.join(process.cwd(), 'public', 'data'));
}
