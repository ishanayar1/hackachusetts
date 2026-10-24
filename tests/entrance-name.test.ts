import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanEntranceName, doorNumber } from '@/lib/entrance-name';
import type { Station, StationPathways } from '@/lib/mbta/types';

describe('cleanEntranceName', () => {
  // Real raw names from MBTA GTFS stops.txt (location_type 2).
  const cases: [string, string, string][] = [
    ['1 | Boston Common (Elevator)', 'Park Street', 'Boston Common elevator entrance'],
    ['4 | Tremont St (Elevator)', 'Park Street', 'Tremont St elevator entrance'],
    ['5 | Tremont St', 'Park Street', 'Tremont St entrance'],
    ['Columbia Rd', 'JFK/UMass', 'Columbia Rd entrance'],
    ['101 Arch St, Summer St', 'Downtown Crossing', '101 Arch St / Summer St entrance'],
    ['Hawley St (Escalator)', 'Downtown Crossing', 'Hawley St escalator entrance'],
    ["Macy's", 'Downtown Crossing', "Macy's entrance"],
    ['Sydney St (North)', 'JFK/UMass', 'Sydney St north entrance'],
    ['Parking Garage (Elevators)', 'North Quincy', 'Parking Garage elevator entrance'],
    ['Newport Ave (Stairs)', 'Wollaston', 'Newport Ave stairs entrance'],
    ['Burgin Parkway (Ramp)', 'Quincy Center', 'Burgin Parkway ramp entrance'],
    ['Boylston St (Westbound ramp)', 'Eliot', 'Boylston St westbound ramp entrance'],
    ['Union St (East stairs)', 'Newton Centre', 'Union St east stairs entrance'],
    ['Massachusetts Ave (Northside)', 'Massachusetts Avenue', 'Massachusetts Ave north side entrance'],
    ['Elevator, Boylston St', 'Arlington', 'Boylston St elevator entrance'],
    ['Elevator, Buses, Main St, Third St, Carleton St', 'Kendall/MIT', 'Buses / Main St / Third St / Carleton St elevator entrance'],
    ['Elevator', 'Andrew', 'Elevator entrance'],
    ['Elevator (Oak Grove)', 'Chinatown', 'Elevator entrance (Oak Grove)'],
    ['Ocean Ave North Elevator', 'Wonderland', 'Ocean Ave North elevator entrance'],
    ['Congress St (Exchange Place)', 'State', 'Congress St entrance (Exchange Place)'],
    ['Clarendon St (Tracks 1 and 3)', 'Back Bay', 'Clarendon St entrance (Tracks 1 and 3)'],
    ['Massachusetts Ave (West), Buses', 'Porter', 'Massachusetts Ave west / Buses entrance'],
    ['Buses', 'Andrew', 'Bus entrance'],
    ['Street, Buses', 'Andrew', 'Street level / Buses entrance'],
    ['Beale Street, drop-off/pick-up', 'Wollaston', 'Beale Street / Pick-up and drop-off entrance'],
    ['Mattapan Line (Lobby)', 'Ashmont', 'Mattapan Line lobby entrance'],
    ['Public Garden ', 'Arlington', 'Public Garden entrance'],
    ['East', 'Woodland', 'East entrance'],
    ['1 | Silver Line - SL3, Airport Shuttle', 'Airport', 'Silver Line - SL3 / Airport Shuttle entrance'],
    ['Kent Street (street level)', 'Kent Street', 'Street-level entrance'],
  ];
  it.each(cases)('%s', (raw, station, want) => {
    expect(cleanEntranceName(raw, station)).toBe(want);
  });

  it('reads the MBTA door number', () => {
    expect(doorNumber('4 | Tremont St')).toBe('4');
    expect(doorNumber('101 Arch St, Summer St')).toBeNull();
    expect(doorNumber(undefined)).toBeNull();
  });

  it('says exit for exits, falls back to the station name, and is idempotent', () => {
    expect(cleanEntranceName('1 | Boston Common (Elevator)', 'Park Street', 'exit')).toBe('Boston Common elevator exit');
    expect(cleanEntranceName(undefined, 'Park Street')).toBe('Park Street entrance');
    expect(cleanEntranceName('  ', 'Park Street', 'exit')).toBe('Park Street exit');
    expect(cleanEntranceName('', undefined)).toBe('Entrance');
    const once = cleanEntranceName('1 | Boston Common (Elevator)', 'Park Street');
    expect(cleanEntranceName(once, 'Park Street')).toBe(once);
  });

  const DIR = path.resolve(__dirname, '..', 'public', 'data');
  it.skipIf(!existsSync(path.join(DIR, 'pathways.json')))('every real door name reads cleanly', () => {
    const pathways = JSON.parse(readFileSync(path.join(DIR, 'pathways.json'), 'utf8')) as Record<string, StationPathways>;
    const stations = JSON.parse(readFileSync(path.join(DIR, 'stations.json'), 'utf8')) as Station[];
    const names = new Map(stations.map((s) => [s.id, s.name]));
    let n = 0;
    for (const [sid, sp] of Object.entries(pathways)) {
      for (const node of Object.values(sp.nodes)) {
        if (node.kind !== 'entrance') continue;
        n++;
        const out = cleanEntranceName(node.name, names.get(sid));
        expect(out, node.name).toMatch(/^[A-Z0-9].* entrance( \([^()]+\))?$/);
        expect(out, node.name).not.toMatch(/\||\(\s*(Elevator|Escalator|Stairs|Ramp|North|South|East|West|street level)\s*\)|\s{2}|,/i);
      }
    }
    expect(n).toBeGreaterThan(300);
  });
});
