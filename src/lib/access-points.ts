// Where to draw an elevator / lift / ramp on the map. MBTA gives coordinates for only some facilities
// (about 1 in 5 elevators), so fall back to the facility's own pathway, then to the station point.
// Pure: used by scripts/build-gtfs.ts and tests. No Next imports.
import type { LatLon } from './walk';

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function facilityPosition(
  facilityId: string,
  edges: readonly { from: string; to: string; facilityId: string | null }[],
  nodeCoord: (id: string) => LatLon | null,
  own: LatLon | null,
  station: LatLon,
): LatLon & { approx: boolean } {
  if (own) return { lat: r5(own.lat), lon: r5(own.lon), approx: false };
  let oneEnd: LatLon | null = null;
  for (const e of edges) {
    if (e.facilityId !== facilityId) continue;
    const a = nodeCoord(e.from);
    const b = nodeCoord(e.to);
    if (a && b) return { lat: r5((a.lat + b.lat) / 2), lon: r5((a.lon + b.lon) / 2), approx: false };
    oneEnd ??= a ?? b;
  }
  if (oneEnd) return { lat: r5(oneEnd.lat), lon: r5(oneEnd.lon), approx: false };
  return { lat: station.lat, lon: station.lon, approx: true };
}
