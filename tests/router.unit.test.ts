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
  haversineKm,
  towardsOf,
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

describe('towards and entrance names', () => {
  it('ride legs name the terminal in the direction of travel', () => {
    const r = planStepFree(build(LINES), { from: 'O', to: 'D' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.legs[0] as RideLeg).towards).toBe('X'); // Red direction 0 runs O -> X
    expect((r.legs[2] as RideLeg).towards).toBe('D'); // Orange ends at D
    const back = planStepFree(build(LINES), { from: 'X', to: 'O' });
    if (back.ok) expect((back.legs[0] as RideLeg).towards).toBe('O');
  });

  it('a branching line joins both terminals, and a branch station names only its own', () => {
    const st = (id: string, name: string): Station => ({
      id, name, lat: 42.35, lon: -71.06, wheelchair: 1, routes: ['Red'], platformIds: [`${id}-0`], entranceIds: [], facilityIds: [],
    });
    const data: StaticData = {
      stations: [st('A', 'Alewife'), st('J', 'JFK'), st('S', 'Ashmont'), st('Q', 'Quincy'), st('B', 'Braintree')],
      network: {
        platforms: Object.fromEntries(['A', 'J', 'S', 'Q', 'B'].map((id) => [`${id}-0`, { id: `${id}-0`, stationId: id, name: id, routes: ['Red'] as RouteId[] }])),
        rides: [
          { from: 'A-0', to: 'J-0', route: 'Red', directionId: 0, minutes: 2 },
          { from: 'J-0', to: 'S-0', route: 'Red', directionId: 0, minutes: 2 },
          { from: 'J-0', to: 'Q-0', route: 'Red', directionId: 0, minutes: 2 },
          { from: 'Q-0', to: 'B-0', route: 'Red', directionId: 0, minutes: 2 },
        ],
      },
      pathways: {},
    };
    expect(towardsOf(data, 'Red', 0, 'A-0')).toBe('Ashmont/Braintree');
    expect(towardsOf(data, 'Red', 0, 'Q-0')).toBe('Braintree');
    expect(towardsOf(data, 'Red', 0, 'B-0')).toBe('Braintree');
    expect(towardsOf(data, 'Red', 1, 'A-0')).toBe('Alewife'); // no edges that way: the station itself
    const r = planStepFree(data, { from: 'A', to: 'Q' });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.legs[0] as RideLeg).towards).toBe('Braintree');
  });

  it('adds entrance and exit names when the pathway nodes are named', () => {
    const data = build(LINES);
    data.pathways.O.nodes['O-door'].name = 'Main St (Elevator)';
    const r = planStepFree(data, { from: 'O', to: 'D' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.originEntranceName).toBe('Main St (Elevator)');
    expect(r.destinationExitName).toBeUndefined(); // D-door has no name
    expect('destinationExitName' in r).toBe(false);
  });
});

describe('mini-high platforms, partial status, elevator doors', () => {
  const withBoarding = (facs: { id: string; type: 'ELEVATED_SUBPLATFORM' | 'PORTABLE_BOARDING_LIFT'; platformIds: string[] }[]) => {
    const data: StaticData = build(LINES);
    data.facilities = facs.map((f) => ({ ...f, stationId: 'O', name: f.id }));
    data.stations.find((s) => s.id === 'O')!.facilityIds.push(...facs.map((f) => f.id));
    return data;
  };

  it('a closed mini-high platform blocks only the platform it serves', () => {
    const data = withBoarding([
      { id: 'sub-O-0', type: 'ELEVATED_SUBPLATFORM', platformIds: ['O-Red-0'] },
      { id: 'sub-O-1', type: 'ELEVATED_SUBPLATFORM', platformIds: ['O-Red-1'] },
    ]);
    expect(stationStatus(data, 'O')).toMatchObject({ stepFree: true, partial: false, blockedPlatforms: [] });
    const closed = new Set(['sub-O-0']);
    const s = stationStatus(data, 'O', closed);
    expect(s.platforms).toEqual({ 'O-Red-0': false, 'O-Red-1': true });
    expect(s).toMatchObject({ stepFree: true, partial: true, blockedBy: ['sub-O-0'] });
    expect(s.blockedPlatforms).toEqual([{ platformId: 'O-Red-0', name: 'O-Red-0', facilityIds: ['sub-O-0'] }]);
    // O-Red-0 is the only platform with trains towards X, so no step-free trip starts there now.
    expect(planStepFree(data, { from: 'O', to: 'X' }).ok).toBe(true);
    expect(planStepFree(data, { from: 'O', to: 'X', closed }).ok).toBe(false);
    // Arriving at O uses the other platform, which is fine.
    expect(planStepFree(data, { from: 'X', to: 'O', closed }).ok).toBe(true);
  });

  it('a mobile lift on the same platform keeps it step-free; a lift alone never gates a platform', () => {
    const both = withBoarding([
      { id: 'sub-O-0', type: 'ELEVATED_SUBPLATFORM', platformIds: ['O-Red-0'] },
      { id: 'lift-O-0', type: 'PORTABLE_BOARDING_LIFT', platformIds: ['O-Red-0'] },
    ]);
    expect(stationStatus(both, 'O', new Set(['sub-O-0'])).platforms['O-Red-0']).toBe(true);
    expect(stationStatus(both, 'O', new Set(['sub-O-0', 'lift-O-0'])).platforms['O-Red-0']).toBe(false);
    const liftOnly = withBoarding([{ id: 'lift-O-0', type: 'PORTABLE_BOARDING_LIFT', platformIds: ['O-Red-0'] }]);
    expect(stationStatus(liftOnly, 'O', new Set(['lift-O-0'])).platforms['O-Red-0']).toBe(true);
  });

  it('partial: one line closed at a transfer station lists the blocked platforms and the elevator', () => {
    const data = build(LINES);
    const s = stationStatus(data, 'T1', new Set(['EL-T1-Orange']));
    expect(s.partial).toBe(true);
    expect(s.blockedPlatforms).toEqual([
      { platformId: 'T1-Orange-0', name: 'T1-Orange-0', facilityIds: ['EL-T1-Orange'] },
      { platformId: 'T1-Orange-1', name: 'T1-Orange-1', facilityIds: ['EL-T1-Orange'] },
    ]);
    const none = stationStatus(data, 'X', new Set(['EL-X-Red']));
    expect(none).toMatchObject({ stepFree: false, partial: false });
    expect(none.blockedPlatforms.map((b) => b.facilityIds)).toEqual([['EL-X-Red'], ['EL-X-Red']]);
  });

  it('a door flagged not accessible still counts when an elevator ends at it (Copley Boylston St)', () => {
    const data = build(LINES);
    data.pathways.O.nodes['O-door'].wheelchair = 2;
    data.pathways.O.nodes['O-lift'] = { kind: 'entrance', wheelchair: 2 };
    data.pathways.O.edges.push(...pair('O-lift', 'O-mezz', 5, 'EL-O-street', 40), ...pair('O-lift', 'O-mezz', 2, null, 40));
    expect(stationStatus(data, 'O').stepFree).toBe(true);
    const r = planStepFree(data, { from: 'O', to: 'X' });
    expect(r.ok && r.originEntranceId).toBe('O-lift');
    expect(stationStatus(data, 'O', new Set(['EL-O-street'])).stepFree).toBe(false);
  });

  it('returns entrance and exit coordinates, falling back to the station name', () => {
    const data = build(LINES);
    Object.assign(data.pathways.O.nodes['O-door'], { lat: 42.3501, lon: -71.0601 });
    Object.assign(data.pathways.D.nodes['D-door'], { name: 'Main St', lat: 42.3581, lon: -71.0501 });
    const r = planStepFree(data, { from: 'O', to: 'D' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.originEntrance).toEqual({ id: 'O-door', name: 'O', lat: 42.3501, lon: -71.0601 });
    expect(r.destinationExit).toEqual({ id: 'D-door', name: 'Main St', lat: 42.3581, lon: -71.0501 });
    const noCoords = planStepFree(build(LINES), { from: 'O', to: 'D' });
    expect(noCoords.ok && 'originEntrance' in noCoords).toBe(false);
  });
});

describe('legs served by several branches', () => {
  const st = (id: string, name: string, routes: RouteId[]): Station => ({
    id, name, lat: 42.35, lon: -71.06, wheelchair: 1, routes, platformIds: [], entranceIds: [], facilityIds: [],
  });
  const plat = (id: string, stationId: string, routes: RouteId[]) => [id, { id, stationId, name: id, routes }] as const;

  it('a leg ending where the line splits names both terminals (JFK/UMass)', () => {
    const data: StaticData = {
      stations: [st('P', 'Park', ['Red']), st('J', 'JFK', ['Red']), st('S', 'Ashmont', ['Red']), st('B', 'Braintree', ['Red'])],
      network: {
        platforms: Object.fromEntries([plat('P-0', 'P', ['Red']), plat('J-a', 'J', ['Red']), plat('J-b', 'J', ['Red']), plat('S-0', 'S', ['Red']), plat('B-0', 'B', ['Red'])]),
        rides: [
          { from: 'P-0', to: 'J-a', route: 'Red', directionId: 0, minutes: 3 },
          { from: 'P-0', to: 'J-b', route: 'Red', directionId: 0, minutes: 2 },
          { from: 'J-a', to: 'S-0', route: 'Red', directionId: 0, minutes: 2 },
          { from: 'J-b', to: 'B-0', route: 'Red', directionId: 0, minutes: 2 },
        ],
      },
      pathways: {},
    };
    const r = planStepFree(data, { from: 'P', to: 'J' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.legs[0]).toMatchObject({ kind: 'ride', toPlatform: 'J-b', towards: 'Ashmont/Braintree' });
    expect((r.legs[0] as RideLeg).alsoRoutes).toBeUndefined();
    const branch = planStepFree(data, { from: 'P', to: 'B' });
    expect(branch.ok && (branch.legs[0] as RideLeg).towards).toBe('Braintree');
  });

  it('a shared trunk leg lists the other routes and merges their terminals', () => {
    const G: RouteId[] = ['Green-B', 'Green-C'];
    const data: StaticData = {
      stations: [st('A', 'Park', G), st('K', 'Kenmore', G), st('BC', 'Boston College', ['Green-B']), st('CC', 'Cleveland Circle', ['Green-C'])],
      network: {
        platforms: Object.fromEntries([plat('A-0', 'A', G), plat('K-0', 'K', G), plat('BC-0', 'BC', ['Green-B']), plat('CC-0', 'CC', ['Green-C'])]),
        rides: [
          { from: 'A-0', to: 'K-0', route: 'Green-B', directionId: 0, minutes: 6 },
          { from: 'K-0', to: 'BC-0', route: 'Green-B', directionId: 0, minutes: 20 },
          { from: 'A-0', to: 'K-0', route: 'Green-C', directionId: 0, minutes: 6 },
          { from: 'K-0', to: 'CC-0', route: 'Green-C', directionId: 0, minutes: 20 },
        ],
      },
      pathways: {},
    };
    const r = planStepFree(data, { from: 'A', to: 'K' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const leg = r.legs[0] as RideLeg;
    expect([leg.route, ...(leg.alsoRoutes ?? [])].sort()).toEqual(['Green-B', 'Green-C']);
    expect(leg.towards).toBe('Boston College/Cleveland Circle');
    const branch = planStepFree(data, { from: 'A', to: 'BC' });
    expect(branch.ok && branch.legs[0]).toMatchObject({ route: 'Green-B', towards: 'Boston College' });
    expect(branch.ok && (branch.legs[0] as RideLeg).alsoRoutes).toBeUndefined();
  });
});

// ---------------------------------------------------------------- real data (only when the build has run)
const DATA_DIR = path.resolve(__dirname, '..', 'public', 'data');
const haveReal = ['stations.json', 'network.json', 'pathways.json'].every((f) => fs.existsSync(path.join(DATA_DIR, f)));

describe.skipIf(!haveReal)('real MBTA data', () => {
  const load = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) as T;
  const data: StaticData = haveReal
    ? {
        stations: load('stations.json'),
        network: load('network.json'),
        pathways: load('pathways.json'),
        facilities: fs.existsSync(path.join(DATA_DIR, 'facilities.json')) ? load('facilities.json') : [],
      }
    : { stations: [], network: { platforms: {}, rides: [] }, pathways: {} };
  const redLeg = (r: ReturnType<typeof planStepFree>, route = 'Red') =>
    r.ok ? r.legs.find((l): l is RideLeg => l.kind === 'ride' && l.route === route) : undefined;

  it('Central Avenue: closing the Ashmont-side mini-high blocks platform 70270 only', () => {
    const open = stationStatus(data, 'place-cenav');
    expect(open.platforms).toEqual({ '70269': true, '70270': true });
    const closed = new Set(['subplat-cenav-1']);
    const s = stationStatus(data, 'place-cenav', closed);
    expect(s.platforms).toEqual({ '70269': true, '70270': false });
    expect(s).toMatchObject({ stepFree: true, partial: true, blockedBy: ['subplat-cenav-1'] });
    expect(s.blockedPlatforms).toEqual([{ platformId: '70270', name: 'Ashmont', facilityIds: ['subplat-cenav-1'] }]);
    const r = planStepFree(data, { from: 'place-cenav', to: 'place-asmnl', closed });
    if (r.ok) expect((r.legs[0] as RideLeg).fromPlatform).not.toBe('70270');
  });

  it('Copley to Park Street rides straight from the eastbound platform (elevator 976 door)', () => {
    expect(stationStatus(data, 'place-coecl').platforms).toEqual({ '70154': true, '70155': true });
    const r = planStepFree(data, { from: 'place-coecl', to: 'place-pktrm' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transfers).toBe(0);
    expect(r.legs[0]).toMatchObject({ kind: 'ride', fromPlatform: '70154' });
    expect(r.originEntranceId).toBe('door-coecl-bpl');
    expect(r.usedFacilityIds).toContain('976');
    expect(r.minutes).toBeLessThan(10);
  });

  it('Red trips ending at JFK/UMass are towards Ashmont/Braintree', () => {
    expect(redLeg(planStepFree(data, { from: 'place-pktrm', to: 'place-jfk' }))?.towards).toBe('Ashmont/Braintree');
    expect(redLeg(planStepFree(data, { from: 'place-alfcl', to: 'place-jfk' }))?.towards).toBe('Ashmont/Braintree');
  });

  it('Green trunk legs list the other branches that run them', () => {
    const r = planStepFree(data, { from: 'place-pktrm', to: 'place-kencl' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const legs = r.legs.filter((l): l is RideLeg => l.kind === 'ride');
    expect(legs).toHaveLength(1);
    expect([legs[0].route, ...(legs[0].alsoRoutes ?? [])].sort()).toEqual(['Green-B', 'Green-C', 'Green-D']);
    expect(legs[0].towards).toBe('Boston College/Cleveland Circle/Riverside');
    const back = planStepFree(data, { from: 'place-lech', to: 'place-pktrm' });
    const g = back.ok ? (back.legs.find((l) => l.kind === 'ride') as RideLeg) : undefined;
    expect(g && [g.route, ...(g.alsoRoutes ?? [])].sort()).toEqual(['Green-D', 'Green-E']);
  });

  it('routes carry entrance and exit coordinates near the station', () => {
    const r = planStepFree(data, { from: 'place-jfk', to: 'place-pktrm' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const jfk = data.stations.find((s) => s.id === 'place-jfk')!;
    const pk = data.stations.find((s) => s.id === 'place-pktrm')!;
    expect(r.originEntrance?.id).toBe(r.originEntranceId);
    expect(r.destinationExit?.id).toBe(r.destinationExitId);
    expect(haversineKm(jfk.lat, jfk.lon, r.originEntrance!.lat, r.originEntrance!.lon)).toBeLessThan(0.4);
    expect(haversineKm(pk.lat, pk.lon, r.destinationExit!.lat, r.destinationExit!.lon)).toBeLessThan(0.4);
    expect(r.originEntrance!.name).toBe(r.originEntranceName);
  });

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

  it('Red southbound on the shared trunk is towards Ashmont/Braintree, a Braintree-branch leg towards Braintree', () => {
    const trunk = planStepFree(data, { from: 'place-pktrm', to: 'place-sstat' });
    expect(trunk.ok).toBe(true);
    if (trunk.ok) {
      const red = trunk.legs.find((l): l is RideLeg => l.kind === 'ride' && l.route === 'Red');
      expect(red?.towards).toBe('Ashmont/Braintree');
      expect(typeof trunk.originEntranceName).toBe('string');
      expect(typeof trunk.destinationExitName).toBe('string');
    }
    const branch = planStepFree(data, { from: 'place-pktrm', to: 'place-qnctr' });
    if (branch.ok) {
      const red = branch.legs.find((l): l is RideLeg => l.kind === 'ride' && l.route === 'Red');
      expect(red?.towards).toBe('Braintree');
    }
    const north = planStepFree(data, { from: 'place-sstat', to: 'place-pktrm' });
    if (north.ok) {
      const red = north.legs.find((l): l is RideLeg => l.kind === 'ride' && l.route === 'Red');
      expect(red?.towards).toBe('Alewife');
    }
  });

  it('closing every facility at Downtown Crossing never yields a route that uses one', () => {
    const dwn = data.stations.find((s) => s.id === 'place-dwnxg');
    const closed = new Set(dwn?.facilityIds ?? []);
    const r = planStepFree(data, { from: 'place-pktrm', to: 'place-dwnxg', closed });
    if (r.ok) expect(r.usedFacilityIds.some((f) => closed.has(f))).toBe(false);
    else expect(r.alternatives.map((a) => a.stationId)).not.toContain('place-dwnxg');
  });
});
