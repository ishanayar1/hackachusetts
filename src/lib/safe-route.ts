// Score a route by recorded crash risk, using the crash-risk intersection sites.
// Pure and framework-agnostic: given [lng,lat] points and the crash spots,
// sum the model's per-year estimate of the nearest site to each sampled point.
import type { CrashSpot } from '@/lib/crash';
import { haversineKm } from '@/lib/router';

export type RiskScore = {
  /** Sum of per-year crash estimates over the sites the route passes through. */
  riskTotal: number;
  /** The single worst site the route touches. */
  riskPeak: number;
  hotspot: string | null;
  siteCount: number;
};

/** Count a crash site "on the route" within this radius of a sampled point. */
const NEAR_KM = 0.12;

/**
 * Score a route (array of [lng, lat]) against crash spots. For each sampled
 * point we find the nearest crash site within NEAR_KM and accumulate its yearly
 * estimate once per distinct site, so a long route isn't penalised for having
 * many points near the same intersection.
 */
export function scorePath(coords: ReadonlyArray<readonly [number, number]>, spots: readonly CrashSpot[]): RiskScore {
  const seen = new Set<string>();
  let total = 0;
  let peak = 0;
  let hotspot: string | null = null;

  for (const [lng, lat] of coords) {
    let best: CrashSpot | null = null;
    let bestKm = NEAR_KM;
    for (const s of spots) {
      // cheap bounding-box reject before the haversine
      if (Math.abs(s.lat - lat) > 0.002 || Math.abs(s.lng - lng) > 0.0025) continue;
      const km = haversineKm(lat, lng, s.lat, s.lng);
      if (km < bestKm) {
        bestKm = km;
        best = s;
      }
    }
    if (!best || seen.has(best.site)) continue;
    seen.add(best.site);
    total += best.estimatePerYear;
    if (best.estimatePerYear > peak) {
      peak = best.estimatePerYear;
      hotspot = best.label;
    }
  }

  return {
    riskTotal: Math.round(total * 100) / 100,
    riskPeak: Math.round(peak * 100) / 100,
    hotspot,
    siteCount: seen.size,
  };
}

/**
 * Pick high-risk hexes inside the origin→destination corridor and return them
 * as GeoJSON-style polygon rings ([[lng,lat],...]) suitable for Valhalla's
 * `exclude_polygons`, so the router can be asked to walk AROUND them.
 * Endpoints' own hexes are never excluded (that would make them unreachable).
 */
export function riskExclusionPolygons(
  from: readonly [number, number],
  to: readonly [number, number],
  spots: readonly CrashSpot[],
  opts: { percentile?: number; max?: number } = {},
): number[][][] {
  const percentile = opts.percentile ?? 0.85; // exclude the corridor's worst ~15%
  const max = opts.max ?? 8;
  const pad = 0.004; // ~450 m around the corridor box
  const [fLng, fLat] = from;
  const [tLng, tLat] = to;
  const loLat = Math.min(fLat, tLat) - pad;
  const hiLat = Math.max(fLat, tLat) + pad;
  const loLng = Math.min(fLng, tLng) - pad;
  const hiLng = Math.max(fLng, tLng) + pad;

  // Don't exclude the sites nearest the endpoints (that would strand them).
  const near = (p: readonly [number, number]) => {
    let bestSite = '';
    let bestKm = Infinity;
    for (const s of spots) {
      const km = haversineKm(p[1], p[0], s.lat, s.lng);
      if (km < bestKm) {
        bestKm = km;
        bestSite = s.site;
      }
    }
    return bestSite;
  };
  const endpointSites = new Set([near(from), near(to)]);

  // Sites within the corridor, excluding the endpoints' own sites.
  const corridor = spots.filter(
    (s) =>
      !endpointSites.has(s.site) &&
      s.lat >= loLat &&
      s.lat <= hiLat &&
      s.lng >= loLng &&
      s.lng <= hiLng,
  );

  // Threshold is RELATIVE to the corridor's own risk distribution, so it adapts
  // to the data (intersection risk_yr tops out ~10, not the old hex ~37 scale).
  // Floor at a tiny value so we never "avoid" areas that are all near-zero risk.
  const sorted = corridor.map((s) => s.estimatePerYear).sort((a, b) => a - b);
  const pctValue = sorted.length ? sorted[Math.floor(percentile * sorted.length)] : 0;
  const threshold = Math.max(pctValue, 0.5);

  const inBox = corridor
    .filter((s) => s.estimatePerYear >= threshold)
    .sort((a, b) => b.estimatePerYear - a.estimatePerYear)
    .slice(0, max);

  // Build a tight square around each risky intersection. Keep it small (~35 m
  // half-width) so the router can still take a parallel street one block over;
  // larger boxes tend to box in dense downtown destinations entirely (Valhalla
  // returns "no path"), which defeats the avoidance.
  const half = 0.00035; // ~38 m
  return inBox.map((s) => {
    const ring: number[][] = [
      [s.lng - half, s.lat - half],
      [s.lng + half, s.lat - half],
      [s.lng + half, s.lat + half],
      [s.lng - half, s.lat + half],
      [s.lng - half, s.lat - half],
    ];
    return ring;
  });
}
