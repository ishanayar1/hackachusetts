'use client';
// MapLibre map (client only; loaded through next/dynamic with ssr:false in MapClient.tsx).
// All overlays are GeoJSON sources + layers. Everything shown here is also listed as text in the panel.
import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { Layer, NavigationControl, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { CrashHex } from '@/lib/ui/api';
import { hexFromProps, MODEL_BINS, RECORDED_BINS, type CrashMode } from '@/lib/ui/format';

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
  crashMode: CrashMode;
  selectedStationId: string | null;
  selectedHex: string | null;
  flyTo: FlyTarget | null;
  onSelectStation: (id: string) => void;
  onSelectHex: (hex: CrashHex) => void;
};

function stepColor(prop: unknown, bins: { min: number; color: string }[]) {
  const expr: unknown[] = ['step', prop, bins[0].color];
  for (const b of bins.slice(1)) expr.push(b.min, b.color);
  return expr;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const STATION_LAYERS = ['stations-yes', 'stations-partial', 'stations-no', 'stations-unknown'];

// One circle per intersection; it grows with zoom so dense areas stay readable zoomed out.
const CRASH_RADIUS = ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 17, 9];

// MapLibre 6 looks for its worker next to its own bundle file, which the bundler renames.
// Point it at the worker emitted as a static asset instead.
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

export default function MapView(props: MapViewProps) {
  const { stations, route, walk, crashMode, selectedStationId, selectedHex, flyTo, onSelectStation, onSelectHex } = props;
  const mapRef = useRef<MapRef>(null);
  const [styleIdx, setStyleIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [firstSymbolId, setFirstSymbolId] = useState<string | undefined>(undefined);

  const onLoad = useCallback(() => {
    setLoaded(true);
    const layers = mapRef.current?.getMap().getStyle()?.layers ?? [];
    setFirstSymbolId(layers.find((l) => l.type === 'symbol')?.id);
  }, []);

  const onError = useCallback(
    (e: { error?: Error }) => {
      // Only a style that never loaded triggers the fallback; tile hiccups after load are ignored.
      if (loaded) return;
      console.warn('Map style error', e.error?.message);
      if (styleIdx < STYLES.length - 1) {
        setStyleIdx((i) => i + 1);
      } else {
        setFailed(true);
      }
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
      const hex = feats.find((f) => f.layer.id === 'crash-points');
      if (hex?.properties) onSelectHex(hexFromProps(hex.properties as Record<string, unknown>));
    },
    [onSelectStation, onSelectHex],
  );

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
          interactiveLayerIds={loaded ? [...STATION_LAYERS, ...(crashVisible ? ['crash-points'] : [])] : []}
          cursor="pointer"
          attributionControl={{ compact: true }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {loaded && (
            <>
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
                    'circle-radius': ['+', CRASH_RADIUS, 4] as any,
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
