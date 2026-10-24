// Framework-agnostic loader for public/data/*.json (used by the server-only wrapper and the MCP server).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { StaticData } from '@/lib/router';
import type { Facility, ParkingLot, Station } from '@/lib/mbta/types';

export type FullStaticData = StaticData & {
  facilities: Facility[];
  parking: ParkingLot[];
  stationById: Map<string, Station>;
  facilityById: Map<string, Facility>;
};

function read<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as T;
}

export function loadStaticData(dir: string): FullStaticData {
  const stations = read<Station[]>(dir, 'stations.json');
  const facilities = read<Facility[]>(dir, 'facilities.json');
  return {
    stations,
    network: read(dir, 'network.json'),
    pathways: read(dir, 'pathways.json'),
    facilities,
    parking: read<ParkingLot[]>(dir, 'parking.json'),
    stationById: new Map(stations.map((s) => [s.id, s])),
    facilityById: new Map(facilities.map((f) => [f.id, f])),
  };
}

/** Facility ids are numeric strings in MBTA data; allow a conservative charset. */
export const FACILITY_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const STATION_ID_RE = /^place-[a-z0-9-]+$/;
