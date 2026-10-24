import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SUBWAY_ROUTES } from '@/lib/mbta/types';
import type { Network, PathwayEdge, PathwayMode, RouteId, Station, StationPathways, Wheelchair } from '@/lib/mbta/types';
import { planStepFree, stationStatus, type StaticData, type RouteResult } from '@/lib/router';

// ---------------------------------------------------------------- seeded synthetic networks

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Synth = { data: StaticData; lines: { route: RouteId; stations: string[] }[]; facilities: string[] };

function buildSynthetic(seed: number, accessible: boolean): Synth {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

  const nStations = int(3, 8);
  const ids = Array.from({ length: nStations }, (_, i) => `place-s${i}`);
  const stations = new Map<string, Station>();
  for (const id of ids) {
    stations.set(id, {
      id,
      name: id,
      lat: 42.3 + rnd() * 0.08,
      lon: -71.12 + rnd() * 0.08,
      wheelchair: accessible ? 1 : pick<Wheelchair>([0, 1, 1, 1, 2]),
      routes: [],
      platformIds: [],
      entranceIds: [],
      facilityIds: [],
    });
  }

  const network: Network = { platforms: {}, rides: [] };
  const lines: Synth['lines'] = [];
  const nLines = int(1, 3);
  for (let li = 0; li < nLines; li++) {
    const route = SUBWAY_ROUTES[li];
    const shuffled = [...ids].sort(() => rnd() - 0.5);
    const len = int(2, Math.min(nStations, 6));
    const seq = shuffled.slice(0, len);
    lines.push({ route, stations: seq });
    for (const sid of seq) {
      const st = stations.get(sid)!;
      st.routes.push(route);
      for (const dir of [0, 1]) {
        const pid = `${sid}:${route}:${dir}`;
        network.platforms[pid] = { id: pid, stationId: sid, name: pid, routes: [route] };
        st.platformIds.push(pid);
      }
    }
    for (let i = 0; i + 1 < seq.length; i++) {
      const minutes = int(1, 6);
      network.rides.push({ from: `${seq[i]}:${route}:0`, to: `${seq[i + 1]}:${route}:0`, route, directionId: 0, minutes });
      network.rides.push({ from: `${seq[i + 1]}:${route}:1`, to: `${seq[i]}:${route}:1`, route, directionId: 1, minutes });
    }
  }

  const pathways: Record<string, StationPathways> = {};
  const facilities: string[] = [];
  for (const st of stations.values()) {
    if (!accessible && rnd() < 0.15) continue; // no pathway data: router must fall back to the flag
    const sp: StationPathways = { nodes: {}, edges: [] };
    const mezz = `${st.id}:mezz`;
    sp.nodes[mezz] = { kind: 'node', wheelchair: 0 };
    let fcount = 0;
    const add = (a: string, b: string, mode: PathwayMode, facilityId: string | null) => {
      const seconds = int(10, 150);
      const e1: PathwayEdge = { from: a, to: b, mode, facilityId, seconds };
      const e2: PathwayEdge = { from: b, to: a, mode, facilityId, seconds };
      sp.edges.push(e1, e2);
      if (facilityId && !st.facilityIds.includes(facilityId)) {
        st.facilityIds.push(facilityId);
        facilities.push(facilityId);
      }
    };
    const connect = (a: string, b: string) => {
      const x = rnd();
      if (accessible) {
        if (x < 0.7) add(a, b, 5, `${st.id}:el${fcount++}`);
        else add(a, b, 1, null);
      } else if (x < 0.5) add(a, b, 5, `${st.id}:el${fcount++}`);
      else if (x < 0.62) add(a, b, 1, null);
      else if (x < 0.68) add(a, b, 1, `${st.id}:ramp${fcount++}`); // ramp: walkway carrying a facility id
      else if (x < 0.85) add(a, b, 2, null);
      else add(a, b, 4, `${st.id}:esc${fcount++}`);
      // distractors and redundancy
      if (rnd() < 0.3) add(a, b, 2, null);
      if (rnd() < 0.25) add(a, b, 4, `${st.id}:esc${fcount++}`);
      if (rnd() < 0.2) add(a, b, 5, `${st.id}:el${fcount++}`);
    };
    const nDoors = int(1, 2);
    for (let j = 0; j < nDoors; j++) {
      const door = `${st.id}:door${j}`;
      sp.nodes[door] = { kind: 'entrance', wheelchair: accessible ? 1 : pick<Wheelchair>([0, 1, 1, 2]) };
      st.entranceIds.push(door);
      connect(door, mezz);
    }
    for (const pid of st.platformIds) {
      sp.nodes[pid] = { kind: 'platform', wheelchair: 1 };
      connect(pid, mezz);
    }
    pathways[st.id] = sp;
  }

  return { data: { stations: [...stations.values()], network, pathways }, lines, facilities };
}

function randomSubset(xs: string[], p: number, rnd: () => number): Set<string> {
  return new Set(xs.filter(() => rnd() < p));
}

// Independent check, deliberately not using the router's own helpers.
function naiveReach(sp: StationPathways, from: string[], to: string[], closed: Set<string>): boolean {
  const target = new Set(to);
  const seen = new Set(from);
  const stack = [...from];
  while (stack.length) {
    const n = stack.pop()!;
    if (target.has(n)) return true;
    for (const e of sp.edges) {
      if (e.from !== n || seen.has(e.to)) continue;
      if (e.mode === 2 || e.mode === 4) continue;
      if (e.facilityId && closed.has(e.facilityId)) continue;
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return false;
}

function stepFreeDoors(data: StaticData, stationId: string): string[] {
  const sp = data.pathways[stationId];
  return Object.entries(sp.nodes)
    .filter(([, n]) => n.kind === 'entrance' && n.wheelchair !== 2)
    .map(([id]) => id);
}

const caseArb = fc.record({
  seed: fc.integer({ min: 0, max: 0x7fffffff }),
  closeSeed: fc.integer({ min: 0, max: 0x7fffffff }),
  p: fc.double({ min: 0, max: 0.6, noNaN: true }),
  a: fc.nat(20),
  b: fc.nat(20),
});

function setup(c: { seed: number; closeSeed: number; p: number; a: number; b: number }, accessible = false) {
  const s = buildSynthetic(c.seed, accessible);
  const rnd = mulberry32(c.closeSeed);
  const closed = randomSubset(s.facilities, c.p, rnd);
  const from = s.data.stations[c.a % s.data.stations.length].id;
  const to = s.data.stations[c.b % s.data.stations.length].id;
  return { ...s, closed, from, to, rnd };
}

const RUNS = 300;

describe('router properties', () => {
  it('(1) a returned route never uses a closed facility', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { data, closed, from, to } = setup(c);
        const r = planStepFree(data, { from, to, closed });
        if (!r.ok) return;
        expect(r.usedFacilityIds.filter((f) => closed.has(f))).toEqual([]);
        if (!r.legs.length) return;
        const first = r.legs[0];
        const last = r.legs[r.legs.length - 1];
        // Street access at both ends, rechecked independently.
        if (first.kind === 'ride' && data.pathways[from] && first.fromPlatform in data.pathways[from].nodes) {
          expect(naiveReach(data.pathways[from], stepFreeDoors(data, from), [first.fromPlatform], closed)).toBe(true);
        }
        if (last.kind === 'ride' && data.pathways[to] && last.toPlatform in data.pathways[to].nodes) {
          expect(naiveReach(data.pathways[to], [last.toPlatform], stepFreeDoors(data, to), closed)).toBe(true);
        }
        // Every platform change inside a station is step-free with the closures applied.
        for (const l of r.legs) {
          if (l.kind !== 'transfer' || l.fromPlatform === l.toPlatform) continue;
          const sp = data.pathways[l.stationId];
          if (!sp) continue; // approximate fallback station
          expect(naiveReach(sp, [l.fromPlatform], [l.toPlatform], closed)).toBe(true);
        }
        // Closing everything the route claims to use must not leave the same route valid
        // through those facilities (sanity of the instrumentation): rerun and check again.
        const closedPlus = new Set([...closed, ...r.usedFacilityIds]);
        const r2 = planStepFree(data, { from, to, closed: closedPlus });
        if (r2.ok) expect(r2.usedFacilityIds.filter((f) => closedPlus.has(f))).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it('(2) closing more facilities never makes the best route faster', () => {
    fc.assert(
      fc.property(caseArb, fc.double({ min: 0, max: 0.6, noNaN: true }), (c, extraP) => {
        const { data, closed, from, to, rnd, facilities } = setup(c);
        const more = new Set([...closed, ...randomSubset(facilities, extraP, rnd)]);
        const less: RouteResult = planStepFree(data, { from, to, closed });
        const moreR: RouteResult = planStepFree(data, { from, to, closed: more });
        if (moreR.ok) {
          expect(less.ok).toBe(true);
          if (less.ok) expect(less.minutes).toBeLessThanOrEqual(moreR.minutes + 1e-9);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('(3) fully accessible network, no closures: any two stations on one line resolve', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7fffffff }), fc.nat(10), fc.nat(10), fc.nat(5), (seed, i, j, li) => {
        const { data, lines } = buildSynthetic(seed, true);
        const line = lines[li % lines.length];
        const a = line.stations[i % line.stations.length];
        const b = line.stations[j % line.stations.length];
        const r = planStepFree(data, { from: a, to: b, closed: new Set() });
        expect(r.ok).toBe(true);
        if (r.ok && a === b) expect(r.legs).toEqual([]);
        if (r.ok && a !== b) expect(r.minutes).toBeGreaterThan(0);
        expect(stationStatus(data, a).stepFree).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('(4) a route exists only between step-free stations', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { data, closed, from, to } = setup(c);
        const r = planStepFree(data, { from, to, closed });
        if (r.ok) {
          expect(stationStatus(data, from, closed).stepFree).toBe(true);
          expect(stationStatus(data, to, closed).stepFree).toBe(true);
        } else if (r.reason === 'origin-not-step-free' || r.reason === 'destination-not-step-free') {
          for (const alt of r.alternatives) {
            expect(stationStatus(data, alt.stationId, closed).stepFree).toBe(true);
            expect([from, to]).not.toContain(alt.stationId);
          }
          expect(r.alternatives.length).toBeLessThanOrEqual(3);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('blockedBy only lists closed facilities of that station', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { data, closed, from } = setup(c);
        const s = stationStatus(data, from, closed);
        const st = data.stations.find((x) => x.id === from)!;
        for (const f of s.blockedBy) {
          expect(closed.has(f)).toBe(true);
          expect(st.facilityIds).toContain(f);
        }
        if (s.blockedBy.length) {
          const reopened = new Set([...closed].filter((f) => !s.blockedBy.includes(f)));
          const after = stationStatus(data, from, reopened);
          const gained =
            Object.keys(s.platforms).some((p) => !s.platforms[p] && after.platforms[p]) || (!s.stepFree && after.stepFree);
          expect(gained).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
