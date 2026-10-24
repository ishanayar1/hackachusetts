import { describe, expect, it } from 'vitest';
import { accessibleParkingNear, getDrive } from '@/lib/drive';
import { OSRM_CAR_URL } from '@/lib/walk';
import type { ParkingLot } from '@/lib/mbta/types';

const A = { lat: 42.3564, lon: -71.0621 };
const B = { lat: 42.3467, lon: -71.0972 };
const osrmOk = {
  code: 'Ok',
  routes: [
    {
      distance: 4369,
      duration: 467,
      geometry: { coordinates: [[-71.0621, 42.3564], [-71.0972, 42.3467]] },
      legs: [{ steps: [{ distance: 4369, name: 'Boylston Street', maneuver: { type: 'depart', modifier: 'west' } }] }],
    },
  ],
};

describe('getDrive', () => {
  it('uses the OSRM car profile and keeps its driving time', async () => {
    let called = '';
    const fetch = async (u: string) => {
      called = u;
      return { ok: true, status: 200, json: async () => osrmOk };
    };
    const { result } = await getDrive(A, B, { fetch, noCache: true });
    expect(called.startsWith(OSRM_CAR_URL)).toBe(true);
    expect(result.source).toBe('osrm');
    expect(result.distanceM).toBe(4369);
    expect(result.minutes).toBeCloseTo(467 / 60, 1);
    expect(result.steps[0].instruction).toBe('Head west on Boylston Street');
  });

  it('falls back to a straight line when OSRM is down', async () => {
    const fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const { result } = await getDrive(A, B, { fetch, noCache: true });
    expect(result.source).toBe('straight');
    expect(result.approximate).toBe(true);
    expect(result.coordinates).toEqual([
      [A.lon, A.lat],
      [B.lon, B.lat],
    ]);
  });
});

describe('accessibleParkingNear', () => {
  const lot = (id: string, accessibleSpaces: number | null, lat: number): ParkingLot => ({
    id,
    stationId: 's',
    name: id,
    capacity: 10,
    accessibleSpaces,
    lat,
    lon: -71.06,
  });

  it('lists only lots with accessible spaces within the radius, nearest first', () => {
    const lots = [lot('none', 0, 42.35), lot('unknown', null, 42.35), lot('far', 5, 42.5), lot('b', 2, 42.355), lot('c', 3, 42.351)];
    const near = accessibleParkingNear({ lat: 42.35, lon: -71.06 }, lots);
    expect(near.map((l) => l.id)).toEqual(['c', 'b']);
    expect(near[0].distanceM).toBeGreaterThan(100);
  });
});
