// Build small GeoJSON collections for the map from static stations, live status and a planned route.
import type { Station, StationStatusRow, Vehicle } from './api';
import { ROUTE_COLORS, stepFreeState } from './format';
import type { Leg } from '@/lib/router';

export function stationsGeojson(
  stations: Station[] | undefined,
  live: Map<string, StationStatusRow>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: (stations ?? [])
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({
        type: 'Feature',
        id: s.id,
        properties: { id: s.id, name: s.name, state: stepFreeState(s, live.get(s.id)) },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
  };
}

/** One line per ride leg, through the leg's stations, colored by route. */
export function routeGeojson(
  legs: Leg[] | undefined,
  byId: Map<string, Station>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const leg of legs ?? []) {
    if (leg.kind !== 'ride') continue;
    const coords = leg.stationIds
      .map((id) => byId.get(id))
      .filter((s): s is Station => !!s)
      .map((s) => [s.lon, s.lat]);
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { route: leg.route, color: ROUTE_COLORS[leg.route] ?? '#1d4ed8' },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Map icon name for a train's direction arrow (one image per line color, added by MapView). */
export function arrowIconName(color: string): string {
  return `lm-arrow-${color.replace('#', '').toLowerCase()}`;
}

/** Live trains as points. Stale positions and bad coordinates are skipped; bearing only when known. */
export function vehiclesGeojson(vehicles: readonly Vehicle[] | undefined): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: (vehicles ?? [])
      .filter((v) => !v.stale && Number.isFinite(v.lat) && Number.isFinite(v.lon))
      .map((v) => {
        const bus = v.mode === 'bus';
        const color = bus ? '#FFC72C' : (ROUTE_COLORS[v.routeId] ?? '#1d4ed8');
        const props: Record<string, unknown> = {
          id: v.id,
          mode: bus ? 'bus' : 'subway',
          // Cartoon vehicle icon, drawn on demand by MapView ("lm-veh-bus" or "lm-veh-train-<hex>").
          vicon: bus ? 'lm-veh-bus' : `lm-veh-train-${color.replace('#', '').toLowerCase()}`,
          routeId: v.routeId,
          headsign: v.headsign ?? '',
          status: v.status,
          stationId: v.stationId ?? '',
          updatedAt: v.updatedAt,
          color,
          icon: arrowIconName(color),
        };
        if (!bus && typeof v.bearing === 'number' && Number.isFinite(v.bearing)) props.bearing = v.bearing;
        return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [v.lon, v.lat] } };
      }),
  };
}

/** Rows with lat/lon (fatal crashes, danger reports, curb ramps) as points; every other field becomes a property. */
export function pointsGeojson<T extends { lat: number; lon: number }>(
  rows: readonly T[] | undefined,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: (rows ?? [])
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
      .map(({ lat, lon, ...rest }) => ({
        type: 'Feature',
        properties: rest,
        geometry: { type: 'Point', coordinates: [lon, lat] },
      })),
  };
}

/** Walking line(s) for the map, drawn dashed. Each entry is a list of [lon, lat]. */
export function walkGeojson(lines: [number, number][][] | null | undefined): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: (lines ?? [])
      .filter((c) => c.length >= 2)
      .map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
  };
}
