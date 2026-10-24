'use client';
// MapLibre map (client only; loaded through next/dynamic with ssr:false in MapClient.tsx).
// All overlays are GeoJSON sources + layers. Everything shown here is also listed as text in the panel.
import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { Layer, NavigationControl, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { CrashHex, MapFeatureInfo, MapLayerToggles } from '@/lib/ui/api';
import { hexFromProps, MODEL_BINS, RECORDED_BINS, ROUTE_COLORS, type CrashMode } from '@/lib/ui/format';
import { arrowIconName } from '@/lib/ui/geo';

const STYLES = [
  'https://tiles.openfreemap.org/styles/positron',
  'https://tiles.openfreemap.org/styles/liberty',
];

export type FlyTarget = { lng: number; lat: number; zoom?: number; seq: number };

export type MapViewProps = {
  stations: GeoJSON.FeatureCollection;
  route: GeoJSON.FeatureCollection;
  /** Walking legs, drawn as a dashed line. */
  walk?: GeoJSON.FeatureCollection;
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
  onSelectFeature?: (info: MapFeatureInfo) => void;
};

const NO_LAYERS: MapLayerToggles = { trains: false, fatal: false, danger: false, equity: false, ramps: false };
const RAMP_LAYERS = ['ramps-poor', 'ramps-lip', 'ramps-both'];

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turn a clicked feature of an optional layer into panel text data. */
function featureInfo(layerId: string, p: Record<string, unknown>): MapFeatureInfo | null {
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
const FEATURE_LAYER_ORDER = ['vehicles', 'fatal-points', 'danger-points', ...RAMP_LAYERS];

// Small images drawn in code (no sprite or font glyph needed): a direction arrow per line color, and a hatch for
// the environmental-justice fill so it does not rely on color alone.
function addLayerImages(map: import('maplibre-gl').Map) {
  try {
    for (const color of new Set([...Object.values(ROUTE_COLORS), '#1d4ed8'])) {
      const name = arrowIconName(color);
      if (map.hasImage(name)) continue;
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(12, 2);
      ctx.lineTo(21, 20);
      ctx.lineTo(3, 20);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fill();
      map.addImage(name, ctx.getImageData(0, 0, 24, 24), { pixelRatio: 2 });
    }
    if (!map.hasImage('lm-hatch')) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = 'rgba(13,148,136,0.10)';
      ctx.fillRect(0, 0, 16, 16);
      ctx.strokeStyle = 'rgba(15,118,110,0.55)';
      ctx.lineWidth = 2;
      for (const off of [-16, 0, 16]) {
        ctx.beginPath();
        ctx.moveTo(off, 16);
        ctx.lineTo(off + 16, 0);
        ctx.stroke();
      }
      map.addImage('lm-hatch', ctx.getImageData(0, 0, 16, 16), { pixelRatio: 2 });
    }
  } catch (err) {
    // Missing images only hide the arrows / hatching; the base map and other layers keep working.
    console.warn('Map images could not be added', err);
  }
}

// "zoom" stays at the top level of these expressions (MapLibre rejects it nested in arithmetic).
const TRAIN_RADIUS = ['interpolate', ['linear'], ['zoom'], 10, 3.5, 13, 5, 16, 7];
const POINT_RADIUS = ['interpolate', ['linear'], ['zoom'], 10, 3, 13, 4.5, 16, 7];

function stepColor(prop: unknown, bins: { min: number; color: string }[]) {
  const expr: unknown[] = ['step', prop, bins[0].color];
  for (const b of bins.slice(1)) expr.push(b.min, b.color);
  return expr;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const STATION_LAYERS = ['stations-yes', 'stations-partial', 'stations-no', 'stations-unknown'];

// One circle per intersection; it grows with zoom so dense areas stay readable zoomed out.
const CRASH_RADIUS = ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 17, 9];
// Selection ring: 4 px larger at every stop. MapLibre only allows "zoom" at the top level of interpolate,
// so ['+', CRASH_RADIUS, 4] is rejected.
const CRASH_SELECTED_RADIUS = ['interpolate', ['linear'], ['zoom'], 11, 6.5, 14, 9, 17, 13];

// MapLibre 6 looks for its worker next to its own bundle file, which the bundler renames.
// Point it at the worker emitted as a static asset instead.
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

export default function MapView(props: MapViewProps) {
  const { stations, route, walk, bikeRoute, crashMode, selectedStationId, selectedHex, flyTo, onSelectStation, onSelectHex } =
    props;
  const layers = props.layers ?? NO_LAYERS;
  const { onSelectFeature } = props;
  const mapRef = useRef<MapRef>(null);
  const [styleIdx, setStyleIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [firstSymbolId, setFirstSymbolId] = useState<string | undefined>(undefined);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) addLayerImages(map);
    const styleLayers = map?.getStyle()?.layers ?? [];
    setFirstSymbolId(styleLayers.find((l) => l.type === 'symbol')?.id);
    setLoaded(true);
  }, []);

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
      queueMicrotask(() => {
        if (styleIdx < STYLES.length - 1) setStyleIdx((i) => i + 1);
        else setFailed(true);
      });
    },
    [loaded, styleIdx],
  );

  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const opts = { center: [flyTo.lng, flyTo.lat] as [number, number], zoom: flyTo.zoom ?? 15 };
    if (reduce) mapRef.current.jumpTo(opts);
    else mapRef.current.flyTo({ ...opts, duration: 1200 });
  }, [flyTo]);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feats = e.features ?? [];
      const st = feats.find((f) => STATION_LAYERS.includes(f.layer.id));
      if (st?.properties?.id) {
        onSelectStation(String(st.properties.id));
        return;
      }
      if (onSelectFeature) {
        for (const id of FEATURE_LAYER_ORDER) {
          const f = feats.find((x) => x.layer.id === id);
          const info = f ? featureInfo(id, (f.properties ?? {}) as Record<string, unknown>) : null;
          if (info) {
            onSelectFeature(info);
            return;
          }
        }
      }
      const hex = feats.find((f) => f.layer.id === 'crash-points');
      if (hex?.properties) {
        onSelectHex(hexFromProps(hex.properties as Record<string, unknown>));
        return;
      }
      const ej = feats.find((f) => f.layer.id === 'equity-fill');
      const info = ej && onSelectFeature ? featureInfo('equity-fill', (ej.properties ?? {}) as Record<string, unknown>) : null;
      if (info) onSelectFeature?.(info);
    },
    [onSelectStation, onSelectHex, onSelectFeature],
  );

  const vis = (on: boolean) => (on ? ('visible' as const) : ('none' as const));
  const interactive = loaded
    ? [
        ...STATION_LAYERS,
        ...(layers.trains ? ['vehicles'] : []),
        ...(layers.fatal ? ['fatal-points'] : []),
        ...(layers.danger ? ['danger-points'] : []),
        ...(layers.ramps ? RAMP_LAYERS : []),
        ...(crashMode !== 'off' ? ['crash-points'] : []),
        ...(layers.equity ? ['equity-fill'] : []),
      ]
    : [];

  const crashVisible = crashMode !== 'off';
  const pointColor =
    crashMode === 'model'
      ? stepColor(['get', 'risk_yr'], MODEL_BINS)
      : stepColor(['+', ['get', 'ped'], ['get', 'bike']], RECORDED_BINS);

  return (
    <div className="relative h-full w-full">
      {failed ? (
        <div className="flex h-full items-center justify-center bg-slate-100 p-6 text-center text-slate-800">
          <p>The map could not load. Everything it shows is also in the panel.</p>
        </div>
      ) : (
        <Map
          key={styleIdx}
          ref={mapRef}
          mapStyle={STYLES[styleIdx]}
          initialViewState={{ longitude: -71.08, latitude: 42.35, zoom: 12 }}
          style={{ width: '100%', height: '100%' }}
          onLoad={onLoad}
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
                  type="circle"
                  beforeId={firstSymbolId}
                  layout={{
                    visibility: crashVisible ? 'visible' : 'none',
                    // draw the worst intersections on top
                    'circle-sort-key': crashMode === 'model' ? ['get', 'risk_yr'] : ['+', ['get', 'ped'], ['get', 'bike']],
                  }}
                  paint={{
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'circle-color': pointColor as any,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'circle-radius': CRASH_RADIUS as any,
                    'circle-opacity': 0.85,
                    'circle-stroke-color': '#7c2d12',
                    'circle-stroke-width': 0.75,
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
                  paint={{ 'line-color': '#ffffff', 'line-width': 6 }}
                />
                <Layer
                  id="lines"
                  type="line"
                  beforeId={firstSymbolId}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{ 'line-color': ['coalesce', ['get', 'color'], '#555555'], 'line-width': 3.5 }}
                />
              </Source>
              {/* Curb ramps (City of Boston): filled dot = poor condition, hollow ring = lip at the edge,
                  filled dot in a dark ring = both. From zoom 14. */}
              <Source id="ramps" type="geojson" data={(layers.ramps && props.ramps) || EMPTY_FC}>
                <Layer
                  id="ramps-lip"
                  type="circle"
                  minzoom={14}
                  filter={['==', ['get', 'condition'], 'lip at edge']}
                  layout={{ visibility: vis(layers.ramps) }}
                  paint={{
                    'circle-radius': 3.5,
                    'circle-color': '#ffffff',
                    'circle-stroke-color': '#9a3412',
                    'circle-stroke-width': 2,
                  }}
                />
                <Layer
                  id="ramps-poor"
                  type="circle"
                  minzoom={14}
                  filter={['==', ['get', 'condition'], 'poor condition']}
                  layout={{ visibility: vis(layers.ramps) }}
                  paint={{
                    'circle-radius': 4,
                    'circle-color': '#9a3412',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1,
                  }}
                />
                <Layer
                  id="ramps-both"
                  type="circle"
                  minzoom={14}
                  filter={['==', ['get', 'condition'], 'poor condition, lip at edge']}
                  layout={{ visibility: vis(layers.ramps) }}
                  paint={{
                    'circle-radius': 4.5,
                    'circle-color': '#9a3412',
                    'circle-stroke-color': '#111827',
                    'circle-stroke-width': 2,
                  }}
                />
              </Source>
              {/* Resident-reported danger spots: purple ring with a purple center dot. */}
              <Source id="danger" type="geojson" data={(layers.danger && props.danger) || EMPTY_FC}>
                <Layer
                  id="danger-points"
                  type="circle"
                  layout={{ visibility: vis(layers.danger) }}
                  paint={{
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'circle-radius': POINT_RADIUS as any,
                    'circle-color': '#ffffff',
                    'circle-stroke-color': '#7e22ce',
                    'circle-stroke-width': 2.5,
                  }}
                />
                <Layer
                  id="danger-dot"
                  type="circle"
                  layout={{ visibility: vis(layers.danger) }}
                  paint={{ 'circle-radius': 1.8, 'circle-color': '#7e22ce' }}
                />
              </Source>
              {/* Fatal crashes: black ring with a white center. */}
              <Source id="fatal" type="geojson" data={(layers.fatal && props.fatal) || EMPTY_FC}>
                <Layer
                  id="fatal-points"
                  type="circle"
                  layout={{ visibility: vis(layers.fatal) }}
                  paint={{
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'circle-radius': POINT_RADIUS as any,
                    'circle-color': '#ffffff',
                    'circle-stroke-color': '#000000',
                    'circle-stroke-width': 3,
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
                  id="vehicles"
                  type="circle"
                  layout={{ visibility: vis(layers.trains) }}
                  paint={{
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'circle-radius': TRAIN_RADIUS as any,
                    'circle-color': ['get', 'color'],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1.5,
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
                    'icon-offset': [0, -11],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  }}
                />
              </Source>
              <Source id="stations" type="geojson" data={stations}>
                {/* Shape + stroke differ by state, not just color (legend in MapKey). */}
                <Layer
                  id="stations-unknown"
                  type="circle"
                  filter={['==', ['get', 'state'], 'unknown']}
                  paint={{
                    'circle-radius': 4.5,
                    'circle-color': '#6b7280',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1.5,
                  }}
                />
                <Layer
                  id="stations-no"
                  type="circle"
                  filter={['==', ['get', 'state'], 'no']}
                  paint={{
                    'circle-radius': 6,
                    'circle-color': '#ffffff',
                    'circle-stroke-color': '#b91c1c',
                    'circle-stroke-width': 3,
                  }}
                />
                <Layer
                  id="stations-no-x"
                  type="symbol"
                  filter={['==', ['get', 'state'], 'no']}
                  layout={{
                    'text-field': '×',
                    'text-font': ['Noto Sans Bold'],
                    'text-size': 13,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                  }}
                  paint={{ 'text-color': '#b91c1c' }}
                />
                <Layer
                  id="stations-yes"
                  type="circle"
                  filter={['==', ['get', 'state'], 'yes']}
                  paint={{
                    'circle-radius': 6.5,
                    'circle-color': '#047857',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                  }}
                />
                <Layer
                  id="stations-partial"
                  type="circle"
                  filter={['==', ['get', 'state'], 'partial']}
                  paint={{
                    'circle-radius': 7,
                    'circle-color': '#047857',
                    'circle-stroke-color': '#b45309',
                    'circle-stroke-width': 3,
                  }}
                />
                <Layer
                  id="stations-partial-mark"
                  type="symbol"
                  filter={['==', ['get', 'state'], 'partial']}
                  layout={{
                    'text-field': '!',
                    'text-font': ['Noto Sans Bold'],
                    'text-size': 12,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                  }}
                  paint={{ 'text-color': '#ffffff' }}
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
            </>
          )}
        </Map>
      )}
    </div>
  );
}
