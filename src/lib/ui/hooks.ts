'use client';
// SWR hooks for static files and live API routes. Polling pauses while the tab is hidden.
import { useMemo } from 'react';
import useSWR from 'swr';
import {
  fetchJson,
  type AlertsData,
  type ApiEnvelope,
  type CrashLocationsData,
  type Facility,
  type PlannedRoute,
  type Prediction,
  type Station,
  type StationDetailData,
  type StationsStatusData,
  type Vehicle,
} from './api';
import { walkUrl, type LatLon, type WalkResult } from './walk';

const STATIC = { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false, shouldRetryOnError: false };
const LIVE = { refreshWhenHidden: false, refreshWhenOffline: false, keepPreviousData: true };

export function useStations() {
  const { data, error } = useSWR<Station[]>('/data/stations.json', fetchJson, STATIC);
  const byId = useMemo(() => new Map((data ?? []).map((s) => [s.id, s])), [data]);
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  return { stations: data, byId, sorted, error };
}

export function useFacilities() {
  const { data, error } = useSWR<Facility[]>('/data/facilities.json', fetchJson, STATIC);
  const byId = useMemo(() => new Map((data ?? []).map((f) => [f.id, f])), [data]);
  return { facilities: data, byId, error };
}

/** Platform names ("Alewife", "Forest Hills"): fallback for "toward ..." when /api/route has no leg.towards. */
export function usePlatformNames(enabled = true) {
  const { data } = useSWR<{ platforms: Record<string, { name: string }> }>(
    enabled ? '/data/network.json' : null,
    fetchJson,
    STATIC,
  );
  return data?.platforms;
}

/** Walking route between two points (server caches and falls back Valhalla -> OSRM -> straight line). */
export function useWalk(from: LatLon | null, to: LatLon | null) {
  return useSWR<ApiEnvelope<WalkResult>>(from && to ? walkUrl(from, to) : null, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });
}

export function useAlerts() {
  return useSWR<ApiEnvelope<AlertsData>>('/api/alerts', fetchJson, { ...LIVE, refreshInterval: 30_000 });
}

export function useStationsStatus() {
  return useSWR<ApiEnvelope<StationsStatusData>>('/api/stations/status', fetchJson, {
    ...LIVE,
    refreshInterval: 30_000,
    errorRetryCount: 2,
  });
}

export function useStationDetail(id: string | null) {
  return useSWR<ApiEnvelope<StationDetailData>>(id ? `/api/station/${encodeURIComponent(id)}` : null, fetchJson, {
    ...LIVE,
    refreshInterval: 30_000,
  });
}

export function usePredictions(id: string | null) {
  return useSWR<ApiEnvelope<Prediction[]>>(id ? `/api/predictions?stop=${encodeURIComponent(id)}` : null, fetchJson, {
    ...LIVE,
    refreshInterval: 20_000,
    errorRetryCount: 2,
  });
}

export type RouteQuery = { from: string; to: string; closed: string[] };

export function routeUrl(q: RouteQuery): string {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.closed.length) p.set('closed', q.closed.join(','));
  return `/api/route?${p.toString()}`;
}

export function useRoute(q: RouteQuery | null) {
  return useSWR<ApiEnvelope<PlannedRoute>>(q ? routeUrl(q) : null, fetchJson, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
}

export function useCrashLocations(q: string, sort: 'recorded' | 'model') {
  const p = new URLSearchParams({ q, limit: '50', sort });
  return useSWR<ApiEnvelope<CrashLocationsData>>(`/api/crash/locations?${p.toString()}`, fetchJson, {
    ...STATIC,
    keepPreviousData: true,
  });
}

/** Live trains for the map: every 15 s, paused while the tab is hidden; only fetched while the layer is on. */
export function useVehicles(enabled: boolean) {
  return useSWR<ApiEnvelope<Vehicle[]>>(enabled ? '/api/vehicles' : null, fetchJson, {
    ...LIVE,
    refreshInterval: 15_000,
    errorRetryCount: 2,
  });
}

/** A static file under /data, fetched once and only after its layer is first turned on. */
export function useStaticFile<T>(url: string, enabled: boolean) {
  return useSWR<T>(enabled ? url : null, fetchJson, STATIC);
}

/** Local fallback for the crash list: read the static layer directly. */
export function useCrashGeojson(enabled: boolean) {
  return useSWR<GeoJSON.FeatureCollection>(enabled ? '/data/crash-risk.geojson' : null, fetchJson, STATIC);
}
