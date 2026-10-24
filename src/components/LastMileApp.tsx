'use client';
// Main screen: panel (tabs + details) and the map. All map content is also available as text in the panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Leg } from '@/lib/router';
import type {
  CrashHex,
  CurbRamp,
  DangerReport,
  FatalCrash,
  MapFeatureInfo,
  MapLayerToggles,
  Station,
  StationStatusRow,
} from '@/lib/ui/api';
import type { CrashMode } from '@/lib/ui/format';
import { pointsGeojson, routeGeojson, stationsGeojson, vehiclesGeojson, walkGeojson } from '@/lib/ui/geo';
import { useStaticFile, useStations, useStationsStatus, useVehicles } from '@/lib/ui/hooks';
import { DEFAULT_CRASH_MODE, facilityTypeWord, formatClock, isPartial, routeName } from '@/lib/ui/format';
import { useMapSkin } from '@/lib/ui/map-skins';
import { newlyBlocked, useMyStations, type StepFreeLevel } from '@/lib/ui/myStations';
import Account from './Account';
import BrokenNow from './BrokenNow';
import CrashSpots from './CrashSpots';
import HexDetails from './HexDetails';
import MapClient from './MapClient';
import MapKey, { DEFAULT_LAYERS } from './MapKey';
import type { FlyTarget } from './MapView';
import MyStations from './MyStations';
import ChatWidget from './ChatWidget';
import StationDetails from './StationDetails';
import Tabs from './Tabs';
import TripPlanner from './TripPlanner';
import { btn, Notice, SourceBadge, StarButton, StateIcon } from './ui';
import LanguageSwitcher from './LanguageSwitcher';
import { useT } from '@/lib/i18n';

const n = (x: number) => x.toLocaleString('en-US');

function countBy<T>(rows: readonly T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const TRAIN_STATUS: Record<string, string> = {
  STOPPED_AT: 'Stopped at',
  INCOMING_AT: 'Arriving at',
  IN_TRANSIT_TO: 'On the way to',
};
const FATAL_WHO: Record<string, string> = {
  pedestrian: 'a person walking (pedestrian)',
  bicyclist: 'a person on a bike',
  'motor vehicle': 'a person in a motor vehicle',
};
const REPORTER: Record<string, string> = {
  walking: 'someone walking',
  biking: 'someone biking',
  driving: 'someone driving',
  'assistive device': 'someone using an assistive device',
};
const RAMP_TEXT: Record<string, string> = {
  'poor condition': 'Poor condition',
  'lip at edge': 'Lip at the edge (a bump between the ramp and the street)',
  'poor condition, lip at edge': 'Poor condition and a lip at the edge',
};
const pct = (v: number | null) => (v === null ? 'not available' : `${v}%`);

/** Text for whatever was tapped on an optional map layer (everything on the map also exists as text here). */
function MapFeatureCard({
  info,
  byId,
  onClose,
  onSelectStation,
}: {
  info: MapFeatureInfo;
  byId: Map<string, Station>;
  onClose: () => void;
  onSelectStation: (id: string) => void;
}) {
  const t = useT();
  const tx = (s: string | undefined, fallback: string) => (s === undefined ? fallback : t(s));
  const tpct = (v: number | null) => (v === null ? t('not available') : pct(v));
  let title = '';
  let rows: [string, string][] = [];
  let source = '';
  if (info.kind === 'train') {
    title = info.headsign
      ? t('{route} train to {headsign}', { route: routeName(info.routeId), headsign: info.headsign })
      : t('{route} train', { route: routeName(info.routeId) });
    const st = info.stationId ? (byId.get(info.stationId)?.name ?? info.stationId) : null;
    rows = [
      ...(st ? ([[t(TRAIN_STATUS[info.status] ?? 'Near'), st]] as [string, string][]) : []),
      [t('Position updated'), formatClock(info.updatedAt) || info.updatedAt],
    ];
    source = t('MBTA live vehicle positions, updated every 15 s.');
  } else if (info.kind === 'fatal') {
    title = t('Fatal crash (recorded)');
    rows = [
      [t('Date'), info.date],
      [t('Person killed'), tx(FATAL_WHO[info.mode], info.mode)],
      [t('Place'), info.label],
    ];
    source = t('Boston Vision Zero fatality records, 2015 to 2026.');
  } else if (info.kind === 'danger') {
    title = t('Spot residents reported as dangerous');
    rows = [
      [t('Concern'), info.concern],
      [t('Reported'), info.date],
      [t('Reported by'), t(REPORTER[info.mode] ?? 'not stated')],
    ];
    source = t('Boston Vision Zero resident reports. Not verified crashes.');
  } else if (info.kind === 'ramp') {
    title = t('Curb ramp');
    rows = [
      [t('Condition'), tx(RAMP_TEXT[info.condition], info.condition)],
      [t('Ramp id'), info.id],
    ];
    source = t('City of Boston curb ramp inventory.');
  } else if (info.kind === 'access') {
    const door = info.type === 'ENTRANCE';
    title = info.name;
    rows = [
      [t('Type'), t(door ? 'station door' : facilityTypeWord(info.type))],
      [
        t('Status'),
        t(door ? (info.closed ? 'Not step-free' : 'Step-free') : info.closed ? 'Out of service now' : 'Working'),
      ],
      [t('Station'), byId.get(info.stationId)?.name ?? info.stationId],
      ...(info.approx ? ([[t('Position'), t('Approximate (shown at the station)')]] as [string, string][]) : []),
    ];
    source = t(door ? 'MBTA GTFS station entrances.' : 'MBTA facilities, with live elevator and escalator alerts.');
  } else {
    title = t('Environmental-justice neighborhood ({place})', { place: info.municipality || t('block group') });
    rows = [
      [t('People'), n(info.population)],
      [t('Limited English households'), tpct(info.limitedEnglishPct)],
      [t('Minority residents'), tpct(info.pctMinority)],
      [t('Median household income'), info.medianIncome === null ? t('not available') : `$${n(info.medianIncome)}`],
      [t('Criteria'), info.criteria],
    ];
    source = t('MassGIS environmental-justice block group {id}.', { id: info.geoid });
  }
  return (
    <section aria-label={t('Selected map item')} className="rounded-md border border-slate-400 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-slate-900">
          {info.kind === 'access' && <StateIcon state={info.closed ? 'no' : 'yes'} />}
          {title}
        </h2>
        <button type="button" className={btn} onClick={onClose}>
          {t('Close')}
        </button>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {info.kind === 'access' && byId.has(info.stationId) && (
        <button type="button" className={`${btn} mt-2`} onClick={() => onSelectStation(info.stationId)}>
          {t('Open {name}', { name: byId.get(info.stationId)!.name })}
        </button>
      )}
      <p className="mt-1 text-xs text-slate-700">{source}</p>
    </section>
  );
}

export default function LastMileApp() {
  const { stations, byId, sorted, error: stationsError } = useStations();
  const status = useStationsStatus();
  const [tab, setTab] = useState('broken');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedHex, setSelectedHex] = useState<CrashHex | null>(null);
  const [crashMode, setCrashMode] = useState<CrashMode>(DEFAULT_CRASH_MODE);
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [bikeRoute, setBikeRoute] = useState<GeoJSON.FeatureCollection | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [walkLines, setWalkLines] = useState<[number, number][][] | null>(null);
  const mine = useMyStations();
  const [skin, setSkin] = useMapSkin();
  const [banner, setBanner] = useState<string[]>([]);
  const prevStepFree = useRef<Map<string, StepFreeLevel> | null>(null);

  const live = useMemo(
    () => new Map<string, StationStatusRow>((status.data?.data.stations ?? []).map((s) => [s.id, s])),
    [status.data],
  );
  const stationsFc = useMemo(() => stationsGeojson(stations, live), [stations, live]);
  const routeFc = useMemo(() => routeGeojson(legs ?? undefined, byId), [legs, byId]);
  const walkFc = useMemo(() => walkGeojson(walkLines), [walkLines]);

  // Optional map layers: each file / feed is fetched only once its layer is turned on.
  const [layers, setLayers] = useState<MapLayerToggles>(DEFAULT_LAYERS);
  const [feature, setFeature] = useState<MapFeatureInfo | null>(null);
  const vehicles = useVehicles(layers.trains);
  const fatal = useStaticFile<FatalCrash[]>('/data/fatalities.json', layers.fatal);
  const danger = useStaticFile<DangerReport[]>('/data/safety-concerns.json', layers.danger);
  const ramps = useStaticFile<CurbRamp[]>('/data/ramps.json', layers.ramps);
  const equity = useStaticFile<GeoJSON.FeatureCollection>('/data/ej.geojson', layers.equity);
  const access = useStaticFile<GeoJSON.FeatureCollection>('/data/access.geojson', layers.access);
  const closedFacilityIds = status.data?.data.closedFacilityIds;
  const vehiclesFc = useMemo(() => vehiclesGeojson(vehicles.data?.data), [vehicles.data]);
  const fatalFc = useMemo(() => pointsGeojson(fatal.data), [fatal.data]);
  const dangerFc = useMemo(() => pointsGeojson(danger.data), [danger.data]);
  const rampsFc = useMemo(() => pointsGeojson(ramps.data), [ramps.data]);

  const t = useT();
  const en = t.lang === 'en';
  const layerSummary = useMemo(() => {
    const s: Partial<Record<keyof MapLayerToggles, string>> = {};
    const fail = t('Could not load this layer. Reload the page to try again.');
    const loading = t('Loading…');
    const v = vehicles.data?.data.filter((x) => !x.stale);
    const demo = vehicles.data?.source === 'demo';
    s.trains = v
      ? (en
          ? `${v.length} trains shown${demo ? ' (demo snapshot, not live)' : ''}: `
          : `${t('Trains shown: {n}', { n: v.length })}${demo ? ` (${t('demo snapshot, not live')})` : ''}. `) +
        countBy(v, (x) => routeName(x.routeId))
          .map(([k, c]) => `${k} ${c}`)
          .join(', ') +
        (vehicles.data?.fetchedAt
          ? en
            ? `. Updated ${formatClock(vehicles.data.fetchedAt)}.`
            : `. ${t('Updated {time}.', { time: formatClock(vehicles.data.fetchedAt) })}`
          : '.')
      : vehicles.error
        ? t('Live train positions are not available right now.')
        : t('Loading trains…');
    if (fatal.data) {
      const newest = [...fatal.data].sort((a, b) => b.date.localeCompare(a.date))[0];
      s.fatal =
        (en ? `${n(fatal.data.length)} recorded fatal crashes: ` : `${t('Recorded fatal crashes: {n}', { n: n(fatal.data.length) })}. `) +
        countBy(fatal.data, (x) => x.mode)
          .map(([k, c]) => `${en ? k : t(k)} ${c}`)
          .join(', ') +
        (newest
          ? en
            ? `. Most recent: ${newest.date}, ${newest.label}.`
            : `. ${t('Most recent: {date}, {place}.', { date: newest.date, place: newest.label })}`
          : '.');
    } else s.fatal = fatal.error ? fail : loading;
    if (danger.data)
      s.danger =
        (en
          ? `${n(danger.data.length)} resident reports. Most common concerns: `
          : `${t('Resident reports: {n}. Most common concerns:', { n: n(danger.data.length) })} `) +
        countBy(danger.data, (x) => x.concern)
          .slice(0, 3)
          .map(([k, c]) => `${k} (${c})`)
          .join(', ') +
        '.';
    else s.danger = danger.error ? fail : loading;
    if (equity.data) {
      const towns = countBy(equity.data.features, (f) => String(f.properties?.municipality ?? ''));
      const list = towns.map(([k, c]) => `${k} ${c}`).join(', ');
      s.equity = en
        ? `${n(equity.data.features.length)} block groups in ${towns.length} towns near subway stations: ${list}.`
        : `${t('Block groups near subway stations: {n} in {towns} towns:', { n: n(equity.data.features.length), towns: towns.length })} ${list}.`;
    } else s.equity = equity.error ? fail : loading;
    if (ramps.data) {
      const c = Object.fromEntries(countBy(ramps.data, (x) => x.condition));
      const poor = n(c['poor condition'] ?? 0);
      const lip = n(c['lip at edge'] ?? 0);
      const both = n(c['poor condition, lip at edge'] ?? 0);
      s.ramps = en
        ? `${n(ramps.data.length)} ramps: ${poor} poor condition, ${lip} lip at the edge, ${both} both.`
        : t('Ramps: {n}. Poor condition: {poor}. Lip at the edge: {lip}. Both: {both}.', { n: n(ramps.data.length), poor, lip, both });
    } else s.ramps = ramps.error ? fail : loading;
    if (access.data) {
      const closed = new Set(closedFacilityIds ?? []);
      const kit = access.data.features.filter((f) => f.properties?.kind !== 'ENTRANCE');
      const out = kit.filter((f) => closed.has(String(f.properties?.id))).length;
      s.access = t('{n} elevators, lifts and ramps ({out} out of service now) and {doors} station doors. Zoom in to see them.', {
        n: n(kit.length),
        out: n(out),
        doors: n(access.data.features.length - kit.length),
      });
    } else s.access = access.error ? fail : loading;
    return s;
  }, [t, en, vehicles.data, vehicles.error, fatal.data, fatal.error, danger.data, danger.error, equity.data, equity.error, ramps.data, ramps.error, access.data, access.error, closedFacilityIds]);

  // Banner when a saved station loses step-free access (fully or for one platform) between two refreshes.
  const statusRows = status.data?.data.stations;
  useEffect(() => {
    if (!statusRows) return;
    const now = new Map<string, StepFreeLevel>(
      statusRows.map((r) => [r.id, isPartial(r) ? 'partial' : r.stepFree]),
    );
    const changed = newlyBlocked(mine.ids, prevStepFree.current, now);
    if (changed.length) setBanner((b) => [...new Set([...b, ...changed])]);
    prevStepFree.current = now;
  }, [statusRows, mine.ids]);

  const selectStation = useCallback(
    (id: string) => {
      setSelectedStationId(id);
      const s = byId.get(id);
      if (s) setFlyTo((f) => ({ lng: s.lon, lat: s.lat, zoom: 14.5, seq: (f?.seq ?? 0) + 1 }));
    },
    [byId],
  );
  const selectHexFromMap = useCallback((h: CrashHex) => setSelectedHex(h), []);
  const selectHexFromList = useCallback((h: CrashHex) => {
    setSelectedHex(h);
    setFlyTo((f) => ({ lng: h.lng, lat: h.lat, zoom: 14.5, seq: (f?.seq ?? 0) + 1 }));
  }, []);

  const selected = selectedStationId ? byId.get(selectedStationId) : undefined;
  const blockedNow = (status.data?.data.stations ?? []).filter(
    (s) => (!s.stepFree && s.blockedBy.length > 0) || isPartial(s),
  );

  return (
    <div className="app-shell bg-slate-50 text-slate-900">
      <header className="app-header border-b border-slate-300 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="min-w-0 flex-1 basis-40">
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">LastMile</h1>
            <p className="text-sm text-slate-700">{t('Step-free MBTA trips')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Account />
          </div>
        </div>
        {!en && <p className="text-xs text-slate-700">{t('MBTA alert text is shown in English.')}</p>}
      </header>

      <main className="app-panel space-y-3 px-4 py-3" aria-label={t('Trip tools')}>
        {stationsError && <Notice tone="error">{t('Station list could not load. Reload the page to try again.')}</Notice>}
        {status.error && !status.data && (
          <Notice>{t('Live step-free status is not available right now. Stations show their usual accessibility.')}</Notice>
        )}
        {status.data && <SourceBadge source={status.data.source} fetchedAt={status.data.fetchedAt} />}
        <div role="status" aria-live="polite">
          {banner.length > 0 && (
            <div className="rounded-md border-2 border-red-800 bg-red-50 p-3 text-slate-900">
              <p className="font-bold">
                <span aria-hidden="true">✕ </span>
                {t(
                  banner.length === 1
                    ? '{names} is no longer fully step-free (one of your saved stations).'
                    : '{names} are no longer fully step-free (your saved stations).',
                  { names: banner.map((id) => byId.get(id)?.name ?? id).join(', ') },
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {banner.map((id) => (
                  <button key={id} type="button" className={btn} onClick={() => selectStation(id)}>
                    {t('See {name}', { name: byId.get(id)?.name ?? id })}
                  </button>
                ))}
                <button type="button" className={btn} onClick={() => setBanner([])}>
                  {t('Dismiss')}
                </button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <StationDetails
            station={selected}
            live={live.get(selected.id)}
            onClose={() => setSelectedStationId(null)}
            saved={mine.has(selected.id)}
            onToggleSave={() => mine.toggle(selected.id)}
          />
        )}
        {selectedHex && (
          <HexDetails hex={selectedHex} showModel={crashMode === 'model'} onClose={() => setSelectedHex(null)} />
        )}

        {feature && (
          <MapFeatureCard
            info={feature}
            byId={byId}
            onClose={() => setFeature(null)}
            onSelectStation={(id) => {
              setFeature(null);
              selectStation(id);
            }}
          />
        )}

        <MapKey
          mode={crashMode}
          onMode={setCrashMode}
          layers={layers}
          onLayers={setLayers}
          summary={layerSummary}
          skin={skin}
          onSkin={setSkin}
        />

        <Tabs
          label={t('LastMile sections')}
          active={tab}
          onChange={setTab}
          tabs={[
            {
              id: 'broken',
              label: t('Broken now'),
              content: (
                <div className="space-y-4">
                  <MyStations
                    ids={mine.ids}
                    byId={byId}
                    live={live}
                    onSelectStation={selectStation}
                    onToggle={mine.toggle}
                  />
                  {blockedNow.length > 0 && (
                    <section aria-labelledby="blocked-h" className="rounded-md border border-red-800 bg-red-50 p-3">
                      <h2 id="blocked-h" className="font-bold text-slate-900">
                        <span aria-hidden="true">✕ </span>{t('Stations with step-free access blocked by broken equipment')}
                      </h2>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {blockedNow.map((s) => (
                          <li key={s.id} className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => selectStation(s.id)}
                              className="min-h-11 rounded-md border border-red-800 bg-white px-3 text-sm font-semibold text-red-900 hover:bg-red-100"
                            >
                              {s.name}
                              {` (${t(isPartial(s) ? 'partly step-free' : 'not step-free')})`}
                            </button>
                            <StarButton saved={mine.has(s.id)} name={s.name} onToggle={() => mine.toggle(s.id)} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <BrokenNow stationsById={byId} onSelectStation={selectStation} />
                </div>
              ),
            },
            {
              id: 'trip',
              label: t('Plan a trip'),
              content: (
                <TripPlanner
                  stations={sorted}
                  byId={byId}
                  live={live}
                  onRoute={setLegs}
                  onWalk={setWalkLines}
                  onSelectStation={selectStation}
                />
              ),
            },
            {
              id: 'crash',
              label: t('Crash spots'),
              content: <CrashSpots selectedHex={selectedHex?.site ?? null} onSelectHex={selectHexFromList} />,
            },
          ]}
        />

        <footer className="border-t border-slate-300 pt-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">{t('Not official MBTA information. Confirm before you travel.')}</p>
          <p className="mt-1">© OpenStreetMap contributors · OpenFreeMap · MBTA</p>
        </footer>
      </main>

      <div className="app-map" role="region" aria-label={t('Map of subway stations and recorded crash intersections')}>
        <MapClient
          skin={skin}
          stations={stationsFc}
          route={routeFc}
          walk={walkFc}
          bikeRoute={bikeRoute}
          crashMode={crashMode}
          selectedStationId={selectedStationId}
          selectedHex={selectedHex?.site ?? null}
          flyTo={flyTo}
          onSelectStation={selectStation}
          onSelectHex={selectHexFromMap}
          layers={layers}
          vehicles={vehiclesFc}
          fatal={fatalFc}
          danger={dangerFc}
          ramps={rampsFc}
          equity={equity.data}
          access={access.data}
          closedFacilityIds={closedFacilityIds}
          onSelectFeature={setFeature}
        />
      </div>

      <ChatWidget
        onRoute={(r) => {
          if (!r) {
            setBikeRoute(null);
            return;
          }
          setBikeRoute({
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { role: 'line' }, geometry: { type: 'LineString', coordinates: r.coords } },
              { type: 'Feature', properties: { role: 'start' }, geometry: { type: 'Point', coordinates: [r.from.lng, r.from.lat] } },
              { type: 'Feature', properties: { role: 'end' }, geometry: { type: 'Point', coordinates: [r.to.lng, r.to.lat] } },
            ],
          });
          // Center the map on the route's midpoint.
          const mid = r.coords[Math.floor(r.coords.length / 2)];
          if (mid) setFlyTo((f) => ({ lng: mid[0], lat: mid[1], zoom: 13.5, seq: (f?.seq ?? 0) + 1 }));
        }}
      />
    </div>
  );
}
