import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Network, PathwayEdge, RouteId, Station, StationPathways } from '@/lib/mbta/types';
import {
  planStepFree,
  reachable,
  stationStatus,
  streetAccess,
  streetAccessInfo,
  nearestStepFree,
  type StaticData,
  type RideLeg,
} from '@/lib/router';

// ---------------------------------------------------------------- tiny hand-built network
// Red:    O - T1 - T2 - X       (2 min per hop)
// Orange: T1 - D                (2 min)
// Blue:   T2 - D                (3 min)
// Each station: door --walkway-- mezz; each line has an island node joined to its two
// direction platforms by walkways, and the island reaches the mezz only by elevator EL-<st>-<route>.

type LineDef = { route: RouteId; stations: string[]; minutes: number[] };
const COORDS: Record<string, [number, number]> = {
  O: [42.35, -71.06],
  T1: [42.355, -71.06],
  T2: [42.36, -71.06],
  X: [42.365, -71.06],
  D: [42.358, -71.05],
};

function pair(a: string, b: string, mode: PathwayEdge['mode'], facilityId: string | null, seconds: number): PathwayEdge[] {
  return [
    { from: a, to: b, mode, facilityId, seconds },
    { from: b, to: a, mode, facilityId, seconds },
  ];
}

function build(lines: LineDef[], opts: { noPathways?: string[]; wheelchair?: Record<string, 0 | 1 | 2>; stairsOnly?: string[] } = {}) {
  const stations = new Map<string, Station>();
  const network: Network = { platforms: {}, rides: [] };
  const pathways: Record<string, StationPathways> = {};
  const st = (id: string): Station => {
    let s = stations.get(id);
    if (!s) {
      s = {
        id,
        name: id,
        lat: COORDS[id][0],
        lon: COORDS[id][1],
        wheelchair: opts.wheelchair?.[id] ?? 1,
        routes: [],
        platformIds: [],
        entranceIds: [`${id}-door`],
        facilityIds: [],
      };
      stations.set(id, s);
    }
    return s;
  };
  const sp = (id: string): StationPathways => {
    if (!pathways[id]) {
      pathways[id] = {
        nodes: { [`${id}-door`]: { kind: 'entrance', wheelchair: 1 }, [`${id}-mezz`]: { kind: 'node', wheelchair: 0 } },
        edges: pair(`${id}-door`, `${id}-mezz`, 1, null, 20),
      };
    }
    return pathways[id];
  };
  for (const line of lines) {
    for (const sid of line.stations) {
      const s = st(sid);
      s.routes.push(line.route);
      const island = `${sid}-${line.route}-island`;
      const g = sp(sid);
      g.nodes[island] = { kind: 'node', wheelchair: 0 };
      const fac = `EL-${sid}-${line.route}`;
      if (opts.stairsOnly?.includes(sid)) {
        g.edges.push(...pair(island, `${sid}-mezz`, 2, null, 30));
      } else {
        g.edges.push(...pair(island, `${sid}-mezz`, 5, fac, 30));
        s.facilityIds.push(fac);
      }
      for (const dir of [0, 1] as const) {
        const pid = `${sid}-${line.route}-${dir}`;
        network.platforms[pid] = { id: pid, stationId: sid, name: pid, routes: [line.route] };
        s.platformIds.push(pid);
        g.nodes[pid] = { kind: 'platform', wheelchair: 1 };
        g.edges.push(...pair(pid, island, 1, null, 10));
      }
    }
    for (let i = 0; i + 1 < line.stations.length; i++) {
      const a = line.stations[i];
      const b = line.stations[i + 1];
      network.rides.push({ from: `${a}-${line.route}-0`, to: `${b}-${line.route}-0`, route: line.route, directionId: 0, minutes: line.minutes[i] });
      network.rides.push({ from: `${b}-${line.route}-1`, to: `${a}-${line.route}-1`, route: line.route, directionId: 1, minutes: line.minutes[i] });
    }
  }
  for (const id of opts.noPathways ?? []) delete pathways[id];
  return { stations: [...stations.values()], network, pathways } satisfies StaticData;
}

const LINES: LineDef[] = [
  { route: 'Red', stations: ['O', 'T1', 'T2', 'X'], minutes: [2, 2, 2] },
  { route: 'Orange', stations: ['T1', 'D'], minutes: [2] },
  { route: 'Blue', stations: ['T2', 'D'], minutes: [3] },
];

describe('reachable', () => {
  const data = build(LINES);
  const g = data.pathways.T1;
  it('walks through elevators and walkways', () => {
    expect(reachable(g, ['T1-door'], ['T1-Red-0'], new Set())).toBe(true);
  });
  it('a closed elevator cuts the path (both directed rows)', () => {
    const closed = new Set(['EL-T1-Red']);
    expect(reachable(g, ['T1-door'], ['T1-Red-0'], closed)).toBe(false);
    expect(reachable(g, ['T1-Red-0'], ['T1-door'], closed)).toBe(false);
  });
  it('never uses stairs or escalators', () => {
    const d2 = build(LINES, { stairsOnly: ['T1'] });
    expect(reachable(d2.pathways.T1, ['T1-door'], ['T1-Red-0'], new Set())).toBe(false);
    const esc: StationPathways = {
      nodes: { a: { kind: 'entrance', wheelchair: 1 }, b: { kind: 'platform', wheelchair: 1 } },
      edges: pair('a', 'b', 4, 'ESC-1', 30),
    };
    expect(reachable(esc, ['a'], ['b'], new Set())).toBe(false);
  });
});

describe('stationStatus', () => {
  it('station whose only elevator is closed is not step-free and names the elevator', () => {
    const data = build(LINES);
    expect(stationStatus(data, 'X').stepFree).toBe(true);
    const s = stationStatus(data, 'X', new Set(['EL-X-Red', 'EL-O-Red']));
    expect(s.stepFree).toBe(false);
    expect(s.approximate).toBe(false);
    expect(s.blockedBy).toEqual(['EL-X-Red']);
    expect(Object.values(s.platforms).every((v) => v === false)).toBe(true);
  });
  it('one line closed at a transfer station: still step-free, per-platform detail', () => {
    const data = build(LINES);
    const s = stationStatus(data, 'T1', new Set(['EL-T1-Orange']));
    expect(s.stepFree).toBe(true);
    expect(s.platforms['T1-Orange-0']).toBe(false);
    expect(s.platforms['T1-Red-0']).toBe(true);
    expect(s.blockedBy).toEqual(['EL-T1-Orange']);
  });
  it('closures that do not cut access are not in blockedBy', () => {
    const data = build(LINES);
    data.pathways.T1.edges.push(...pair('T1-door', 'T1-mezz', 5, 'EL-T1-spare', 20));
    const s = stationStatus(data, 'T1', new Set(['EL-T1-spare']));
    expect(s.stepFree).toBe(true);
    expect(s.blockedBy).toEqual([]);
  });
  it('step-free entrance flag matters: wheelchair=2 door does not count', () => {
    const data = build(LINES);
    data.pathways.O.nodes['O-door'].wheelchair = 2;
    expect(stationStatus(data, 'O').stepFree).toBe(false);
    expect(streetAccess(data, 'O', 'O-Red-0', new Set())).toBe(false);
  });
  it('falls back to the station flag when there is no pathway data, marked approximate', () => {
    const ok = build(LINES, { noPathways: ['D'] });
    expect(streetAccessInfo(ok, 'D', 'D-Orange-1')).toEqual({ ok: true, approximate: true });
    expect(stationStatus(ok, 'D')).toMatchObject({ stepFree: true, approximate: true });
    const bad = build(LINES, { noPathways: ['D'], wheelchair: { D: 2 } });
    expect(stationStatus(bad, 'D')).toMatchObject({ stepFree: false, approximate: true });
  });
});

describe('planStepFree', () => {
  const data = build(LINES);

  it('baseline: Red to T1, transfer, Orange to D', () => {
    const r = planStepFree(data, { from: 'O', to: 'D' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.legs.map((l) => l.kind)).toEqual(['ride', 'transfer', 'ride']);
    expect((r.legs[0] as RideLeg).route).toBe('Red');
    expect(r.legs[1]).toMatchObject({ kind: 'transfer', stationId: 'T1' });
    expect((r.legs[2] as RideLeg).route).toBe('Orange');
    expect(r.transfers).toBe(1);
    expect(r.minutes).toBe(6);
    expect(r.usedFacilityIds).toContain('EL-T1-Red');
    expect(r.usedFacilityIds).toContain('EL-T1-Orange');
    expect(r.originEntranceId).toBe('O-door');
    expect(r.destinationExitId).toBe('D-door');
  });

  it('reroutes around a closed transfer elevator', () => {
    const closed = new Set(['EL-T1-Orange']);
    const r = planStepFree(data, { from: 'O', to: 'D', closed });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.usedFacilityIds).not.toContain('EL-T1-Orange');
    const red = r.legs[0] as RideLeg;
    expect(red.route).toBe('Red');
    expect(red.stationIds).toEqual(['O', 'T1', 'T2']);
    expect(r.legs[1]).toMatchObject({ kind: 'transfer', stationId: 'T2' });
    expect((r.legs[2] as RideLeg).route).toBe('Blue');
    expect(r.minutes).toBe(9);
  });

  it('destination whose only elevator is closed: destination-not-step-free with alternatives', () => {
    const r = planStepFree(data, { from: 'O', to: 'X', closed: new Set(['EL-X-Red']) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('destination-not-step-free');
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.length).toBeLessThanOrEqual(3);
    expect(r.alternatives[0].stationId).toBe('T2'); // nearest to X
    expect(r.alternatives.map((a) => a.stationId)).not.toContain('X');
    for (let i = 1; i < r.alternatives.length; i++) {
      expect(r.alternatives[i].distanceKm).toBeGreaterThanOrEqual(r.alternatives[i - 1].distanceKm);
    }
  });

  it('origin whose only elevator is closed: origin-not-step-free', () => {
    const r = planStepFree(data, { from: 'X', to: 'O', closed: new Set(['EL-X-Red']) });
    expect(r).toMatchObject({ ok: false, reason: 'origin-not-step-free' });
  });

  it('a closed elevator at an intermediate station does not block riding through it', () => {
    const r = planStepFree(data, { from: 'O', to: 'X', closed: new Set(['EL-T1-Red', 'EL-T2-Red']) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.legs).toHaveLength(1);
  });

  it('no-path when both transfers are closed', () => {
    const r = planStepFree(data, { from: 'O', to: 'D', closed: new Set(['EL-T1-Orange', 'EL-T2-Blue']) });
    expect(r).toMatchObject({ ok: false, reason: 'no-path' });
  });

  it('unknown station', () => {
    expect(planStepFree(data, { from: 'nope', to: 'D' })).toMatchObject({ ok: false, reason: 'unknown-station', alternatives: [] });
  });

  it('same station returns ok with zero legs', () => {
    expect(planStepFree(data, { from: 'T1', to: 'T1' })).toMatchObject({ ok: true, minutes: 0, legs: [], transfers: 0 });
  });

  it('accepts closed as an array', () => {
    const r = planStepFree(data, { from: 'O', to: 'X', closed: ['EL-X-Red'] });
    expect(r.ok).toBe(false);
  });

  it('nearestStepFree skips stations that are not step-free', () => {
    const near = nearestStepFree(data, COORDS.X[0], COORDS.X[1], new Set(['EL-X-Red', 'EL-T2-Red', 'EL-T2-Blue']), 2);
    expect(near.map((n) => n.stationId)).toEqual(['T1', 'D']); // T1 1.11 km, D 1.13 km, O 1.67 km
  });
});

// ---------------------------------------------------------------- real data (only when the build has run)
const DATA_DIR = path.resolve(__dirname, '..', 'public', 'data');
const haveReal = ['stations.json', 'network.json', 'pathways.json'].every((f) => fs.existsSync(path.join(DATA_DIR, f)));

describe.skipIf(!haveReal)('real MBTA data', () => {
  const load = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) as T;
  const data: StaticData = haveReal
    ? { stations: load('stations.json'), network: load('network.json'), pathways: load('pathways.json') }
    : { stations: [], network: { platforms: {}, rides: [] }, pathways: {} };

  it('Park Street to Downtown Crossing resolves with nothing closed', () => {
    const r = planStepFree(data, { from: 'place-pktrm', to: 'place-dwnxg' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.minutes).toBeGreaterThan(0);
      expect(r.minutes).toBeLessThan(15);
    }
  });

  it('Downtown Crossing to Park Street resolves with nothing closed', () => {
    expect(planStepFree(data, { from: 'place-dwnxg', to: 'place-pktrm' }).ok).toBe(true);
  });

  it('a cross-line trip resolves (Alewife to Government Center)', () => {
    const r = planStepFree(data, { from: 'place-alfcl', to: 'place-gover' });
    expect(r.ok).toBe(true);
  });

  it('closing every facility at Downtown Crossing never yields a route that uses one', () => {
    const dwn = data.stations.find((s) => s.id === 'place-dwnxg');
    const closed = new Set(dwn?.facilityIds ?? []);
    const r = planStepFree(data, { from: 'place-pktrm', to: 'place-dwnxg', closed });
    if (r.ok) expect(r.usedFacilityIds.some((f) => closed.has(f))).toBe(false);
    else expect(r.alternatives.map((a) => a.stationId)).not.toContain('place-dwnxg');
  });
});
