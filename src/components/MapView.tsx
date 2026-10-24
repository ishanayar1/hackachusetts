'use client';
// MapLibre map (client only; loaded through next/dynamic with ssr:false in MapClient.tsx).
// All overlays are GeoJSON sources + layers. Everything shown here is also listed as text in the panel.
import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Map, { Layer, NavigationControl, Popup, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { CrashHex, MapFeatureInfo, MapLayerToggles } from '@/lib/ui/api';
import { crashFilter, hexFromProps, type CrashMode } from '@/lib/ui/format';
import { accessIcon, addMapIcons, crashIcon, STATION_ICON } from '@/lib/ui/map-icons';
import { labelLayerId, skinStyles, type MapSkin } from '@/lib/ui/map-skins';


export type FlyTarget = { lng: number; lat: number; zoom?: number; seq: number };

export type MapViewProps = {
  /** Base map skin (falls back to Light when it fails to load). */
  skin?: MapSkin;
  stations: GeoJSON.FeatureCollection;
  route: GeoJSON.FeatureCollection;
  /** Walking legs, drawn as a dashed line. */
  walk?: GeoJSON.FeatureCollection;
  /** Car route, drawn as a solid dark line. */
  drive?: GeoJSON.FeatureCollection;
  /** MBTA lots with accessible spaces (Drive tab). */
  parking?: GeoJSON.FeatureCollection;
  /** Highlighted safe bike route from the chatbot (null = none). */
  bikeRoute: GeoJSON.FeatureCollection | null;
  crashMode: CrashMode;
  selectedStationId: string | null;
  selectedHex: string | null;
  flyTo: FlyTarget | null;
  onSelectStation: (id: string) => void;
  onSelectHex: (hex: CrashHex) => void;
  /** Optional layers (toggled in MapKey) and their data; undefined until loaded. */
  layers?: MapLayerToggles;
  vehicles?: GeoJSON.FeatureCollection;
  fatal?: GeoJSON.FeatureCollection;
  danger?: GeoJSON.FeatureCollection;
  ramps?: GeoJSON.FeatureCollection;
  equity?: GeoJSON.FeatureCollection;
  /** Elevators, lifts, ramps and doors; closedFacilityIds turn equipment red. */
  access?: GeoJSON.FeatureCollection;
  closedFacilityIds?: string[];
  onSelectFeature?: (info: MapFeatureInfo) => void;
  /** A tap on empty map gives its spot; a tap on anything else, or closing the popup, gives null. */
  onPickPlace?: (p: { lat: number; lon: number } | null) => void;
  /** The tapped spot and the popup shown there (directions choices). */
  pin?: { lat: number; lon: number } | null;
  pinContent?: ReactNode;
  /** Trip start / end places and the tapped spot: points with role 'start' | 'end' | 'pin'. */
  places?: GeoJSON.FeatureCollection;
};

const NO_LAYERS: MapLayerToggles = { trains: false, fatal: false, danger: false, equity: false, ramps: false, access: false };
const RAMP_LAYERS = ['ramps-points'];

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turn a clicked feature of an optional layer into panel text data. */
function featureInfo(layerId: string, p: Record<string, unknown>, closed: readonly string[] = []): MapFeatureInfo | null {
  if (layerId === 'access-points')
    return {
      kind: 'access',
      id: str(p.id),
      type: str(p.kind),
      name: str(p.name),
      stationId: str(p.stationId),
      approx: p.approx === true,
      closed: p.kind === 'ENTRANCE' ? p.wheelchair === 2 : closed.includes(str(p.id)),
    };
  if (layerId === 'vehicles')
    return {
      kind: 'train',
      id: str(p.id),
      routeId: str(p.routeId),
      headsign: str(p.headsign) || null,
      status: str(p.status),
      stationId: str(p.stationId) || null,
      updatedAt: str(p.updatedAt),
    };
  if (layerId === 'fatal-points')
    return { kind: 'fatal', id: str(p.id), date: str(p.date), mode: str(p.mode), label: str(p.label) };
  if (layerId === 'danger-points')
    return { kind: 'danger', id: str(p.id), date: str(p.date), mode: str(p.mode), concern: str(p.concern) };
  if (RAMP_LAYERS.includes(layerId)) return { kind: 'ramp', id: str(p.id), condition: str(p.condition) };
  if (layerId === 'equity-fill')
    return {
      kind: 'equity',
      geoid: str(p.geoid),
      municipality: str(p.municipality),
      population: numOrNull(p.population) ?? 0,
      pctMinority: numOrNull(p.pctMinority),
      limitedEnglishPct: numOrNull(p.limitedEnglishPct),
      medianIncome: numOrNull(p.medianIncome),
      criteria: str(p.criteria),
    };
  return null;
}

/** Click priority among the optional point layers (most specific first). */
const FEATURE_LAYER_ORDER = ['vehicles', 'access-points', 'fatal-points', 'danger-points', ...RAMP_LAYERS];

// "zoom" stays at the top level of these expressions (MapLibre rejects it nested in arithmetic).
const POINT_ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 0.8, 16, 1.1];
const STATION_ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 10, 0.75, 12, 0.9, 14, 1.15, 16, 1.4];

/** A small cartoon cat (cream walks the route, tan waits at the destination), drawn once per map. */
function catImage(fill: string): ImageData | null {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) return null;
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = '#16181D';
  g.fillStyle = fill;
  g.beginPath(); // tail
  g.moveTo(46, 46);
  g.quadraticCurveTo(62, 42, 55, 26);
  g.stroke();
  g.beginPath(); // body
  g.ellipse(35, 47, 15, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  for (const [a, b, cx] of [[11, 22, 22], [37, 22, 26]] as const) {
    g.beginPath(); // ears
    g.moveTo(a, b);
    g.lineTo(a < 20 ? 13 : 35, 6);
    g.lineTo(cx, 14);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.beginPath(); // head
  g.arc(24, 25, 13, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#16181D';
  g.beginPath();
  g.arc(19, 24, 2, 0, Math.PI * 2);
  g.arc(29, 24, 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#E57373';
  g.beginPath();
  g.arc(24, 29, 1.7, 0, Math.PI * 2);
  g.fill();
  return g.getImageData(0, 0, s, s);
}

/** Cartoon train car (line color) or bus (MBTA yellow): rounded body, windows, wheels. Drawn at 2x. */
function vehicleImage(fill: string, bus: boolean): ImageData | null {
  const w = bus ? 52 : 60;
  const h = 40;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.lineWidth = 3;
  g.strokeStyle = '#16181D';
  g.fillStyle = '#16181D'; // wheels
  for (const x of bus ? [14, w - 14] : [14, 26, w - 26, w - 14]) {
    g.beginPath();
    g.arc(x, h - 7, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = fill; // body
  g.beginPath();
  g.roundRect(3, 3, w - 6, h - 12, bus ? 8 : 10);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff'; // windows
  const n = bus ? 3 : 3;
  const ww = (w - 18 - (n - 1) * 4) / n;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.roundRect(9 + i * (ww + 4), 9, ww, 10, 3);
    g.fill();
  }
  if (!bus) {
    g.fillStyle = '#FFE08A'; // headlight
    g.beginPath();
    g.arc(w - 8, h - 17, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  return g.getImageData(0, 0, w, h);
}

/** Vehicle icons are drawn when the map first asks for them (one per line color, plus the bus). */
function onMissingImage(map: ReturnType<MapRef['getMap']>, id: string) {
  if (!id.startsWith('lm-veh-') || map.hasImage(id)) return;
  const bus = id === 'lm-veh-bus';
  const img = vehicleImage(bus ? '#FFC72C' : `#${id.slice('lm-veh-train-'.length)}`, bus);
  if (img) map.addImage(id, img, { pixelRatio: 2 });
}

function addCatIcons(map: ReturnType<MapRef['getMap']>) {
  for (const [id, fill] of [['lm-cat-cream', '#F6E7C8'], ['lm-cat-tan', '#D9A066']] as const) {
    if (map.hasImage(id)) continue;
    const img = catImage(fill);
    if (img) map.addImage(id, img, { pixelRatio: 2 });
  }
}

type LngLat = [number, number];
const dist2 = (a: LngLat, b: LngLat) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Chain every trip line (walks and rides) into one path from the start, flipping lines as needed. */
function tripPath(start: LngLat | null, ...fcs: (GeoJSON.FeatureCollection | null | undefined)[]): LngLat[] {
  const lines: LngLat[][] = [];
  for (const fc of fcs)
    for (const f of fc?.features ?? []) {
      if (f.geometry?.type === 'LineString') lines.push(f.geometry.coordinates as LngLat[]);
      else if (f.geometry?.type === 'MultiLineString') for (const l of f.geometry.coordinates) lines.push(l as LngLat[]);
    }
  const usable = lines.filter((l) => l.length > 1);
  if (!usable.length) return [];
  let at: LngLat = start ?? usable[0][0];
  const path: LngLat[] = [];
  while (usable.length) {
    let best = 0;
    let flip = false;
    let bestD = Infinity;
    usable.forEach((l, i) => {
      const d0 = dist2(at, l[0]);
      const d1 = dist2(at, l[l.length - 1]);
      if (d0 < bestD) [bestD, best, flip] = [d0, i, false];
      if (d1 < bestD) [bestD, best, flip] = [d1, i, true];
    });
    const line = usable.splice(best, 1)[0];
    const seg = flip ? [...line].reverse() : line;
    path.push(...seg);
    at = seg[seg.length - 1];
  }
  return path;
}

/** Point a fraction k (0..1) of the way along a path. */
function along(path: LngLat[], k: number): LngLat {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.sqrt(dist2(path[i - 1], path[i]));
    lens.push(d);
    total += d;
  }
  let target = k * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(1, target / lens[i]) : 0;
      const [a, b] = [path[i], path[i + 1]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    target -= lens[i];
  }
  return path[path.length - 1];
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const NO_IDS: string[] = [];
const ACCESS_ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 14, 1.05, 17, 1.4];

const STATION_LAYERS = ['stations-icons'];

// One warning sign per intersection; it grows with zoom so dense areas stay readable zoomed out.
const CRASH_ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 11, 0.45, 14, 0.75, 17, 1.1];
// Selection ring: 4 px larger at every stop. MapLibre only allows "zoom" at the top level of interpolate,
// so ['+', CRASH_RADIUS, 4] is rejected.
const CRASH_SELECTED_RADIUS = ['interpolate', ['linear'], ['zoom'], 11, 6.5, 14, 9, 17, 13];

// MBTA lines: 4-5px in the line color on a white casing, a little wider zoomed in.
const LINE_WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 3, 13, 4.5, 16, 6];
const LINE_CASING_WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 5.5, 13, 7.5, 16, 9.5];

type Padding = { top: number; bottom: number; left: number; right: number };

/** Height of the phone bottom sheet in px, from the shell's --sheet-h (38% of the screen if unset). */
function sheetHeight(): number {
  const fallback = window.innerHeight * 0.38;
  const shell = document.querySelector('.app-shell');
  const raw = shell ? getComputedStyle(shell).getPropertyValue('--sheet-h').trim() : '';
  const n = parseFloat(raw);
  if (!raw || !Number.isFinite(n)) return fallback;
  if (raw.endsWith('px')) return n;
  if (/v[hw]$|dvh$|svh$|lvh$/.test(raw)) return (n / 100) * window.innerHeight;
  if (raw.endsWith('%')) return (n / 100) * window.innerHeight;
  return n === 0 ? 0 : fallback;
}

/**
 * Camera padding so the map centers in the area not covered by the UI (layout contract):
 * desktop: left 432 (panel), top 72 (top bar); phone: top 72, bottom = bottom sheet height.
 */
function cameraPadding(containerHeight: number): Padding {
  if (window.matchMedia('(min-width: 768px)').matches) return { top: 72, bottom: 0, left: 432, right: 0 };
  // Always leave some map visible between the top bar and the sheet.
  const bottom = Math.max(0, Math.min(sheetHeight(), containerHeight - 72 - 120));
  return { top: 72, bottom, left: 0, right: 0 };
}

// MapLibre 6 looks for its worker next to its own bundle file, which the bundler renames.
// Point it at the worker emitted as a static asset instead.
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

export default function MapView(props: MapViewProps) {
  const { stations, route, walk, bikeRoute, crashMode, selectedStationId, selectedHex, flyTo, onSelectStation, onSelectHex } =
    props;
  const layers = props.layers ?? NO_LAYERS;
  const { onSelectFeature, onPickPlace, pin } = props;
  const closedIds = props.closedFacilityIds ?? NO_IDS;
  const accessIconExpr = useMemo(() => accessIcon(closedIds), [closedIds]);
  const mapRef = useRef<MapRef>(null);
  const skin = props.skin ?? 'light';
  const styles = useMemo(() => skinStyles(skin), [skin]);
  // Fallback position and load state belong to one skin: switching skins starts both over.
  const [fallback, setFallback] = useState({ skin, idx: 0 });
  const styleIdx = fallback.skin === skin ? fallback.idx : 0;
  const mapKey = `${skin}-${styleIdx}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loaded = loadedKey === mapKey;
  const failed = styleIdx >= styles.length;
  // Keep the view when the map is re-created for another skin.
  const [view, setView] = useState({ longitude: -71.08, latitude: 42.35, zoom: 12 });
  const [firstSymbolId, setFirstSymbolId] = useState<string | undefined>(undefined);

  /** Apply the camera padding (on load and resize) so flyTo / fitBounds center in the visible area. */
  const applyPadding = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const p = cameraPadding(map.getContainer().clientHeight);
    const cur = map.getPadding();
    if (cur.top !== p.top || cur.bottom !== p.bottom || cur.left !== p.left || cur.right !== p.right) map.setPadding(p);
  }, []);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    applyPadding();
    if (map) {
      addMapIcons(map);
      addCatIcons(map);
      map.on('styleimagemissing', (e: { id: string }) => onMissingImage(map, e.id));
    }
    const styleLayers = map?.getStyle()?.layers ?? [];
    setFirstSymbolId(labelLayerId(styleLayers));
    setLoadedKey(mapKey);
  }, [mapKey, applyPadding]);

  const onError = useCallback(
    (e: { error?: Error }) => {
      const message = e.error?.message ?? '';
      // Layer validation errors ("layers.<id>...") are bugs in our layers, not a failed base map:
      // switching styles for them wipes the base map. Log them and keep the style.
      if (loaded || message.startsWith('layers.')) {
        console.warn('Map error', message);
        return;
      }
      console.warn('Map style error', message);
      // Defer: MapLibre can fire 'error' while react-map-gl renders a <Layer>, and setState during render is not allowed.
      queueMicrotask(() => setFallback({ skin, idx: styleIdx + 1 }));
    },
    [loaded, skin, styleIdx],
  );

  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Fresh padding: the phone sheet may have changed height since the last resize.
    const padding = cameraPadding(mapRef.current.getContainer().clientHeight);
    const opts = { center: [flyTo.lng, flyTo.lat] as [number, number], zoom: flyTo.zoom ?? 15, padding };
    if (reduce) mapRef.current.jumpTo(opts);
    else mapRef.current.flyTo({ ...opts, duration: 1200 });
  }, [flyTo]);

  // A short map (phones) may have no room above or below the tapped spot for its popup: move the spot down first.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!pin || !map) return;
    const h = map.getContainer().clientHeight;
    const y = map.project([pin.lon, pin.lat]).y;
    const POPUP_ROOM = 240;
    // Measure room inside the visible area (between the top bar and the phone sheet).
    const padding = cameraPadding(h);
    const visTop = padding.top;
    const visBottom = h - padding.bottom;
    if (y - visTop >= POPUP_ROOM || visBottom - y >= POPUP_ROOM) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Offsets are from the padded center; put the spot 40px above the visible bottom.
    const centerY = visTop + (visBottom - visTop) / 2;
    map.easeTo({ center: [pin.lon, pin.lat], offset: [0, visBottom - 40 - centerY], padding, duration: reduce ? 0 : 400 });
  }, [pin]);

  // Live trains glide to each new position instead of jumping.
  const shownTrains = useRef(new globalThis.Map<string, LngLat>());
  useEffect(() => {
    const map = mapRef.current?.getMap();
    const fc = layers.trains ? props.vehicles : undefined;
    const src = loaded ? (map?.getSource('vehicles') as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined) : undefined;
    if (!fc || !src?.setData) return;
    const from = shownTrains.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / 1800);
      const e = 1 - (1 - k) ** 3;
      const next = new globalThis.Map<string, LngLat>();
      const features = fc.features.map((f) => {
        const id = String(f.properties?.id ?? '');
        const to = (f.geometry as GeoJSON.Point).coordinates as LngLat;
        const a = from.get(id) ?? to;
        const p: LngLat = [a[0] + (to[0] - a[0]) * e, a[1] + (to[1] - a[1]) * e];
        next.set(id, p);
        return { ...f, geometry: { type: 'Point' as const, coordinates: p } };
      });
      src.setData!({ type: 'FeatureCollection', features });
      shownTrains.current = next;
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [props.vehicles, layers.trains, loaded]);

  // A soft halo breathes around each train, and the cream cat walks the trip while the tan cat waits at the end.
  const startPt = useMemo(() => {
    const f = props.places?.features.find((x) => x.properties?.role === 'start');
    return f ? ((f.geometry as GeoJSON.Point).coordinates as LngLat) : null;
  }, [props.places]);
  const path = useMemo(() => tripPath(startPt, props.walk, props.route), [startPt, props.walk, props.route]);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cats = map.getSource('cats') as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
    const end = path.length ? path[path.length - 1] : null;
    const catFc = (walker: LngLat | null): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: [
        ...(walker ? [{ type: 'Feature' as const, properties: { icon: 'lm-cat-cream' }, geometry: { type: 'Point' as const, coordinates: walker } }] : []),
        ...(end ? [{ type: 'Feature' as const, properties: { icon: 'lm-cat-tan' }, geometry: { type: 'Point' as const, coordinates: end } }] : []),
      ],
    });
    cats?.setData?.(catFc(path[0] ?? null));
    if (reduce) return;
    let raf = 0;
    const loop = path.length > 1 ? 14000 : 0;
    const frame = (now: number) => {
      if (layers.trains && map.getLayer('vehicles-halo')) {
        const p = (now % 1800) / 1800;
        map.setPaintProperty('vehicles-halo', 'circle-radius', 7 + p * 12);
        map.setPaintProperty('vehicles-halo', 'circle-opacity', 0.32 * (1 - p));
      }
      if (map.getLayer('stations-alert')) {
        const q = (now % 1400) / 1400;
        map.setPaintProperty('stations-alert', 'circle-radius', 8 + q * 14);
        map.setPaintProperty('stations-alert', 'circle-opacity', 0.45 * (1 - q));
      }
      // Street zoom: elevators ride gently up and down; broken ones pulse red.
      if (map.getZoom() >= 14 && map.getLayer('access-points')) {
        map.setPaintProperty('access-points', 'icon-translate', [0, -Math.abs(Math.sin(now / 600)) * 3]);
        const q = (now % 1200) / 1200;
        map.setPaintProperty('access-broken-pulse', 'circle-radius', 9 + q * 13);
        map.setPaintProperty('access-broken-pulse', 'circle-opacity', 0.5 * (1 - q));
      }
      if (loop && cats?.setData) {
        cats.setData(catFc(along(path, (now % loop) / loop)));
        if (map.getLayer('cats')) map.setPaintProperty('cats', 'icon-translate', [0, -Math.abs(Math.sin(now / 140)) * 3]);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [loaded, layers.trains, path]);

  /** Select whatever was tapped; false when nothing selectable was under the tap. */
  const selectTapped = useCallback(
    (feats: NonNullable<MapLayerMouseEvent['features']>): boolean => {
      const st = feats.find((f) => STATION_LAYERS.includes(f.layer.id));
      if (st?.properties?.id) {
        onSelectStation(String(st.properties.id));
        return true;
      }
      if (onSelectFeature) {
        for (const id of FEATURE_LAYER_ORDER) {
          const f = feats.find((x) => x.layer.id === id);
          const info = f ? featureInfo(id, (f.properties ?? {}) as Record<string, unknown>, closedIds) : null;
          if (info) {
            onSelectFeature(info);
            return true;
          }
        }
      }
      const hex = feats.find((f) => f.layer.id === 'crash-points');
      if (hex?.properties) {
        onSelectHex(hexFromProps(hex.properties as Record<string, unknown>));
        return true;
      }
      const ej = feats.find((f) => f.layer.id === 'equity-fill');
      const info = ej && onSelectFeature ? featureInfo('equity-fill', (ej.properties ?? {}) as Record<string, unknown>) : null;
      if (info) onSelectFeature?.(info);
      return !!info;
    },
    [onSelectStation, onSelectHex, onSelectFeature, closedIds],
  );

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (selectTapped(e.features ?? [])) onPickPlace?.(null);
      else onPickPlace?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    },
    [selectTapped, onPickPlace],
  );

  const vis = (on: boolean) => (on ? ('visible' as const) : ('none' as const));
  const interactive = loaded
    ? [
        ...STATION_LAYERS,
        ...(layers.trains ? ['vehicles'] : []),
        ...(layers.fatal ? ['fatal-points'] : []),
        ...(layers.danger ? ['danger-points'] : []),
        ...(layers.ramps ? RAMP_LAYERS : []),
        ...(layers.access ? ['access-points'] : []),
        ...(crashMode !== 'off' ? ['crash-points'] : []),
        ...(layers.equity ? ['equity-fill'] : []),
      ]
    : [];

  const crashVisible = crashMode !== 'off';

  return (
    <div className="relative h-full w-full bg-mapbg">
      {failed ? (
        <div className="flex h-full items-center justify-center bg-mapbg p-6 text-center text-[15px] font-semibold text-ink-2">
          <p>The map could not load. Everything it shows is also in the panel.</p>
        </div>
      ) : (
        <Map
          key={mapKey}
          ref={mapRef}
          mapStyle={styles[styleIdx]}
          initialViewState={view}
          onMoveEnd={(e) => {
            const { longitude, latitude, zoom } = e.viewState;
            setView({ longitude, latitude, zoom });
          }}
          style={{ width: '100%', height: '100%' }}
          onLoad={onLoad}
          onResize={applyPadding}
          onError={onError}
          onClick={onClick}
          interactiveLayerIds={interactive}
          cursor="pointer"
          attributionControl={{ compact: true }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {loaded && (
            <>
              {/* Environmental-justice block groups: hatched fill + outline, under the base map labels. */}
              <Source id="equity" type="geojson" data={(layers.equity && props.equity) || EMPTY_FC}>
                <Layer
                  id="equity-fill"
                  type="fill"
                  beforeId={firstSymbolId}
                  layout={{ visibility: vis(layers.equity) }}
                  paint={{ 'fill-pattern': 'lm-hatch', 'fill-opacity': 0.9 }}
                />
                <Layer
                  id="equity-outline"
                  type="line"
                  beforeId={firstSymbolId}
                  layout={{ visibility: vis(layers.equity) }}
                  paint={{ 'line-color': '#0f766e', 'line-width': 0.8, 'line-opacity': 0.7 }}
                />
              </Source>
              <Source id="crash" type="geojson" data="/data/crash-risk.geojson">
                <Layer
                  id="crash-points"
                  type="symbol"
                  beforeId={firstSymbolId}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  filter={crashFilter(crashMode) as any}
                  layout={{
                    visibility: crashVisible ? 'visible' : 'none',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-image': crashIcon(crashMode) as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-size': CRASH_ICON_SIZE as any,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    // draw the worst intersections on top
                    'symbol-sort-key': crashMode === 'model' ? ['get', 'risk_yr'] : ['+', ['get', 'ped'], ['get', 'bike']],
                  }}
                />
                <Layer
                  id="crash-selected"
                  type="circle"
                  beforeId={firstSymbolId}
                  layout={{ visibility: crashVisible ? 'visible' : 'none' }}
                  filter={['==', ['get', 'site'], selectedHex ?? '']}
                  paint={{
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'circle-radius': CRASH_SELECTED_RADIUS as any,
                    'circle-color': 'rgba(0,0,0,0)',
                    'circle-stroke-color': '#111827',
                    'circle-stroke-width': 3,
                  }}
                />
              </Source>
              <Source id="lines" type="geojson" data="/data/lines.geojson">
                <Layer
                  id="lines-casing"
                  type="line"
                  beforeId={firstSymbolId}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  paint={{ 'line-color': '#ffffff', 'line-width': LINE_CASING_WIDTH as any }}
                />
                <Layer
                  id="lines"
                  type="line"
                  beforeId={firstSymbolId}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  paint={{ 'line-color': ['coalesce', ['get', 'color'], '#555555'], 'line-width': LINE_WIDTH as any }}
                />
              </Source>
              {/* Curb ramps (City of Boston): brown square with a ramp wedge; a bar at the edge marks a lip. From zoom 14. */}
              <Source id="ramps" type="geojson" data={(layers.ramps && props.ramps) || EMPTY_FC}>
                <Layer
                  id="ramps-points"
                  type="symbol"
                  minzoom={14}
                  layout={{
                    visibility: vis(layers.ramps),
                    'icon-image': [
                      'match',
                      ['get', 'condition'],
                      'lip at edge',
                      'lm-ramp-lip',
                      'poor condition, lip at edge',
                      'lm-ramp-both',
                      'lm-ramp-poor',
                    ],
                    'icon-size': 0.8,
                    'icon-allow-overlap': true,
                  }}
                />
              </Source>
              {/* Resident-reported danger spots: purple square with a white "!". */}
              <Source id="danger" type="geojson" data={(layers.danger && props.danger) || EMPTY_FC}>
                <Layer
                  id="danger-points"
                  type="symbol"
                  layout={{
                    visibility: vis(layers.danger),
                    'icon-image': 'lm-danger',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-size': POINT_ICON_SIZE as any,
                    'icon-allow-overlap': true,
                  }}
                />
              </Source>
              {/* Fatal crashes: black circle with a white cross. */}
              <Source id="fatal" type="geojson" data={(layers.fatal && props.fatal) || EMPTY_FC}>
                <Layer
                  id="fatal-points"
                  type="symbol"
                  layout={{
                    visibility: vis(layers.fatal),
                    'icon-image': 'lm-fatal',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-size': POINT_ICON_SIZE as any,
                    'icon-allow-overlap': true,
                  }}
                />
              </Source>
              <Source id="route" type="geojson" data={route}>
                <Layer
                  id="route-casing"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#111827', 'line-width': 11 }}
                />
                <Layer
                  id="route-line"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': ['get', 'color'], 'line-width': 6 }}
                />
              </Source>
              {/* Car route: dark line on a white casing. */}
              <Source id="drive" type="geojson" data={props.drive ?? EMPTY_FC}>
                <Layer
                  id="drive-casing"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#ffffff', 'line-width': 9 }}
                />
                <Layer
                  id="drive-line"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#0f172a', 'line-width': 5 }}
                />
              </Source>
              {/* MBTA lots with accessible spaces: blue square with P and a wheelchair. */}
              <Source id="parking" type="geojson" data={props.parking ?? EMPTY_FC}>
                <Layer
                  id="parking-points"
                  type="symbol"
                  minzoom={10}
                  layout={{ 'icon-image': 'lm-parking', 'icon-size': 0.9, 'icon-allow-overlap': true }}
                />
              </Source>
              <Source id="walk" type="geojson" data={walk ?? EMPTY_FC}>
                <Layer
                  id="walk-casing"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#ffffff', 'line-width': 8 }}
                />
                <Layer
                  id="walk-line"
                  type="line"
                  layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
                  paint={{ 'line-color': '#111827', 'line-width': 4, 'line-dasharray': [2, 1.5] }}
                />
              </Source>
              {/* Highlighted safe bike route from the chatbot. */}
              <Source id="bike-route" type="geojson" data={bikeRoute ?? EMPTY_FC}>
                <Layer
                  id="bike-route-casing"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#064e3b', 'line-width': 10, 'line-opacity': 0.9 }}
                />
                <Layer
                  id="bike-route-line"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': '#22c55e', 'line-width': 5 }}
                />
                {/* Start: green dot. */}
                <Layer
                  id="bike-route-start"
                  type="circle"
                  filter={['==', ['get', 'role'], 'start']}
                  paint={{
                    'circle-radius': 7,
                    'circle-color': '#22c55e',
                    'circle-stroke-color': '#064e3b',
                    'circle-stroke-width': 3,
                  }}
                />
                {/* End: red destination marker (font-independent red ring + dot). */}
                <Layer
                  id="bike-route-end-ring"
                  type="circle"
                  filter={['==', ['get', 'role'], 'end']}
                  paint={{
                    'circle-radius': 9,
                    'circle-color': '#dc2626',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 3,
                  }}
                />
                <Layer
                  id="bike-route-end-dot"
                  type="circle"
                  filter={['==', ['get', 'role'], 'end']}
                  paint={{ 'circle-radius': 3, 'circle-color': '#ffffff' }}
                />
              </Source>
              {/* Live trains: dot in the line color with a white outline; an arrow shows direction from zoom 11. */}
              <Source id="vehicles" type="geojson" data={(layers.trains && props.vehicles) || EMPTY_FC}>
                <Layer
                  id="vehicles-halo"
                  type="circle"
                  filter={['!=', ['get', 'mode'], 'bus']}
                  layout={{ visibility: vis(layers.trains) }}
                  paint={{ 'circle-radius': 10, 'circle-color': ['get', 'color'], 'circle-opacity': 0.25 }}
                />
                {/* Buses only from street zoom, so the city view stays clean. */}
                <Layer
                  id="vehicles-bus"
                  type="symbol"
                  minzoom={12.5}
                  filter={['==', ['get', 'mode'], 'bus']}
                  layout={{
                    visibility: vis(layers.trains),
                    'icon-image': ['get', 'vicon'],
                    'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 1, 16, 1.4],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  }}
                />
                <Layer
                  id="vehicles"
                  type="symbol"
                  filter={['!=', ['get', 'mode'], 'bus']}
                  layout={{
                    visibility: vis(layers.trains),
                    'icon-image': ['get', 'vicon'],
                    'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 1, 13, 1.25, 16, 1.6],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  }}
                />
                <Layer
                  id="vehicles-arrow"
                  type="symbol"
                  minzoom={11}
                  filter={['has', 'bearing']}
                  layout={{
                    visibility: vis(layers.trains),
                    'icon-image': ['get', 'icon'],
                    'icon-rotate': ['get', 'bearing'],
                    'icon-rotation-alignment': 'map',
                    // the offset is applied in the rotated frame, so the arrow sits ahead of the dot
                    'icon-offset': [0, -17],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  }}
                />
              </Source>
              <Source id="stations" type="geojson" data={stations}>
                {/* Pulsing ring behind stations with broken step-free equipment (the icon still carries the state). */}
                <Layer
                  id="stations-alert"
                  type="circle"
                  filter={['in', ['get', 'state'], ['literal', ['no', 'partial']]]}
                  paint={{
                    'circle-radius': 10,
                    'circle-color': ['match', ['get', 'state'], 'no', '#B4231A', '#ED8B00'],
                    'circle-opacity': 0.3,
                  }}
                />
                {/* Shape and symbol differ by state, not just color (legend in MapKey). */}
                <Layer
                  id="stations-icons"
                  type="symbol"
                  layout={{
                    'icon-image': [
                      'match',
                      ['get', 'state'],
                      'yes',
                      STATION_ICON.yes,
                      'partial',
                      STATION_ICON.partial,
                      'no',
                      STATION_ICON.no,
                      STATION_ICON.unknown,
                    ],
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-size': STATION_ICON_SIZE as any,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    // problem stations on top
                    'symbol-sort-key': ['match', ['get', 'state'], 'no', 3, 'partial', 2, 'yes', 1, 0],
                  }}
                />
                <Layer
                  id="stations-selected"
                  type="circle"
                  filter={['==', ['get', 'id'], selectedStationId ?? '']}
                  paint={{
                    'circle-radius': 13,
                    'circle-color': 'rgba(0,0,0,0)',
                    'circle-stroke-color': '#111827',
                    'circle-stroke-width': 3,
                  }}
                />
                <Layer
                  id="stations-label"
                  type="symbol"
                  minzoom={13}
                  layout={{
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 12,
                    'text-offset': [0, 1.2],
                    'text-anchor': 'top',
                    'text-optional': true,
                  }}
                  paint={{ 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }}
                />
              </Source>
              {/* Trip start: green dot. Trip end: red ring with a white center. Tapped spot: blue dot.
                  The places are also named in the trip panel. */}
              <Source id="places" type="geojson" data={props.places ?? EMPTY_FC}>
                <Layer
                  id="place-start"
                  type="circle"
                  filter={['==', ['get', 'role'], 'start']}
                  paint={{ 'circle-radius': 7, 'circle-color': '#15803d', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }}
                />
                <Layer
                  id="place-end"
                  type="circle"
                  filter={['==', ['get', 'role'], 'end']}
                  paint={{ 'circle-radius': 9, 'circle-color': '#b91c1c', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }}
                />
                <Layer
                  id="place-end-dot"
                  type="circle"
                  filter={['==', ['get', 'role'], 'end']}
                  paint={{ 'circle-radius': 3, 'circle-color': '#ffffff' }}
                />
                <Layer
                  id="place-pin"
                  type="circle"
                  filter={['==', ['get', 'role'], 'pin']}
                  paint={{ 'circle-radius': 7, 'circle-color': '#1d4ed8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }}
                />
              </Source>
              {/* Decorative cats (the trip itself is listed as text in the panel). */}
              <Source id="cats" type="geojson" data={EMPTY_FC}>
                <Layer
                  id="cats"
                  type="symbol"
                  layout={{
                    'icon-image': ['get', 'icon'],
                    'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 1.1, 15, 1.5],
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  }}
                />
              </Source>
              {pin && (
                <Popup
                  longitude={pin.lon}
                  latitude={pin.lat}
                  offset={14}
                  maxWidth="260px"
                  closeOnClick={false}
                  onClose={() => onPickPlace?.(null)}
                >
                  {props.pinContent}
                </Popup>
              )}
              {/* Elevators, lifts, ramps (blue; escalators slate; red with a slash when out of service) and
                  station doors (green; grey with a slash when not step-free). From zoom 14 to keep the map clear.
                  Above stations so a broken elevator is never hidden under its station. */}
              <Source id="access" type="geojson" data={(layers.access && props.access) || EMPTY_FC}>
                {/* Pulsing red ring under each out-of-service elevator, lift or ramp. */}
                <Layer
                  id="access-broken-pulse"
                  type="circle"
                  minzoom={14}
                  filter={['in', ['get', 'id'], ['literal', closedIds]]}
                  layout={{ visibility: vis(layers.access) }}
                  paint={{ 'circle-radius': 10, 'circle-color': '#B4231A', 'circle-opacity': 0.3 }}
                />
                <Layer
                  id="access-points"
                  type="symbol"
                  minzoom={14}
                  layout={{
                    visibility: vis(layers.access),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-image': accessIconExpr as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'icon-size': ACCESS_ICON_SIZE as any,
                    'icon-allow-overlap': true,
                    // broken equipment on top
                    'symbol-sort-key': ['case', ['in', ['get', 'id'], ['literal', closedIds]], 1, 0],
                  }}
                  paint={{ 'icon-opacity': ['case', ['get', 'approx'], 0.75, 1] }}
                />
              </Source>
            </>
          )}
        </Map>
      )}
    </div>
  );
}
