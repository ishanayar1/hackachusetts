// Step-free router. Pure functions, no I/O.
// Model: platforms are joined by directed RideEdges (network.json); inside a station the
// pathway graph (pathways.json) decides whether a wheelchair user can get from a street
// entrance to a platform, or between two platforms, with the currently closed facilities removed.
import type { Network, PathwayEdge, RideEdge, RouteId, Station, StationPathways } from '@/lib/mbta/types';

export type StaticData = { stations: Station[]; network: Network; pathways: Record<string, StationPathways> };

/** 'in' = entrance -> platform, 'out' = platform -> entrance, 'both' = both directions. */
export type AccessDir = 'in' | 'out' | 'both';

export type RideLeg = {
  kind: 'ride';
  route: RouteId;
  fromStation: string;
  toStation: string;
  stationIds: string[];
  minutes: number;
  fromPlatform: string;
  toPlatform: string;
};
export type TransferLeg = {
  kind: 'transfer';
  stationId: string;
  minutes: number;
  fromPlatform: string;
  toPlatform: string; // equals fromPlatform for a same-platform change of route
};
export type Leg = RideLeg | TransferLeg;

export type Alternative = { stationId: string; distanceKm: number };
export type RouteFailReason = 'origin-not-step-free' | 'destination-not-step-free' | 'no-path' | 'unknown-station';

export type RouteOk = {
  ok: true;
  minutes: number;
  legs: Leg[];
  transfers: number;
  /** true when some station on the trip has no pathway data and its GTFS flag was used instead. */
  approximate: boolean;
  /** Facilities (elevators, ramps...) on the chosen in-station paths: street access, transfers, exit. */
  usedFacilityIds: string[];
  /** Step-free street entrance to use at the origin, and exit at the destination (null when approximate). */
  originEntranceId: string | null;
  destinationExitId: string | null;
};
export type RouteFail = { ok: false; reason: RouteFailReason; alternatives: Alternative[] };
export type RouteResult = RouteOk | RouteFail;

export type StationStatus = {
  stepFree: boolean;
  approximate: boolean;
  platforms: Record<string, boolean>;
  blockedBy: string[];
};

export type AccessInfo = { ok: boolean; approximate: boolean };

/** Minimum cost of any change of train, in minutes. */
export const MIN_TRANSFER_MIN = 2;
/** Cost of a transfer at a station with no pathway data (approximate). */
export const FALLBACK_TRANSFER_MIN = 3;

const EMPTY: ReadonlySet<string> = new Set();

// ---------------------------------------------------------------- indexes (cached per object)

type Index = {
  stationById: Map<string, Station>;
  platformsByStation: Map<string, string[]>;
  ridesFrom: Map<string, RideEdge[]>;
};
const indexCache = new WeakMap<StaticData, Index>();

function index(data: StaticData): Index {
  let idx = indexCache.get(data);
  if (idx) return idx;
  const stationById = new Map<string, Station>();
  for (const s of data.stations) stationById.set(s.id, s);
  const platformsByStation = new Map<string, string[]>();
  for (const p of Object.values(data.network.platforms)) {
    const list = platformsByStation.get(p.stationId) ?? [];
    list.push(p.id);
    platformsByStation.set(p.stationId, list);
  }
  for (const s of data.stations) {
    const list = platformsByStation.get(s.id) ?? [];
    for (const pid of s.platformIds) if (data.network.platforms[pid] && !list.includes(pid)) list.push(pid);
    platformsByStation.set(s.id, list);
  }
  const ridesFrom = new Map<string, RideEdge[]>();
  for (const e of data.network.rides) {
    const list = ridesFrom.get(e.from) ?? [];
    list.push(e);
    ridesFrom.set(e.from, list);
  }
  idx = { stationById, platformsByStation, ridesFrom };
  indexCache.set(data, idx);
  return idx;
}

const adjCache = new WeakMap<StationPathways, Map<string, PathwayEdge[]>>();
function adjacency(sp: StationPathways): Map<string, PathwayEdge[]> {
  let adj = adjCache.get(sp);
  if (adj) return adj;
  adj = new Map();
  for (const e of sp.edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e);
    adj.set(e.from, list);
  }
  adjCache.set(sp, adj);
  return adj;
}

function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Step-free edge: not stairs (2), not escalator (4), and its facility (if any) is not closed. */
export function edgeAllowed(e: PathwayEdge, closed: ReadonlySet<string>): boolean {
  if (e.mode === 2 || e.mode === 4) return false;
  if (e.facilityId && closed.has(e.facilityId)) return false;
  return true;
}

// ---------------------------------------------------------------- tiny binary heap

class MinHeap<T> {
  private a: { k: number; v: T }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: T) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; v: T } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------- in-station graph

/** BFS over step-free edges with closures applied. True if any of fromIds reaches any of toIds. */
export function reachable(sp: StationPathways, fromIds: string[], toIds: string[], closed: ReadonlySet<string>): boolean {
  const targets = new Set(toIds);
  if (!targets.size) return false;
  const adj = adjacency(sp);
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const f of fromIds) {
    if (targets.has(f)) return true;
    if (!seen.has(f)) {
      seen.add(f);
      queue.push(f);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    for (const e of adj.get(queue[qi]) ?? []) {
      if (seen.has(e.to) || !edgeAllowed(e, closed)) continue;
      if (targets.has(e.to)) return true;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return false;
}

export type StationPath = { from: string; to: string; seconds: number; facilityIds: string[] };

/** Shortest step-free path (by seconds) from any of fromIds to any of toIds, or null. */
export function stationPath(
  sp: StationPathways,
  fromIds: string[],
  toIds: string[],
  closed: ReadonlySet<string>,
): StationPath | null {
  const targets = new Set(toIds);
  if (!targets.size) return null;
  const adj = adjacency(sp);
  const dist = new Map<string, number>();
  const prev = new Map<string, PathwayEdge | null>();
  const heap = new MinHeap<string>();
  for (const f of fromIds) {
    if (!dist.has(f)) {
      dist.set(f, 0);
      prev.set(f, null);
      heap.push(0, f);
    }
  }
  const done = new Set<string>();
  while (heap.size) {
    const { k, v } = heap.pop()!;
    if (done.has(v)) continue;
    done.add(v);
    if (targets.has(v)) {
      const facilityIds: string[] = [];
      let cur = v;
      let pe = prev.get(cur);
      while (pe) {
        if (pe.facilityId && !facilityIds.includes(pe.facilityId)) facilityIds.push(pe.facilityId);
        cur = pe.from;
        pe = prev.get(cur);
      }
      return { from: cur, to: v, seconds: k, facilityIds: facilityIds.reverse() };
    }
    for (const e of adj.get(v) ?? []) {
      if (!edgeAllowed(e, closed)) continue;
      const nd = k + Math.max(0, e.seconds || 0);
      const od = dist.get(e.to);
      if (od === undefined || nd < od) {
        dist.set(e.to, nd);
        prev.set(e.to, e);
        heap.push(nd, e.to);
      }
    }
  }
  return null;
}

function usablePathways(data: StaticData, stationId: string): StationPathways | null {
  const sp = data.pathways[stationId];
  return sp && sp.edges && sp.edges.length > 0 ? sp : null;
}

/** All entrance node ids of a station (any wheelchair flag). */
function entranceNodes(sp: StationPathways, st: Station): string[] {
  const out = new Set<string>();
  for (const [id, n] of Object.entries(sp.nodes)) if (n.kind === 'entrance') out.add(id);
  for (const id of st.entranceIds) if (hasOwn(sp.nodes, id)) out.add(id);
  return [...out];
}

function stepFreeEntrances(sp: StationPathways, st: Station): string[] {
  return entranceNodes(sp, st).filter((id) => sp.nodes[id]?.wheelchair !== 2);
}

/** Fallback when a station has no pathway data: trust the GTFS flag unless every facility there is closed. */
function fallbackOk(st: Station, closed: ReadonlySet<string>): boolean {
  if (st.wheelchair !== 1) return false;
  const f = st.facilityIds ?? [];
  return !(f.length > 0 && f.every((id) => closed.has(id)));
}

type AccessDetail = AccessInfo & { inPath: StationPath | null; outPath: StationPath | null };

function accessDetail(
  data: StaticData,
  st: Station,
  platformId: string,
  closed: ReadonlySet<string>,
  dir: AccessDir,
  withPaths: boolean,
): AccessDetail {
  const sp = usablePathways(data, st.id);
  const none = { inPath: null, outPath: null };
  if (!sp || !hasOwn(sp.nodes, platformId)) return { ok: fallbackOk(st, closed), approximate: true, ...none };
  if (entranceNodes(sp, st).length === 0) return { ok: fallbackOk(st, closed), approximate: true, ...none };
  const ents = stepFreeEntrances(sp, st);
  if (!ents.length) return { ok: false, approximate: false, ...none };
  let inPath: StationPath | null = null;
  let outPath: StationPath | null = null;
  let ok = true;
  if (dir === 'in' || dir === 'both') {
    if (withPaths) {
      inPath = stationPath(sp, ents, [platformId], closed);
      ok = ok && inPath !== null;
    } else ok = ok && reachable(sp, ents, [platformId], closed);
  }
  if (ok && (dir === 'out' || dir === 'both')) {
    if (withPaths) {
      outPath = stationPath(sp, [platformId], ents, closed);
      ok = ok && outPath !== null;
    } else ok = ok && reachable(sp, [platformId], ents, closed);
  }
  return { ok, approximate: false, inPath, outPath };
}

/** Street access with the approximate flag (true when the station has no pathway data). */
export function streetAccessInfo(
  data: StaticData,
  stationId: string,
  platformId: string,
  closed: ReadonlySet<string> = EMPTY,
  dir: AccessDir = 'both',
): AccessInfo {
  const st = index(data).stationById.get(stationId);
  if (!st) return { ok: false, approximate: false };
  const d = accessDetail(data, st, platformId, closed, dir, false);
  return { ok: d.ok, approximate: d.approximate };
}

/** Can a wheelchair user get from a step-free street entrance to this platform (and back out, for 'both')? */
export function streetAccess(
  data: StaticData,
  stationId: string,
  platformId: string,
  closed: ReadonlySet<string> = EMPTY,
  dir: AccessDir = 'both',
): boolean {
  return streetAccessInfo(data, stationId, platformId, closed, dir).ok;
}

/** Platforms of a station that trains stop at. */
export function platformsOf(data: StaticData, stationId: string): string[] {
  return index(data).platformsByStation.get(stationId) ?? [];
}

function closedAtStation(data: StaticData, st: Station, closed: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const f of st.facilityIds ?? []) if (closed.has(f)) out.add(f);
  const sp = data.pathways[st.id];
  if (sp) for (const e of sp.edges) if (e.facilityId && closed.has(e.facilityId)) out.add(e.facilityId);
  return [...out].sort();
}

export function stationStatus(data: StaticData, stationId: string, closed: ReadonlySet<string> = EMPTY): StationStatus {
  const st = index(data).stationById.get(stationId);
  if (!st) return { stepFree: false, approximate: false, platforms: {}, blockedBy: [] };
  let plats = platformsOf(data, stationId);
  if (!plats.length) plats = st.platformIds ?? [];
  const closedHere = closedAtStation(data, st, closed);

  const evalAll = (c: ReadonlySet<string>) => {
    const res: Record<string, boolean> = {};
    let approximate = false;
    for (const p of plats) {
      const a = accessDetail(data, st, p, c, 'both', false);
      res[p] = a.ok;
      approximate = approximate || a.approximate;
    }
    return { res, approximate };
  };

  if (!plats.length) {
    const ok = fallbackOk(st, closed);
    const blockedBy = !ok && fallbackOk(st, EMPTY) ? closedHere : [];
    return { stepFree: ok, approximate: true, platforms: {}, blockedBy };
  }

  const { res: platforms, approximate } = evalAll(closed);
  const stepFree = Object.values(platforms).some(Boolean);
  const blockedPlats = plats.filter((p) => !platforms[p]);
  let blockedBy: string[] = [];
  if (closedHere.length && blockedPlats.length) {
    for (const f of closedHere) {
      const c2 = new Set(closed);
      c2.delete(f);
      if (blockedPlats.some((p) => accessDetail(data, st, p, c2, 'both', false).ok)) blockedBy.push(f);
    }
    if (!blockedBy.length) {
      // Redundant facilities all closed together: none alone restores access, but together they do.
      const c3 = new Set(closed);
      for (const f of closedHere) c3.delete(f);
      if (blockedPlats.some((p) => accessDetail(data, st, p, c3, 'both', false).ok)) blockedBy = [...closedHere];
    }
  }
  return { stepFree, approximate, platforms, blockedBy };
}

// ---------------------------------------------------------------- geography

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Up to k nearest stations that are step-free right now. */
export function nearestStepFree(
  data: StaticData,
  lat: number,
  lon: number,
  closed: ReadonlySet<string> = EMPTY,
  k = 3,
  exclude: ReadonlySet<string> = EMPTY,
): Alternative[] {
  const ranked = data.stations
    .filter((s) => !exclude.has(s.id) && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ stationId: s.id, distanceKm: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const out: Alternative[] = [];
  for (const r of ranked) {
    if (out.length >= k) break;
    if (stationStatus(data, r.stationId, closed).stepFree) {
      out.push({ stationId: r.stationId, distanceKm: Math.round(r.distanceKm * 100) / 100 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- trip planner

type TransferInfo = { minutes: number; facilityIds: string[]; approximate: boolean } | null;

type Step =
  | { kind: 'ride'; prev: string; edge: RideEdge; switchPenalty: number }
  | { kind: 'transfer'; prev: string; from: string; to: string; stationId: string; minutes: number };

const round1 = (x: number) => Math.round(x * 10) / 10;

export function planStepFree(
  data: StaticData,
  opts: { from: string; to: string; closed?: ReadonlySet<string> | string[] },
): RouteResult {
  const idx = index(data);
  const closed: ReadonlySet<string> = opts.closed instanceof Set ? opts.closed : new Set(opts.closed ?? []);
  const o = idx.stationById.get(opts.from);
  const d = idx.stationById.get(opts.to);
  if (!o || !d) return { ok: false, reason: 'unknown-station', alternatives: [] };

  const alts = (st: Station) => nearestStepFree(data, st.lat, st.lon, closed, 3, new Set([o.id, d.id]));
  const fail = (reason: RouteFailReason, st: Station): RouteFail => ({ ok: false, reason, alternatives: alts(st) });

  if (o.id === d.id) {
    const s = stationStatus(data, o.id, closed);
    if (!s.stepFree) return fail('origin-not-step-free', o);
    return {
      ok: true,
      minutes: 0,
      legs: [],
      transfers: 0,
      approximate: s.approximate,
      usedFacilityIds: [],
      originEntranceId: null,
      destinationExitId: null,
    };
  }

  const originAccess = new Map<string, AccessDetail>();
  for (const p of platformsOf(data, o.id)) {
    const a = accessDetail(data, o, p, closed, 'in', true);
    if (a.ok) originAccess.set(p, a);
  }
  if (!originAccess.size) return fail('origin-not-step-free', o);
  const destAccess = new Map<string, AccessDetail>();
  for (const p of platformsOf(data, d.id)) {
    const a = accessDetail(data, d, p, closed, 'out', true);
    if (a.ok) destAccess.set(p, a);
  }
  if (!destAccess.size) return fail('destination-not-step-free', d);

  // Transfers between two platforms of one station, cached for this call.
  const transferCache = new Map<string, TransferInfo>();
  const transferInfo = (stationId: string, from: string, to: string): TransferInfo => {
    const key = `${from}\u0000${to}`;
    if (transferCache.has(key)) return transferCache.get(key)!;
    let info: TransferInfo = null;
    const st = idx.stationById.get(stationId);
    const sp = usablePathways(data, stationId);
    if (sp && hasOwn(sp.nodes, from) && hasOwn(sp.nodes, to)) {
      const path = stationPath(sp, [from], [to], closed);
      if (path) info = { minutes: Math.max(MIN_TRANSFER_MIN, path.seconds / 60), facilityIds: path.facilityIds, approximate: false };
    } else if (st && fallbackOk(st, closed)) {
      info = { minutes: FALLBACK_TRANSFER_MIN, facilityIds: [], approximate: true };
    }
    transferCache.set(key, info);
    return info;
  };

  // Dijkstra over (platform, route on board). route '' = not on a train (start, or just changed platform).
  const SEP = '\u0000';
  const key = (p: string, r: string) => `${p}${SEP}${r}`;
  const dist = new Map<string, number>();
  const prev = new Map<string, Step | null>();
  const heap = new MinHeap<string>();
  const relax = (k: string, nd: number, step: Step | null) => {
    const od = dist.get(k);
    if (od === undefined || nd < od - 1e-12) {
      dist.set(k, nd);
      prev.set(k, step);
      heap.push(nd, k);
    }
  };
  for (const p of originAccess.keys()) relax(key(p, ''), 0, null);

  const done = new Set<string>();
  let goal: string | null = null;
  while (heap.size) {
    const { k: cost, v: sk } = heap.pop()!;
    if (done.has(sk)) continue;
    done.add(sk);
    const sep = sk.lastIndexOf(SEP);
    const p = sk.slice(0, sep);
    const r = sk.slice(sep + 1);
    if (r !== '' && destAccess.has(p)) {
      goal = sk;
      break;
    }
    for (const e of idx.ridesFrom.get(p) ?? []) {
      const penalty = r !== '' && r !== e.route ? MIN_TRANSFER_MIN : 0;
      relax(key(e.to, e.route), cost + Math.max(0, e.minutes) + penalty, { kind: 'ride', prev: sk, edge: e, switchPenalty: penalty });
    }
    if (r !== '') {
      const plat = data.network.platforms[p];
      if (!plat) continue;
      for (const q of platformsOf(data, plat.stationId)) {
        if (q === p) continue;
        const t = transferInfo(plat.stationId, p, q);
        if (!t) continue;
        relax(key(q, ''), cost + t.minutes, {
          kind: 'transfer',
          prev: sk,
          from: p,
          to: q,
          stationId: plat.stationId,
          minutes: t.minutes,
        });
      }
    }
  }
  if (!goal) return fail('no-path', d);

  // Reconstruct.
  const steps: Step[] = [];
  let cur: string = goal;
  for (let s = prev.get(cur); s; s = prev.get(cur)) {
    steps.push(s);
    cur = s.prev;
  }
  steps.reverse();
  const startPlatform = cur.slice(0, cur.lastIndexOf(SEP));
  const endPlatform = goal.slice(0, goal.lastIndexOf(SEP));
  const stationOf = (pid: string) => data.network.platforms[pid]?.stationId ?? pid;

  const legs: Leg[] = [];
  const used = new Set<string>();
  const oa = originAccess.get(startPlatform)!;
  const da = destAccess.get(endPlatform)!;
  let approximate = oa.approximate || da.approximate;
  for (const f of oa.inPath?.facilityIds ?? []) used.add(f);

  for (const s of steps) {
    if (s.kind === 'transfer') {
      const t = transferInfo(s.stationId, s.from, s.to)!;
      approximate = approximate || t.approximate;
      for (const f of t.facilityIds) used.add(f);
      legs.push({ kind: 'transfer', stationId: s.stationId, minutes: round1(s.minutes), fromPlatform: s.from, toPlatform: s.to });
      continue;
    }
    const e = s.edge;
    if (s.switchPenalty > 0) {
      legs.push({ kind: 'transfer', stationId: stationOf(e.from), minutes: round1(s.switchPenalty), fromPlatform: e.from, toPlatform: e.from });
    }
    const last = legs[legs.length - 1];
    const toSt = stationOf(e.to);
    if (last && last.kind === 'ride' && last.route === e.route && last.toPlatform === e.from) {
      last.minutes = last.minutes + Math.max(0, e.minutes);
      last.toPlatform = e.to;
      last.toStation = toSt;
      if (last.stationIds[last.stationIds.length - 1] !== toSt) last.stationIds.push(toSt);
    } else {
      const fromSt = stationOf(e.from);
      legs.push({
        kind: 'ride',
        route: e.route,
        fromStation: fromSt,
        toStation: toSt,
        stationIds: fromSt === toSt ? [fromSt] : [fromSt, toSt],
        minutes: Math.max(0, e.minutes),
        fromPlatform: e.from,
        toPlatform: e.to,
      });
    }
  }
  for (const l of legs) l.minutes = round1(l.minutes);
  for (const f of da.outPath?.facilityIds ?? []) used.add(f);

  return {
    ok: true,
    minutes: round1(dist.get(goal)!),
    legs,
    transfers: legs.filter((l) => l.kind === 'transfer').length,
    approximate,
    usedFacilityIds: [...used],
    originEntranceId: oa.inPath?.from ?? null,
    destinationExitId: da.outPath?.to ?? null,
  };
}
