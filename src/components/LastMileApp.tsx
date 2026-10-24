'use client';
// Main screen: panel (tabs + details) and the map. All map content is also available as text in the panel.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Leg } from '@/lib/router';
import type {
  CrashHex,
  CurbRamp,
  DangerReport,
  FatalCrash,
  MapFeatureInfo,
  MapLayerToggles,
  ParkingLot,
  Station,
  StationStatusRow,
} from '@/lib/ui/api';
import type { CrashMode } from '@/lib/ui/format';
import { pointsGeojson, routeGeojson, stationsGeojson, vehiclesGeojson, walkGeojson } from '@/lib/ui/geo';
import { useStaticFile, useStations, useStationsStatus, useVehicles } from '@/lib/ui/hooks';
import { DEFAULT_CRASH_MODE, facilityTypeWord, formatClock, isPartial, routeName } from '@/lib/ui/format';
import { defaultTab, startLayers, type Profile } from '@/lib/profile';
import { useMapSkin } from '@/lib/ui/map-skins';
import { newlyBlocked, useMyStations, type StepFreeLevel } from '@/lib/ui/myStations';
import { DEMO_PLACE, formatDistance, haversineM, type Place } from '@/lib/ui/walk';
import WeatherBox from './WeatherBox';
import Account from './Account';
import BrokenNow from './BrokenNow';
import CrashSpots from './CrashSpots';
import HexDetails from './HexDetails';
import MapClient from './MapClient';
import MapKey, { DEFAULT_LAYERS } from './MapKey';
import type { FlyTarget } from './MapView';
import MyStations from './MyStations';
import ChatWidget from './ChatWidget';
import DrivePlanner from './DrivePlanner';
import StationDetails from './StationDetails';
import Tabs from './Tabs';
import TripPlanner, { type MapPickUse, type TripPlannerHandle, type TripStep, type TripSteps } from './TripPlanner';
import {
  btn,
  btnGhost,
  btnPrimary,
  card,
  iconBtn,
  mutedText,
  Notice,
  pageTitle,
  sectionTitle,
  SourceBadge,
  StarButton,
  StateIcon,
} from './ui';
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

/** Pill buttons that read well on the dark trip step card. */
const stepPill =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-[15px] font-bold transition duration-200 active:scale-[.97] disabled:pointer-events-none disabled:opacity-40';
const stepLight = `${stepPill} bg-white text-ink hover:bg-soft-2`;
const stepLine = `${stepPill} border border-white text-white hover:bg-white/10`;

/** Phone bottom-sheet heights (desktop ignores them). */
type SheetSize = 'peek' | 'half' | 'full';
const SHEET_ORDER: SheetSize[] = ['peek', 'half', 'full'];
const SHEET_H: Record<SheetSize, string> = { peek: '38dvh', half: '62dvh', full: 'calc(100dvh - 72px)' };
const sheetPx = (s: SheetSize, vh: number) => (s === 'peek' ? vh * 0.38 : s === 'half' ? vh * 0.62 : vh - 72);

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
    <section aria-label={t('Selected map item')} className="space-y-3">
      <button type="button" className={`${btnGhost} -ml-1`} onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        {t('Close')}
      </button>
      <div className={card}>
        <h2 className={`flex items-start gap-2 ${sectionTitle}`}>
          {info.kind === 'access' && <StateIcon state={info.closed ? 'no' : 'yes'} />}
          <span className="min-w-0">{title}</span>
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-bold text-muted">{k}</dt>
              <dd className="min-w-0 break-words font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {info.kind === 'access' && byId.has(info.stationId) && (
          <button type="button" className={`${btnPrimary} mt-4 w-full`} onClick={() => onSelectStation(info.stationId)}>
            {t('Open {name}', { name: byId.get(info.stationId)!.name })}
          </button>
        )}
      </div>
      <p className={mutedText}>{source}</p>
    </section>
  );
}

export default function LastMileApp({ profile }: { profile: Profile }) {
  const { stations, byId, sorted, error: stationsError } = useStations();
  const status = useStationsStatus();
  const [tab, setTab] = useState<string>(defaultTab(profile));
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedHex, setSelectedHex] = useState<CrashHex | null>(null);
  const [crashMode, setCrashMode] = useState<CrashMode>(DEFAULT_CRASH_MODE);
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [bikeRoute, setBikeRoute] = useState<GeoJSON.FeatureCollection | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [walkLines, setWalkLines] = useState<[number, number][][] | null>(null);
  const [driveLine, setDriveLine] = useState<[number, number][] | null>(null);
  /** Park & ride hands its station to the trip planner; seq makes the same station count again. */
  const [presetFrom, setPresetFrom] = useState<{ id: string; seq: number } | null>(null);
  /** Spot tapped on the map (popup open), and the start / end places of the planned trip. */
  const [pin, setPin] = useState<Place | null>(null);
  const [tripPlaces, setTripPlaces] = useState<{ start: Place | null; end: Place | null }>({ start: null, end: null });
  const planner = useRef<TripPlannerHandle>(null);
  /** Steps of the shown trip, and the step shown on the map's trip bar (null = not started). */
  const [trip, setTrip] = useState<TripSteps | null>(null);
  const [nav, setNav] = useState<{ id: number; idx: number } | null>(null);
  const mine = useMyStations();
  const [skin, setSkin] = useMapSkin();
  const [banner, setBanner] = useState<string[]>([]);
  const prevStepFree = useRef<Map<string, StepFreeLevel> | null>(null);
  /** Which detail page (station, crash spot, map item) was opened last; it is shown in the panel. */
  const [front, setFront] = useState<'station' | 'hex' | 'feature'>('station');

  // Phone bottom sheet: three snap heights, cycled by the handle or dragged with a pointer.
  const [sheet, setSheet] = useState<SheetSize>('peek');
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const h = panelRef.current?.getBoundingClientRect().height ?? 0;
    drag.current = { y: e.clientY, h, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    const vh = window.innerHeight;
    setDragH(Math.max(vh * 0.2, Math.min(vh - 72, d.h - dy)));
  };
  const onHandleUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || dragH === null) {
      setDragH(null);
      return;
    }
    dragged.current = true;
    const vh = window.innerHeight;
    const nearest = SHEET_ORDER.reduce((a, b) =>
      Math.abs(sheetPx(b, vh) - dragH) < Math.abs(sheetPx(a, vh) - dragH) ? b : a,
    );
    setSheet(nearest);
    setDragH(null);
  };
  const onHandleClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setSheet((s) => SHEET_ORDER[(SHEET_ORDER.indexOf(s) + 1) % SHEET_ORDER.length]);
  };

  // Layers popover (map style, key and layers), opened from the top bar.
  const [layersOpen, setLayersOpen] = useState(false);
  const layersId = useId();
  const layersBtn = useRef<HTMLButtonElement>(null);
  const layersPop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layersOpen) return;
    layersPop.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLayersOpen(false);
      layersBtn.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (layersPop.current?.contains(target) || layersBtn.current?.contains(target)) return;
      setLayersOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [layersOpen]);

  const live = useMemo(
    () => new Map<string, StationStatusRow>((status.data?.data.stations ?? []).map((s) => [s.id, s])),
    [status.data],
  );
  const stationsFc = useMemo(() => stationsGeojson(stations, live), [stations, live]);
  const routeFc = useMemo(() => routeGeojson(legs ?? undefined, byId), [legs, byId]);
  const walkFc = useMemo(() => walkGeojson(walkLines), [walkLines]);
  const driveFc = useMemo(() => walkGeojson(driveLine ? [driveLine] : null), [driveLine]);
  // Stable: DrivePlanner calls it from an effect. Centers the map on the route's midpoint, like the bike route.
  const showDrive = useCallback((c: [number, number][] | null) => {
    setDriveLine(c);
    const mid = c?.[Math.floor(c.length / 2)];
    if (mid) setFlyTo((f) => ({ lng: mid[0], lat: mid[1], zoom: 12, seq: (f?.seq ?? 0) + 1 }));
  }, []);
  // MBTA lots with accessible spaces, on the map while the Drive tab is open.
  const parking = useStaticFile<ParkingLot[]>('/data/parking.json', tab === 'drive');
  const parkingFc = useMemo(
    () =>
      tab === 'drive'
        ? pointsGeojson(
            (parking.data ?? []).filter(
              (l): l is ParkingLot & { lat: number; lon: number } =>
                (l.accessibleSpaces ?? 0) > 0 && l.lat !== undefined && l.lon !== undefined,
            ),
          )
        : undefined,
    [parking.data, tab],
  );

  // Optional map layers: each file / feed is fetched only once its layer is turned on.
  const [layers, setLayers] = useState<MapLayerToggles>(() => ({ ...DEFAULT_LAYERS, ...startLayers(profile) }));
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
    const v = vehicles.data?.data.filter((x) => !x.stale && x.mode !== 'bus');
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
      setFront('station');
      const s = byId.get(id);
      if (s) setFlyTo((f) => ({ lng: s.lon, lat: s.lat, zoom: 14.5, seq: (f?.seq ?? 0) + 1 }));
    },
    [byId],
  );
  const selectHexFromMap = useCallback((h: CrashHex) => {
    setSelectedHex(h);
    setFront('hex');
  }, []);
  const selectHexFromList = useCallback((h: CrashHex) => {
    setSelectedHex(h);
    setFront('hex');
    setFlyTo((f) => ({ lng: h.lng, lat: h.lat, zoom: 14.5, seq: (f?.seq ?? 0) + 1 }));
  }, []);
  const selectFeature = useCallback((f: MapFeatureInfo | null) => {
    setFeature(f);
    if (f) setFront('feature');
  }, []);
  const closeDetails = () => {
    setSelectedStationId(null);
    setSelectedHex(null);
    setFeature(null);
  };
  // Switching pages leaves any open detail page.
  const changeTab = (id: string) => {
    closeDetails();
    setTab(id);
  };

  // Tap on empty map: a pin named after the closest station, with a popup of directions choices.
  const pickPlace = useCallback(
    (p: { lat: number; lon: number } | null) => {
      if (!p) return setPin(null);
      let near: Station | undefined;
      for (const s of stations ?? []) if (!near || haversineM(p, s) < haversineM(p, near)) near = s;
      // Distance in the name, so two spots near the same station read differently.
      const label = near
        ? t('Map spot {dist} from {station}', { dist: formatDistance(haversineM(p, near)), station: near.name })
        : t('Map spot');
      setPin({ ...p, label });
    },
    [stations, t],
  );
  const choosePin = (use: MapPickUse) => {
    if (!pin) return;
    // Show the trip tab before the planner takes the spot, so it can move focus to itself.
    flushSync(() => {
      setTab('trip');
      setPin(null);
      // The trip page must be visible, not hidden behind a detail page.
      closeDetails();
    });
    planner.current?.pick(pin, use);
  };
  const onTripPlaces = useCallback((start: Place | null, end: Place | null) => setTripPlaces({ start, end }), []);

  // Step-by-step view: the trip bar on the map shows one step at a time and moves the map to it.
  const onTrip = useCallback((next: TripSteps | null) => {
    setTrip(next);
    setNav((n) => (n && next && n.id === next.id && n.idx < next.steps.length ? n : null));
  }, []);
  const showStep = (s: TripStep | undefined) => {
    if (s?.at) {
      const at = s.at;
      setFlyTo((f) => ({ lng: at.lon, lat: at.lat, zoom: 17, seq: (f?.seq ?? 0) + 1 }));
    }
  };
  const goStep = (idx: number) => {
    if (!trip?.steps[idx]) return;
    setNav({ id: trip.id, idx });
    showStep(trip.steps[idx]);
  };
  const step = trip && nav ? trip.steps[nav.idx] : undefined;

  // Toast when the same trip comes back with different stations (an elevator broke or came back).
  const [toast, setToast] = useState<string | null>(null);
  const legsSig = useMemo(
    () => (legs ? legs.map((l) => (l.kind === 'ride' ? l.stationIds.join('>') : l.kind)).join('|') : null),
    [legs],
  );
  const prevLegs = useRef<{ id?: number; sig: string | null }>({ sig: null });
  useEffect(() => {
    const p = prevLegs.current;
    if (p.sig && legsSig && trip?.id === p.id && legsSig !== p.sig) setToast(t('Elevator change: your trip was rerouted.'));
    prevLegs.current = { id: trip?.id, sig: legsSig };
  }, [legsSig, trip?.id, t]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(h);
  }, [toast]);
  const placesFc = useMemo(
    () =>
      pointsGeojson([
        ...(tripPlaces.start ? [{ ...tripPlaces.start, role: 'start' }] : []),
        ...(tripPlaces.end ? [{ ...tripPlaces.end, role: 'end' }] : []),
        ...(pin ? [{ ...pin, role: 'pin' }] : []),
      ]),
    [tripPlaces, pin],
  );
  const pinPopup = pin && (
    <div className="font-sans text-[14px] text-ink">
      <p className="font-bold leading-snug">{pin.label}</p>
      {/* Two rows only, so the popup fits in the short phone map. */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <button type="button" className={`${btnPrimary} col-span-2`} onClick={() => choosePin('from-me')}>
          {t('Directions from my location')}
        </button>
        <button type="button" className={btn} onClick={() => choosePin('start')}>
          {t('Start here')}
        </button>
        <button type="button" className={btn} onClick={() => choosePin('end')}>
          {t('End here')}
        </button>
      </div>
    </div>
  );

  const selected = selectedStationId ? byId.get(selectedStationId) : undefined;
  const blockedNow = (status.data?.data.stations ?? []).filter(
    (s) => (!s.stepFree && s.blockedBy.length > 0) || isPartial(s),
  );

  // The detail page shown in the panel: the one opened last, else any other still open.
  const detailPages = {
    station: selected && (
      <StationDetails
        station={selected}
        live={live.get(selected.id)}
        onClose={() => setSelectedStationId(null)}
        saved={mine.has(selected.id)}
        onToggleSave={() => mine.toggle(selected.id)}
      />
    ),
    hex: selectedHex && (
      <HexDetails hex={selectedHex} showModel={crashMode === 'model'} onClose={() => setSelectedHex(null)} />
    ),
    feature: feature && (
      <MapFeatureCard
        info={feature}
        byId={byId}
        onClose={() => setFeature(null)}
        onSelectStation={(id) => {
          setFeature(null);
          selectStation(id);
        }}
      />
    ),
  };
  const detailPage = detailPages[front] || detailPages.station || detailPages.hex || detailPages.feature || null;
  const tabTitle: Record<string, string> = {
    broken: t('Broken now'),
    trip: t('Plan a trip'),
    drive: t('Drive'),
    mine: t('My stations'),
    more: t('More'),
    crash: t('Crash spots'),
  };
  const shellStyle = { '--sheet-phone': dragH !== null ? `${dragH}px` : SHEET_H[sheet] } as CSSProperties;

  return (
    <div className="app-shell font-sans" style={shellStyle}>
      <header className="app-topbar">
        <div className="flex h-12 items-center gap-2 rounded-full border border-line bg-white py-1.5 pl-1.5 pr-1.5 shadow-sh2 md:pr-4">
          <span aria-hidden="true" className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-ink">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <circle cx="10.4" cy="4.2" r="1.6" fill="#fff" />
              <path
                d="M9.9 7v5h4.2l1.5 3.8M9.9 9.2h3.6M7.2 10.6a4.2 4.2 0 1 0 5.6 5"
                stroke="#fff"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className="text-[17px] font-extrabold tracking-[-0.02em] text-ink max-md:sr-only">LastMile</h1>
        </div>
        {/* Search pill, as in the mockup: opens the trip page. */}
        <button
          type="button"
          onClick={() => {
            changeTab('trip');
            setSheet((s) => (s === 'peek' ? 'half' : s));
          }}
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-line bg-white px-4 text-left text-[15px] font-bold text-muted shadow-sh2 transition duration-200 hover:-translate-y-px hover:shadow-sh3 active:scale-[.98] md:max-w-[420px]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-ink">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="truncate">{t('Where to?')}</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            ref={layersBtn}
            type="button"
            className={`${iconBtn} aria-expanded:border-ink aria-expanded:bg-ink aria-expanded:text-white`}
            aria-label={t('Map style, key and layers')}
            aria-expanded={layersOpen}
            aria-controls={layersId}
            onClick={() => setLayersOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l9 5-9 5-9-5z" />
              <path d="M3 13l9 5 9-5" />
            </svg>
          </button>
        </div>
      </header>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[76px] z-40 flex justify-center px-4 md:left-[432px]">
        {toast && (
          <p className="lm-pop flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[14px] font-bold text-white shadow-sh3">
            <span aria-hidden="true" className="size-2 rounded-full bg-t-yellow" />
            {toast}
          </p>
        )}
      </div>

      <div
        ref={layersPop}
        id={layersId}
        role="dialog"
        aria-label={t('Map style, key and layers')}
        tabIndex={-1}
        hidden={!layersOpen}
        className={`app-layers-pop rounded-card border border-line bg-white p-4 shadow-sh3 outline-none ${layersOpen ? 'lm-pop' : ''}`}
      >
        <MapKey
          mode={crashMode}
          onMode={setCrashMode}
          layers={layers}
          onLayers={setLayers}
          summary={layerSummary}
          skin={skin}
          onSkin={setSkin}
        />
      </div>

      <main
        ref={panelRef}
        className="app-panel"
        data-dragging={dragH !== null ? 'true' : undefined}
        aria-label={t('Trip tools')}
      >
        <div className="flex shrink-0 justify-center md:hidden">
          <button
            type="button"
            className="relative z-[1] -mb-4 flex h-11 w-28 cursor-grab touch-none justify-center pt-2.5 active:cursor-grabbing"
            aria-label={t('Resize panel')}
            onClick={onHandleClick}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          >
            <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-line-2" />
          </button>
        </div>
        <div className="app-scroll space-y-3">
        {!en && <p className={`${mutedText} pt-1`}>{t('MBTA alert text is shown in English.')}</p>}
        {/* Each page brings its own heading; only More needs one from the shell. */}
        {!detailPage && tab === 'more' && (
          <div className="pt-1">
            <p aria-hidden="true" className={pageTitle}>
              {tabTitle[tab] ?? ''}
            </p>
            <p className={`${mutedText} mt-0.5`}>{t('Step-free MBTA trips')}</p>
          </div>
        )}
        {stationsError && <Notice tone="error">{t('Station list could not load. Reload the page to try again.')}</Notice>}
        {status.error && !status.data && (
          <Notice>{t('Live step-free status is not available right now. Stations show their usual accessibility.')}</Notice>
        )}
        {status.data && <SourceBadge source={status.data.source} fetchedAt={status.data.fetchedAt} />}
        <div role="status" aria-live="polite">
          {banner.length > 0 && (
            <div className="lm-in rounded-card border border-bad/25 bg-bad-bg p-4 text-ink shadow-sh1">
              <p className="flex items-start gap-2 text-[15px] font-bold leading-snug">
                <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-bad text-[11px] text-white">✕</span>
                {t(
                  banner.length === 1
                    ? '{names} is no longer fully step-free (one of your saved stations).'
                    : '{names} are no longer fully step-free (your saved stations).',
                  { names: banner.map((id) => byId.get(id)?.name ?? id).join(', ') },
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {banner.map((id) => (
                  <button key={id} type="button" className={btnPrimary} onClick={() => selectStation(id)}>
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

        <Tabs
          label={t('LastMile sections')}
          active={tab}
          onChange={changeTab}
          page={detailPage}
          navClassName="app-nav"
          tabs={[
            {
              id: 'trip',
              label: t('Plan a trip'),
              content: (
                <TripPlanner
                  ref={planner}
                  stations={sorted}
                  byId={byId}
                  live={live}
                  onRoute={setLegs}
                  onWalk={setWalkLines}
                  presetFrom={presetFrom}
                  onPlaces={onTripPlaces}
                  onTrip={onTrip}
                  onStart={() => goStep(0)}
                  onSelectStation={selectStation}
                  places={profile.places}
                />
              ),
            },
            {
              id: 'broken',
              label: t('Broken now'),
              content: (
                <div className="space-y-4">
                  <BrokenNow stationsById={byId} onSelectStation={selectStation} />
                  {blockedNow.length > 0 && (
                    <section aria-labelledby="blocked-h" className={card}>
                      <h2 id="blocked-h" className={`flex items-start gap-2 ${sectionTitle}`}>
                        <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-bad text-[11px] text-white">✕</span>
                        <span>{t('Stations with step-free access blocked by broken equipment')}</span>
                      </h2>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {blockedNow.map((s) => (
                          <li key={s.id} className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => selectStation(s.id)}
                              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-[14px] font-bold transition duration-200 hover:-translate-y-px hover:shadow-sh2 active:scale-[.97] ${
                                isPartial(s) ? 'border-warn/30 bg-warn-bg text-warn' : 'border-bad/30 bg-bad-bg text-bad'
                              }`}
                            >
                              <StateIcon state={isPartial(s) ? 'partial' : 'no'} size={16} />
                              {s.name}
                              {` (${t(isPartial(s) ? 'partly step-free' : 'not step-free')})`}
                            </button>
                            <StarButton saved={mine.has(s.id)} name={s.name} onToggle={() => mine.toggle(s.id)} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              ),
            },
            {
              id: 'drive',
              label: t('Drive'),
              content: (
                <DrivePlanner
                  stations={sorted}
                  places={profile.places}
                  onDrive={showDrive}
                  onPlanTrain={(id) => {
                    setPresetFrom((p) => ({ id, seq: (p?.seq ?? 0) + 1 }));
                    setTab('trip');
                  }}
                />
              ),
            },
            {
              id: 'crash',
              label: t('Crash spots'),
              content: <CrashSpots selectedHex={selectedHex?.site ?? null} onSelectHex={selectHexFromList} />,
            },
            {
              id: 'mine',
              label: t('My stations'),
              content: (
                <MyStations ids={mine.ids} byId={byId} live={live} onSelectStation={selectStation} onToggle={mine.toggle} />
              ),
            },
            {
              id: 'more',
              label: t('More'),
              content: (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event('lastmile:open-chat'))}
                    className="flex min-h-14 w-full items-center gap-3 rounded-full border-2 border-transparent px-4 text-left shadow-sh1 transition duration-200 hover:-translate-y-px hover:shadow-sh2 active:scale-[.98]"
                    style={{
                      background:
                        'linear-gradient(#fff,#fff) padding-box, linear-gradient(90deg,#DA291C,#ED8B00,#00843D,#003DA5) border-box',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink">
                      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                    </svg>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-ink">{t('Ask LastMile')}</span>
                      <span className={mutedText}>{t('Safe-route assistant')}</span>
                    </span>
                  </button>
                  <WeatherBox point={DEMO_PLACE} label={t('in Boston')} />
                  <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                    <h2 className={sectionTitle}>{t('Language')}</h2>
                    <LanguageSwitcher />
                  </section>
                  <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                    <h2 className={sectionTitle}>{t('Account')}</h2>
                    <Account />
                  </section>
                  <footer className="pt-1 text-[12px] font-medium text-muted">
                    <p className="font-bold text-ink-2">{t('Not official MBTA information. Confirm before you travel.')}</p>
                    <p className="mt-1">© OpenStreetMap contributors · OpenFreeMap · MBTA</p>
                  </footer>
                </div>
              ),
            },
          ]}
        />
        </div>
      </main>

      <div className="app-map" role="region" aria-label={t('Map of subway stations and recorded crash intersections')}>
        <MapClient
          skin={skin}
          stations={stationsFc}
          route={routeFc}
          walk={walkFc}
          drive={driveFc}
          parking={parkingFc}
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
          onSelectFeature={selectFeature}
          onPickPlace={pickPlace}
          pin={pin}
          pinContent={pinPopup}
          places={placesFc}
        />
        {trip && (
          <section
            aria-label={t('Trip controls')}
            className="app-step lm-pop rounded-[24px] bg-ink p-4 text-[15px] text-white shadow-sh3"
          >
            {nav && step ? (
              <>
                <p className="text-[13px] font-bold uppercase tracking-[0.04em] text-white/70">
                  {t('Step {n} of {total}', { n: nav.idx + 1, total: trip.steps.length })}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-300 ease-[var(--spring)]"
                    style={{ width: `${((nav.idx + 1) / Math.max(trip.steps.length, 1)) * 100}%` }}
                  />
                </div>
                <p aria-live="polite" className="mt-2.5 text-[16px] font-bold leading-snug">
                  {step.text}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" className={stepLine} disabled={nav.idx === 0} onClick={() => goStep(nav.idx - 1)}>
                    {t('Back')}
                  </button>
                  <button
                    type="button"
                    className={stepLight}
                    disabled={nav.idx >= trip.steps.length - 1}
                    onClick={() => goStep(nav.idx + 1)}
                  >
                    {t('Next')}
                  </button>
                  <button type="button" className={stepLine} onClick={() => setNav(null)}>
                    {t('Stop')}
                  </button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={stepLight} disabled={trip.steps.length === 0} onClick={() => goStep(0)}>
                  <span aria-hidden="true">▶</span> {t('Start')}
                </button>
                <button type="button" className={stepLine} onClick={() => planner.current?.clear()}>
                  <span aria-hidden="true">✕</span> {t('Close trip')}
                </button>
              </div>
            )}
          </section>
        )}
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
