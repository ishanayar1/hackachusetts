'use client';
// Base map skins. OpenFreeMap vector styles, plus Esri satellite imagery as an inline raster style.
// Every skin falls back to Light (positron) if it fails to load.
import { useCallback, useSyncExternalStore } from 'react';
import type { StyleSpecification } from 'maplibre-gl';

export type MapSkin = 'light' | 'streets' | 'bright' | 'dark' | 'satellite';

export const SKINS: { id: MapSkin; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'streets', label: 'Streets' },
  { id: 'bright', label: 'Bright' },
  { id: 'dark', label: 'Dark' },
  { id: 'satellite', label: 'Satellite' },
];

const OFM = 'https://tiles.openfreemap.org/styles';
const POSITRON = `${OFM}/positron`;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

const SATELLITE: StyleSpecification = {
  version: 8,
  // Station labels are text layers, so the style needs glyphs even though the base is imagery.
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    sat: {
      type: 'raster',
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    places: {
      type: 'raster',
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'places', type: 'raster', source: 'places' },
  ],
};

const STYLE: Record<MapSkin, string | StyleSpecification> = {
  light: POSITRON,
  streets: `${OFM}/liberty`,
  bright: `${OFM}/bright`,
  dark: `${OFM}/dark`,
  satellite: SATELLITE,
};

const isSkin = (x: unknown): x is MapSkin => typeof x === 'string' && x in STYLE;

/** Styles to try in order: the chosen skin, then Light. */
export function skinStyles(id: string): (string | StyleSpecification)[] {
  const s = isSkin(id) ? STYLE[id] : POSITRON;
  return s === POSITRON ? [POSITRON] : [s, POSITRON];
}

/**
 * Layer to draw our overlays under: the first label layer above every fill and line of the base map.
 * (Some styles put a water label early, under buildings; inserting there would hide our icons.)
 */
export function labelLayerId(layers: readonly { id: string; type: string }[]): string | undefined {
  let lastBase = -1;
  layers.forEach((l, i) => {
    if (l.type !== 'symbol') lastBase = i;
  });
  return layers.slice(lastBase + 1).find((l) => l.type === 'symbol')?.id;
}

// ---------- remembered choice (this device only) ----------
const KEY = 'lastmile.mapSkin';
const listeners = new Set<() => void>();
let current: MapSkin | null = null;

function read(): MapSkin {
  if (current) return current;
  try {
    const v = window.localStorage.getItem(KEY);
    current = isSkin(v) ? v : 'light';
  } catch {
    current = 'light';
  }
  return current;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMapSkin(): [MapSkin, (s: MapSkin) => void] {
  const skin = useSyncExternalStore(subscribe, read, () => 'light' as const);
  const set = useCallback((s: MapSkin) => {
    current = s;
    try {
      window.localStorage.setItem(KEY, s);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    listeners.forEach((l) => l());
  }, []);
  return [skin, set];
}
