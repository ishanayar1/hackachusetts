'use client';
// "Plan a trip": step-free route between two stations (optionally starting with a walk from a location),
// plus the "break an elevator" demo control. A spot tapped on the map can be the start or the end.
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { DataSource } from '@/lib/mbta/types';
import type { Leg, RideLeg, RouteFailReason, RouteOk } from '@/lib/router';
import type { Station, StationStatusRow } from '@/lib/ui/api';
import { cleanEntranceId, facilityTypeWord, legRoutesText, ROUTE_COLORS, routeName, stepFreeState } from '@/lib/ui/format';
import { useFacilities, usePlatformNames, useRoute, useWalk, type RouteQuery } from '@/lib/ui/hooks';
import {
  DEMO_DESTINATIONS,
  DEMO_PLACE,
  formatDistance,
  getMyLocation,
  haversineM,
  nearestStepFree,
  WALK_SOURCE_LABEL,
  warningLines,
  type LatLon,
  type Place,
  type WalkResult,
} from '@/lib/ui/walk';
import BluebikesBox from './BluebikesBox';
import {
  badge,
  badgeOk,
  badgeWarn,
  btn,
  btnGhost,
  btnPrimary,
  card,
  chip,
  input,
  listItem,
  mutedText,
  Notice,
  pageTitle,
  sectionTitle,
  SourceBadge,
  statNumber,
} from './ui';
import WeatherBox from './WeatherBox';
import { useT } from '@/lib/i18n';

/** Symbol plus words, so the status is never shown by symbol alone. */
const MARK = {
  yes: ['✓', 'step-free now'],
  partial: ['!', 'partly step-free now'],
  no: ['✕', 'not step-free now'],
  unknown: ['?', 'no data'],
} as const;

const FAIL_TEXT: Record<RouteFailReason, string> = {
  'origin-not-step-free': 'There is no step-free way into {o} right now.',
  'destination-not-step-free': 'There is no step-free way out at {d} right now.',
  'no-path': 'We could not find a step-free trip from {o} to {d} right now.',
  'unknown-station': 'We do not know one of these stations. Pick both from the lists.',
};

/** Optional fields newer /api/route responses carry. Absent on older ones. */
type Door = { id: string; name: string; lat: number; lon: number };
type RouteOkPlus = RouteOk & {
  closedFacilityIds: string[];
  originEntranceName?: string;
  destinationExitName?: string;
  originEntrance?: Door;
  destinationExit?: Door;
};
type RideLegPlus = RideLeg & { towards?: string; alsoRoutes?: string[] };

const hasCoords = (d: Door | undefined): d is Door => !!d && Number.isFinite(d.lat) && Number.isFinite(d.lon);
type StartMode = 'station' | 'saved' | 'here' | 'demo' | 'map';
type EndMode = 'station' | 'place' | 'map';

const START_CHOICES: [StartMode, string][] = [
  ['station', 'A station'],
  ['saved', 'One of my places'],
  ['here', 'My location'],
  ['demo', "Pretend I'm at Park Street (demo)"],
  ['map', 'A spot on the map'],
];
const END_CHOICES: [EndMode, string][] = [
  ['station', 'A station'],
  ['place', 'A place'],
  ['map', 'A spot on the map'],
];

const mins = (m: number) => Math.max(1, Math.round(m));

/* Local class strings built on the shared ui.tsx tokens. */
const labelCls = 'block text-[14px] font-bold text-ink';
const selectCls = `${input} mt-1.5 cursor-pointer`;
/** "Where to?" field: the destination select, a little larger and bolder. */
const whereCls = `${input} mt-1.5 min-h-14 cursor-pointer rounded-[18px] text-[17px] font-bold`;
/** A radio label drawn as a chip; the checked radio turns it dark like chip's aria-pressed state. */
const choiceChip = `${chip} cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-t-blue/30`;
const liveNote = 'mt-2 text-[13px] font-medium leading-snug text-ink-2';
/** Full-width tappable row that may wrap to two lines. */
const rowBtn =
  'flex min-h-11 w-full items-center gap-3 rounded-[18px] border border-line bg-white px-3.5 py-2.5 text-left text-[14px] font-bold text-ink shadow-sh1 transition duration-200 hover:-translate-y-px hover:shadow-sh2 active:scale-[.97]';
const linkBtn = 'min-h-11 font-bold text-t-blue underline underline-offset-2 hover:text-ink';

/** Loading placeholder: shimmer blocks (decorative; the text beside it is what is announced). */
function Shimmer({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="mt-2 space-y-2">
      <div className="lm-shimmer h-16 rounded-[18px]" />
      {Array.from({ length: rows - 1 }, (_, i) => (
        <div key={i} className="lm-shimmer h-10 rounded-[18px]" />
      ))}
    </div>
  );
}

/** One stop of the vertical trip timeline: a 30px colored circle with a 2px connector to the next one. */
function TimelineStep({
  color,
  glyph,
  last,
  children,
}: {
  color: string;
  glyph: React.ReactNode;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={`relative flex gap-3 ${last ? '' : 'pb-4'}`}>
      {!last && <span aria-hidden="true" className="absolute bottom-0.5 left-[14px] top-[34px] w-0.5 rounded-full bg-line" />}
      <span
        aria-hidden="true"
        className="relative z-[1] grid size-[30px] shrink-0 place-items-center rounded-full text-[12px] font-extrabold text-white shadow-sh1 [&_svg]:size-4"
        style={{ background: color }}
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </li>
  );
}

const DoorIcon = ({ out }: { out?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    {out ? <path d="M14 6l6 6-6 6M20 12H8M4 4v16" /> : <path d="M10 6l6 6-6 6M16 12H4M20 4v16" />}
  </svg>
);

/** What a spot tapped on the map is used for. 'from-me' = the end, starting from the rider's location. */
export type MapPickUse = 'start' | 'end' | 'from-me';
export type TripPlannerHandle = { pick: (p: Place, use: MapPickUse) => void; clear: () => void };

/** One instruction of the shown trip, with where it happens (null = no position known). */
export type TripStep = { text: string; at: LatLon | null };
/** The shown trip's steps; id changes every time a trip is planned. */
export type TripSteps = { id: number; steps: TripStep[] };

const walkSteps = (w: WalkResult | undefined): TripStep[] =>
  (w?.steps ?? []).map((s) => ({
    text: s.distanceM >= 5 ? `${s.instruction} (${formatDistance(s.distanceM)})` : s.instruction, // no "(0 m)"
    at: s.lat !== undefined && s.lon !== undefined ? { lat: s.lat, lon: s.lon } : null,
  }));
const pointOf = (p: LatLon | undefined): LatLon | null => (p ? { lat: p.lat, lon: p.lon } : null);

/** The trip form's choices. */
type Form = {
  startMode: StartMode;
  place: Place | null;
  from: string;
  endMode: EndMode;
  destPlace: Place | null;
  to: string;
};

const startOf = (f: Form) => (f.startMode === 'station' ? null : f.place);
const endOf = (f: Form) => (f.endMode === 'station' ? null : f.destPlace);
/** Both ends are places that use the same station: the trip is a walk. */
const isWalkOnly = (f: Form) => !!startOf(f) && !!endOf(f) && f.from === f.to;

/** Why the trip cannot be planned yet (English text), or '' when it can. */
function formProblem(f: Form): string {
  if (f.startMode === 'map' && !f.place) return 'Tap a spot on the map, then choose Start here.';
  if (f.startMode !== 'station' && !f.place)
    return 'Your start location is not set yet. Try your location again or pick another start.';
  if (f.endMode === 'map' && !f.destPlace) return 'Tap a spot on the map, then choose End here.';
  if (f.endMode === 'place' && !f.destPlace) return 'Choose the place you are going to.';
  if (isWalkOnly(f)) return '';
  if (!f.from || !f.to) return 'Choose both a start and a destination station.';
  if (f.from === f.to) return 'Start and destination are the same station.';
  return '';
}

type Props = {
  stations: Station[];
  byId: Map<string, Station>;
  live: Map<string, StationStatusRow>;
  onRoute: (legs: Leg[] | null) => void;
  /** Walking lines ([lon, lat] lists) to draw dashed on the map, or null. */
  onWalk?: (lines: [number, number][][] | null) => void;
  /** Start and end places of the shown trip (null = a station or no trip), for map markers. */
  onPlaces?: (start: Place | null, end: Place | null) => void;
  /** Steps of the shown trip for the step-by-step view, or null when no trip is shown. */
  onTrip?: (trip: TripSteps | null) => void;
  /** Start the step-by-step view (the map's trip bar). */
  onStart?: () => void;
  onSelectStation: (id: string) => void;
  /** Saved places from the profile (Home, Work, ...), offered as start and destination. */
  places?: Place[];
  /** Start station handed over by park & ride (seq changes on every hand-over). */
  presetFrom?: { id: string; seq: number } | null;
  ref?: Ref<TripPlannerHandle>;
};

export default function TripPlanner({
  stations,
  byId,
  live,
  onRoute,
  onWalk,
  onPlaces,
  onTrip,
  onStart,
  onSelectStation,
  places = [],
  presetFrom,
  ref,
}: Props) {
  const ids = useId();
  const t = useT();
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Counts planned trips, so the step-by-step view knows when the trip changed. */
  const [tripId, setTripId] = useState(0);
  /** The form folds away under the results once a trip is shown. */
  const [editOpen, setEditOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState<RouteQuery | null>(null);
  const [formError, setFormError] = useState('');
  const [startMode, setStartMode] = useState<StartMode>('station');
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  /** Start place frozen when the trip was planned, so changing the radio does not change a shown trip. */
  const [walkPlace, setWalkPlace] = useState<Place | null>(null);
  const [endMode, setEndMode] = useState<EndMode>('station');
  const [destPlace, setDestPlace] = useState<Place | null>(null);
  /** Destination place frozen when the trip was planned. */
  const [destWalkPlace, setDestWalkPlace] = useState<Place | null>(null);
  /** Last spots tapped on the map for the start and the end. */
  const [mapStart, setMapStart] = useState<Place | null>(null);
  const [mapEnd, setMapEnd] = useState<Place | null>(null);
  /** A walk-only trip (both places use the same station), or null. */
  const [direct, setDirect] = useState<{ from: Place; to: Place } | null>(null);
  const { data, error, isLoading, isValidating } = useRoute(query);
  // keepPreviousData still returns the last route after the query is cleared (walk-only trip), so gate on query.
  const route = query ? data?.data : undefined;
  const ok = route?.ok ? (route as RouteOkPlus) : null;

  const boardStation = query && walkPlace ? byId.get(query.from) : undefined;
  // Walk to the step-free entrance the route chose; wait for the route so the walk does not go to the
  // station centre first. Falls back to the station centre when there is no entrance position.
  const routeSettled = !isValidating && (!!data || !!error);
  const entrance = hasCoords(ok?.originEntrance) ? ok?.originEntrance : undefined;
  const walkTo =
    boardStation && routeSettled
      ? entrance
        ? { lat: entrance.lat, lon: entrance.lon }
        : { lat: boardStation.lat, lon: boardStation.lon }
      : null;
  const walk = useWalk(walkPlace, walkTo);
  const walkData = boardStation ? walk.data?.data : undefined;

  // Second walk: from the step-free exit the route chose (or the station centre) to the destination place.
  const exitStation = query && destWalkPlace ? byId.get(query.to) : undefined;
  const exitDoor = hasCoords(ok?.destinationExit) ? ok?.destinationExit : undefined;
  const walkFrom: LatLon | null =
    exitStation && routeSettled && ok
      ? exitDoor
        ? { lat: exitDoor.lat, lon: exitDoor.lon }
        : { lat: exitStation.lat, lon: exitStation.lon }
      : null;
  const walk2 = useWalk(walkFrom, walkFrom ? destWalkPlace : null);
  const walk2Data = exitStation && walkFrom ? walk2.data?.data : undefined;

  const directWalk = useWalk(direct?.from ?? null, direct?.to ?? null);
  const directData = direct ? directWalk.data?.data : undefined;

  useEffect(() => {
    onRoute(ok ? ok.legs : null);
  }, [ok, onRoute]);

  useEffect(() => {
    const lines = [walkData?.coordinates, walk2Data?.coordinates, directData?.coordinates].filter(
      (c): c is [number, number][] => !!c && c.length > 1,
    );
    onWalk?.(lines.length ? lines : null);
  }, [walkData, walk2Data, directData, onWalk]);

  // Markers: the planned trip's places, or the places chosen in the form before a trip is planned.
  const tripStart = direct ? direct.from : query ? walkPlace : startMode === 'station' ? null : place;
  const tripEnd = direct ? direct.to : query ? destWalkPlace : endMode === 'station' ? null : destPlace;
  useEffect(() => {
    onPlaces?.(tripStart, tripEnd);
  }, [tripStart, tripEnd, onPlaces]);

  // Park & ride: the car is parked at this station, so the trip starts there. Adjusting state while
  // rendering (not in an effect) when the hand-over changes, as React recommends.
  const [presetSeen, setPresetSeen] = useState(presetFrom?.seq);
  if (presetFrom && presetFrom.seq !== presetSeen) {
    setPresetSeen(presetFrom.seq);
    setStartMode('station');
    setPlace(null);
    setFrom(presetFrom.id);
  }

  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const routeText = useRouteText(ok, nameOf);

  // Every instruction of the shown trip, in order, for the step-by-step view on the map.
  let steps: TripStep[] | null = null;
  if (direct) steps = walkSteps(directData);
  else if (query && ok) {
    steps = [
      ...walkSteps(walkData),
      {
        text: `${t('Enter by:')} ${routeText.doorName(ok.originEntranceId, ok.originEntranceName ?? ok.originEntrance?.name, 'entrance')} ${t('at')} ${nameOf(query.from)}`,
        at: pointOf(entrance ?? byId.get(query.from)),
      },
      ...ok.legs.map((leg) => ({
        text: routeText.legText(leg),
        at: pointOf(byId.get(leg.kind === 'ride' ? leg.fromStation : leg.stationId)),
      })),
      {
        text: `${t('Exit by:')} ${routeText.doorName(ok.destinationExitId, ok.destinationExitName ?? ok.destinationExit?.name, 'exit')} ${t('at')} ${nameOf(query.to)}`,
        at: pointOf(exitDoor ?? byId.get(query.to)),
      },
      ...walkSteps(walk2Data),
    ];
  }
  // Compared as text so a re-render with the same steps does not report a new trip.
  const tripJson = query || direct ? JSON.stringify({ id: tripId, steps: steps ?? [] }) : null;
  useEffect(() => {
    onTrip?.(tripJson ? (JSON.parse(tripJson) as TripSteps) : null);
  }, [tripJson, onTrip]);

  const setStartPlace = (p: Place) => {
    setPlace(p);
    const near = nearestStepFree(p, stations, live);
    if (near) setFrom(near.id);
  };

  /** Your location as the start; null (with locError set) when the browser gives none. */
  const locate = async (): Promise<Place | null> => {
    setLocating(true);
    setLocError('');
    try {
      const p = await getMyLocation();
      setStartPlace(p);
      return p;
    } catch (e) {
      setPlace(null);
      setLocError(e instanceof Error ? e.message : 'We could not get your location.');
      return null;
    } finally {
      setLocating(false);
    }
  };

  const chooseStart = (m: StartMode) => {
    setStartMode(m);
    setLocError('');
    if (m === 'station' || m === 'saved') setPlace(null);
    else if (m === 'demo') setStartPlace(DEMO_PLACE);
    else if (m === 'map') {
      if (mapStart) setStartPlace(mapStart);
      else setPlace(null);
    } else {
      setPlace(null);
      void locate();
    }
  };

  const chooseEnd = (m: EndMode) => {
    setEndMode(m);
    setDestPlace(m === 'map' ? mapEnd : null);
    const near = m === 'map' && mapEnd ? nearestStepFree(mapEnd, stations, live) : null;
    if (near) setTo(near.id);
  };

  const chooseDestPlace = (label: string) => {
    const p = [...places, ...DEMO_DESTINATIONS].find((d) => d.label === label) ?? null;
    setDestPlace(p);
    if (p) {
      const near = nearestStepFree(p, stations, live);
      if (near) setTo(near.id);
    }
  };

  const plan = (f: Form) => {
    const problem = formProblem(f);
    if (problem) return setFormError(t(problem));
    setFormError('');
    setTripId((n) => n + 1);
    setEditOpen(false);
    headingRef.current?.focus(); // results show right under the heading
    if (isWalkOnly(f)) {
      setQuery(null);
      setWalkPlace(null);
      setDestWalkPlace(null);
      setDirect({ from: startOf(f) as Place, to: endOf(f) as Place });
      return;
    }
    setDirect(null);
    setWalkPlace(startOf(f));
    setDestWalkPlace(endOf(f));
    setQuery({ from: f.from, to: f.to, closed: [] });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    plan({ startMode, place, from, endMode, destPlace, to });
  };

  // Called by the map popup (the app switches to this tab first). Plans as soon as both ends are known.
  const pick = async (p: Place, use: MapPickUse) => {
    headingRef.current?.focus();
    setLocError('');
    setFormError('');
    const nearId = nearestStepFree(p, stations, live)?.id;
    let f: Form = { startMode, place, from, endMode, destPlace, to };
    if (use === 'start') {
      setMapStart(p);
      f = { ...f, startMode: 'map', place: p, from: nearId ?? f.from };
    } else {
      setMapEnd(p);
      f = { ...f, endMode: 'map', destPlace: p, to: nearId ?? f.to };
    }
    if (use === 'from-me') f = { ...f, startMode: 'here', place: null };
    setStartMode(f.startMode);
    setPlace(f.place);
    setFrom(f.from);
    setEndMode(f.endMode);
    setDestPlace(f.destPlace);
    setTo(f.to);
    if (use === 'from-me') {
      const me = await locate();
      if (me) plan({ ...f, place: me, from: nearestStepFree(me, stations, live)?.id ?? f.from });
    } else if (!formProblem(f)) plan(f);
  };

  /** Close the trip: clear the results, the map lines and markers, and the form. */
  const clear = () => {
    setQuery(null);
    setDirect(null);
    setWalkPlace(null);
    setDestWalkPlace(null);
    setStartMode('station');
    setPlace(null);
    setFrom('');
    setEndMode('station');
    setDestPlace(null);
    setTo('');
    setFormError('');
    setLocError('');
    setEditOpen(false);
  };
  useImperativeHandle(ref, () => ({ pick: (p, use) => void pick(p, use), clear }));
  const hasTrip = !!query || !!direct;

  // Quick pick (mockup "Where to?" list): one tap plans a trip. Keeps a start you already chose, else Park Street.
  const keepStart = startMode === 'station' ? !!from : !!place;
  const startName = keepStart
    ? (place?.label ?? stations.find((s) => s.id === from)?.name ?? '')
    : DEMO_PLACE.label;
  const quickTrip = (p: Place) => {
    const start: Pick<Form, 'startMode' | 'place' | 'from'> = keepStart
      ? { startMode, place, from }
      : { startMode: 'demo', place: DEMO_PLACE, from: nearestStepFree(DEMO_PLACE, stations, live)?.id ?? '' };
    const f: Form = { ...start, endMode: 'place', destPlace: p, to: nearestStepFree(p, stations, live)?.id ?? '' };
    setStartMode(f.startMode);
    setPlace(f.place);
    setFrom(f.from);
    setEndMode('place');
    setDestPlace(p);
    setTo(f.to);
    plan(f);
  };
  const quickPlaces = [...places, ...DEMO_DESTINATIONS].slice(0, 5);

  const options = stations.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name} — {MARK[stepFreeState(s, live.get(s.id))][0]} {t(MARK[stepFreeState(s, live.get(s.id))][1])}
    </option>
  ));

  const formEl = (
    <form onSubmit={submit} className="mt-3 space-y-4">
      <fieldset>
        <legend className={labelCls}>{t('Start from')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {START_CHOICES.filter(([m]) => m !== 'saved' || places.length > 0).map(([m, label]) => (
            <label key={m} className={choiceChip}>
              <input
                type="radio"
                name={`${ids}-start`}
                value={m}
                checked={startMode === m}
                onChange={() => chooseStart(m)}
                className="sr-only"
              />
              {t(label)}
            </label>
          ))}
        </div>
        {startMode === 'saved' && (
          <div className="mt-3">
            <label htmlFor={`${ids}-saved`} className={labelCls}>
              {t('Start at')}
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {places.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={chip}
                  aria-pressed={place?.label === p.label}
                  onClick={() => setStartPlace(p)}
                >
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-t-blue" />
                  {p.label}
                </button>
              ))}
            </div>
            <select
              id={`${ids}-saved`}
              value={place?.label ?? ''}
              onChange={(e) => {
                const p = places.find((x) => x.label === e.target.value);
                if (p) setStartPlace(p);
                else setPlace(null);
              }}
              className={selectCls}
            >
              <option value="">{t('Choose a place')}</option>
              {places.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div aria-live="polite" className={liveNote}>
          {startMode === 'here' && locating && (
            <>
              <p>{t('Finding your location…')}</p>
              <div aria-hidden="true" className="lm-shimmer mt-2 h-11 rounded-2xl" />
            </>
          )}
          {startMode === 'map' && !place && <p>{t('Tap a spot on the map, then choose Start here.')}</p>}
          {startMode === 'map' && place && (
            <p>
              {t('Starting at {place}. We picked the closest step-free station; you can change it below.', {
                place: place.label,
              })}
            </p>
          )}
          {(startMode === 'here' || startMode === 'demo') && place && !locating && (
            <p>
              {t(
                'Starting at {place}. Your location stays on this device and is only used to plan the walk. We picked the closest step-free station; you can change it below.',
                { place: place.label },
              )}
            </p>
          )}
        </div>
        {locError && (
          <div className="mt-2 space-y-2">
            <Notice tone="error">{locError}</Notice>
            <button type="button" className={btn} onClick={() => void locate()}>
              {t('Try my location again')}
            </button>
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor={`${ids}-from`} className={`${labelCls} flex items-center gap-2.5`}>
          <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full bg-t-blue shadow-[0_0_0_4px_rgba(0,61,165,.18)]" />
          {t(startMode === 'station' ? 'From station' : 'Walk to station (where you board)')}
        </label>
        <select
          id={`${ids}-from`}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={selectCls}
        >
          <option value="">{t('Choose a station')}</option>
          {options}
        </select>
      </div>
      <fieldset>
        <legend className={labelCls}>{t('Destination')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {END_CHOICES.map(([m, label]) => (
            <label key={m} className={choiceChip}>
              <input
                type="radio"
                name={`${ids}-end`}
                value={m}
                checked={endMode === m}
                onChange={() => chooseEnd(m)}
                className="sr-only"
              />
              {t(label)}
            </label>
          ))}
        </div>
        {endMode === 'map' && (
          <p aria-live="polite" className={liveNote}>
            {destPlace
              ? t('We picked the closest step-free station to {place}; you can change it below.', { place: destPlace.label })
              : t('Tap a spot on the map, then choose End here.')}
          </p>
        )}
        {endMode === 'place' && (
          <div className="mt-3">
            <label htmlFor={`${ids}-place`} className={labelCls}>
              {t('Place')}
            </label>
            {places.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {places.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={chip}
                    aria-pressed={destPlace?.label === p.label}
                    onClick={() => chooseDestPlace(p.label)}
                  >
                    <span aria-hidden="true" className="size-2.5 rounded-full bg-t-red" />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <select
              id={`${ids}-place`}
              value={destPlace?.label ?? ''}
              onChange={(e) => chooseDestPlace(e.target.value)}
              className={selectCls}
            >
              <option value="">{t('Choose a place')}</option>
              {places.length > 0 && (
                <optgroup label={t('Your places')}>
                  {places.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={t('Examples')}>
                {DEMO_DESTINATIONS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {destPlace && (
              <p aria-live="polite" className={liveNote}>
                {t('We picked the closest step-free station to {place}; you can change it below.', { place: destPlace.label })}
              </p>
            )}
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor={`${ids}-to`} className={`${labelCls} flex items-center gap-2.5`}>
          <span aria-hidden="true" className="size-3.5 shrink-0 rounded-[4px] bg-ink" />
          {t(endMode === 'station' ? 'To station' : 'Leave the train at (station)')}
        </label>
        <select
          id={`${ids}-to`}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={whereCls}
        >
          <option value="">{t('Choose a station')}</option>
          {options}
        </select>
      </div>
      <button type="submit" className={`${btnPrimary} min-h-12 w-full`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
        {t('Find step-free route')}
      </button>
      {formError && <Notice tone="error">{formError}</Notice>}
    </form>
  );

  return (
    <section aria-labelledby="trip-h">
      <h2 id="trip-h" ref={headingRef} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {t('Plan a step-free trip')}
      </h2>
      {hasTrip && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className={btnPrimary} disabled={!steps?.length} onClick={onStart}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
            </svg>
            {t('Start')}
          </button>
          <button type="button" className={btnGhost} onClick={clear}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            {t('Close trip')}
          </button>
        </div>
      )}

      <div aria-live="polite" className="mt-3">
        {query && (isLoading || isValidating) && (
          <>
            <p className={mutedText}>{t('Planning your trip…')}</p>
            {isLoading && <Shimmer rows={3} />}
          </>
        )}
        {query && error && <Notice tone="error">{t('Route planning is not available right now. Try again in a minute.')}</Notice>}
      </div>

      {direct && (
        <>
          <p className={liveNote}>{t('Both places use the same station, so this trip is a walk.')}</p>
          <WalkDetails
            id="walk-only-h"
            heading={t('Walk there')}
            fromText={direct.from.label}
            toText={direct.to.label}
            failText={t('Walking directions are not available right now. {place} is about {dist} away in a straight line.', {
              place: direct.to.label,
              dist: formatDistance(haversineM(direct.from, direct.to)),
            })}
            start={direct.from}
            showBikes
            walk={directData}
            loading={directWalk.isLoading && !directData}
            failed={!!directWalk.error && !directData}
            source={directWalk.data?.source}
            fetchedAt={directWalk.data?.fetchedAt}
          />
        </>
      )}

      {query && walkPlace && boardStation && (
        <WalkDetails
          id="walk-to-h"
          heading={t('Walk to the station')}
          fromText={walkPlace.label}
          toText={
            entrance
              ? t('{door} at {station}', {
                  door: entrance.name || ok?.originEntranceName || t('the step-free entrance'),
                  station: boardStation.name,
                })
              : boardStation.name
          }
          centreNote={
            entrance ? undefined : t('The walk ends at the middle of the station; look for its step-free entrance there.')
          }
          failText={t(
            'Walking directions are not available right now. Head to {station} and look for the accessible entrance.',
            { station: boardStation.name },
          )}
          start={walkPlace}
          showBikes
          walk={walkData}
          loading={walk.isLoading || (!routeSettled && !walkData)}
          failed={!!walk.error && !walkData}
          source={walk.data?.source}
          fetchedAt={walk.data?.fetchedAt}
        />
      )}

      {query && ok && !walkPlace && byId.get(query.from) && (
        <section aria-labelledby="start-h" className={`${card} lm-in mt-3 text-ink`}>
          <h3 id="start-h" className={sectionTitle}>
            {t('At {station}', { station: nameOf(query.from) })}
          </h3>
          <WeatherBox
            point={entrance ? { lat: entrance.lat, lon: entrance.lon } : (byId.get(query.from) as Station)}
            label={t('at {station}', { station: nameOf(query.from) })}
          />
          <BluebikesBox
            point={entrance ? { lat: entrance.lat, lon: entrance.lon } : (byId.get(query.from) as Station)}
            label={t('near {station}', { station: nameOf(query.from) })}
          />
        </section>
      )}

      {query && route && !route.ok && (
        <div className="lm-in mt-3 space-y-2">
          <Notice tone="error">{t(FAIL_TEXT[route.reason], { o: nameOf(query.from), d: nameOf(query.to) })}</Notice>
          {route.alternatives.length > 0 && (
            <>
              <p className={`${labelCls} pt-1`}>{t('Nearby stations that are step-free now:')}</p>
              <ul className="space-y-2">
                {route.alternatives.map((a) => {
                  const useAsOrigin = route.reason === 'origin-not-step-free';
                  return (
                    <li key={a.stationId}>
                      <button
                        type="button"
                        className={rowBtn}
                        onClick={() => {
                          const next = useAsOrigin
                            ? { ...query, from: a.stationId }
                            : { ...query, to: a.stationId };
                          if (useAsOrigin) setFrom(a.stationId);
                          else setTo(a.stationId);
                          setQuery(next);
                        }}
                      >
                        <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_var(--ok-bg)]" />
                        <span className="min-w-0 flex-1">
                          {t(useAsOrigin ? 'Start from {name} instead ({km} km away)' : 'Go to {name} instead ({km} km away)', {
                            name: nameOf(a.stationId),
                            km: a.distanceKm,
                          })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {query.closed.length > 0 && (
            <button type="button" className={btnGhost} onClick={() => setQuery({ ...query, closed: [] })}>
              {t('Reset pretend-broken elevators')}
            </button>
          )}
        </div>
      )}

      {query && ok && (
        <RouteDetails
          route={ok}
          query={query}
          nameOf={nameOf}
          source={data?.source}
          fetchedAt={data?.fetchedAt}
          onBreak={(id) => setQuery({ ...query, closed: [...query.closed, id] })}
          onReset={() => setQuery({ ...query, closed: [] })}
          onSelectStation={onSelectStation}
        />
      )}

      {query && ok && destWalkPlace && exitStation && (
        <WalkDetails
          id="walk-from-h"
          heading={t('Walk from the station')}
          fromText={
            exitDoor
              ? t('{door} at {station}', {
                  door: exitDoor.name || ok.destinationExitName || t('the step-free exit'),
                  station: exitStation.name,
                })
              : exitStation.name
          }
          toText={destWalkPlace.label}
          centreNote={exitDoor ? undefined : t('The walk starts at the middle of the station; leave by its step-free exit.')}
          failText={t(
            'Walking directions are not available right now. {place} is about {dist} from {station} in a straight line.',
            {
              place: destWalkPlace.label,
              dist: formatDistance(haversineM(exitStation, destWalkPlace)),
              station: exitStation.name,
            },
          )}
          start={walkFrom}
          walk={walk2Data}
          loading={walk2.isLoading || (!routeSettled && !walk2Data)}
          failed={!!walk2.error && !walk2Data}
          source={walk2.data?.source}
          fetchedAt={walk2.data?.fetchedAt}
        />
      )}

      {!hasTrip && quickPlaces.length > 0 && (
        <div className="lm-in mt-3 space-y-2">
          <p className="flex items-center gap-2.5 px-1 text-[14px] font-bold text-ink-2">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-t-blue shadow-[0_0_0_4px_rgba(0,61,165,0.18)]" />
            {t('From {place}', { place: startName })}
          </p>
          <ul className="space-y-1.5">
            {quickPlaces.map((p) => (
              <li key={p.label}>
                <button type="button" onClick={() => quickTrip(p)} className={`${listItem} items-center`}>
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-soft-2 text-ink">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
                      <circle cx="12" cy="9.5" r="2.5" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink">{p.label}</span>
                    <span className={mutedText}>{t('Plan a step-free trip')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasTrip || quickPlaces.length > 0 ? (
        <details
          open={editOpen || (!hasTrip && !!formError)}
          onToggle={(e) => setEditOpen(e.currentTarget.open)}
          className="group mt-3 rounded-card border border-line bg-white shadow-sh1 transition duration-200 open:shadow-sh2"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-card px-4 text-[15px] font-bold text-ink outline-none transition hover:bg-soft focus-visible:ring-4 focus-visible:ring-t-blue/30 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-soft text-ink-2 [&_svg]:size-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3" />
              </svg>
            </span>
            <span className="flex-1">{t('Change start or destination')}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[18px] shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <div className="border-t border-line px-4 pb-4">{formEl}</div>
        </details>
      ) : (
        formEl
      )}
    </section>
  );
}

function WalkDetails({
  id,
  heading,
  fromText,
  toText,
  centreNote,
  failText,
  start,
  showBikes,
  walk,
  loading,
  failed,
  source,
  fetchedAt,
}: {
  id: string;
  heading: string;
  fromText: string;
  toText: string;
  /** Shown when the walk starts or ends at the station centre instead of a door. */
  centreNote?: string;
  failText: string;
  /** Walk start point, for the weather (and Bluebikes when showBikes). */
  start: LatLon | null;
  showBikes?: boolean;
  walk: WalkResult | undefined;
  loading: boolean;
  failed: boolean;
  source?: DataSource;
  fetchedAt?: string;
}) {
  const t = useT();
  const warnings = warningLines(walk?.warnings).map((w) => t(w));
  return (
    <section aria-labelledby={id} className={`${card} lm-in mt-3 text-ink`}>
      <h3 id={id} className={`${sectionTitle} flex items-center gap-2.5`}>
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft text-ink [&_svg]:size-5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13" cy="4.5" r="1.8" />
            <path d="M10 21l2-6 3 3v3M12 15l-1-5 4-1 2 4 2 1M11 10l-3 2-1 3" />
          </svg>
        </span>
        {heading}
      </h3>
      <div aria-live="polite">
        {loading && !walk && (
          <>
            <p className={`${mutedText} mt-2`}>{t('Finding a walking route…')}</p>
            <Shimmer rows={2} />
          </>
        )}
        {failed && (
          <div className="mt-2">
            <Notice tone="error">{failText}</Notice>
          </div>
        )}
      </div>
      {walk && (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span aria-hidden="true" className={statNumber}>
              {mins(walk.minutes)}
            </span>
            <span aria-hidden="true" className="text-[15px] font-bold text-muted">
              {t('min')} · {formatDistance(walk.distanceM)}
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-snug text-ink-2">
            {t('From {from} to {to}:', { from: fromText, to: toText })}{' '}
            <strong className="text-ink">{t('about {n} min', { n: mins(walk.minutes) })}</strong> ({formatDistance(walk.distanceM)}).
          </p>
          {centreNote && <p className={`${mutedText} mt-1`}>{centreNote}</p>}
          <p className={`${mutedText} mt-1`}>
            <span aria-hidden="true" className={walk.source === 'valhalla' ? 'text-ok' : 'text-warn'}>
              {walk.source === 'valhalla' ? '♿ ' : '⚠ '}
            </span>
            {t(WALK_SOURCE_LABEL[walk.source] ?? walk.source)}
            {walk.approximate && walk.source === 'valhalla' ? `, ${t('approximate')}` : ''}. {t('Shown as a dashed line on the map.')}
          </p>
          {walk.source === 'straight' && (
            <p className="mt-2 rounded-2xl bg-warn-bg px-3.5 py-2.5 text-[13px] font-semibold text-warn">
              {t('This is a straight line, not a street route. Check curbs and crossings on the way.')}
            </p>
          )}
          <SourceBadge source={source} fetchedAt={fetchedAt} />
          {walk.steps.length > 0 && (
            <>
              <h4 className="mt-4 text-[14px] font-bold text-ink">{t('Turn by turn')}</h4>
              <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[14px] leading-snug text-ink-2 marker:font-bold marker:text-muted">
                {walk.steps.map((st, i) => (
                  <li key={i}>
                    {st.instruction}
                    {st.distanceM >= 5 && <span className="text-muted"> ({formatDistance(st.distanceM)})</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {walk.warnings && (
            <>
              <h4 className="mt-4 text-[14px] font-bold text-ink">{t('Along this walk')}</h4>
              {warnings.length === 0 ? (
                <p className={`${mutedText} mt-1`}>
                  {t(
                    'No recorded crash areas, recorded fatal crashes, resident reports, open 311 hazards or poor curb ramps near this route in our data. The data can be incomplete.',
                  )}
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1.5 text-[14px] leading-snug text-ink-2">
                  {warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-2xl bg-warn-bg px-3 py-2">
                      <span aria-hidden="true" className="font-bold text-warn">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[12px] font-medium leading-snug text-muted">
                {t(
                  'Crash counts are historical recorded crashes (911 dispatches), not live. Fatal crashes and resident reports come from Boston Vision Zero.',
                )}
              </p>
            </>
          )}
        </>
      )}
      <WeatherBox point={start} label={t('at the start of this walk')} />
      {showBikes && <BluebikesBox point={start} />}
    </section>
  );
}

/** Wording for a planned route's doors and legs, shared by the route list and the step-by-step view. */
function useRouteText(route: RouteOkPlus | null, nameOf: (id: string) => string) {
  const needPlatforms = !!route?.legs.some((l) => l.kind === 'ride' && !(l as RideLegPlus).towards);
  const platforms = usePlatformNames(needPlatforms);
  const tr = useT();
  const en = tr.lang === 'en';

  // Names arrive cleaned from the server ("Boston Common elevator entrance"); use them as they are.
  // cleanEntranceId is only a fallback for an older server that sends an id without a name.
  const doorName = (id: string | null, name: string | undefined, kind: 'entrance' | 'exit') => {
    if (name) return name;
    if (!id) return tr(`Use the station's accessible ${kind} (no detailed data for this station)`);
    return cleanEntranceId(id, kind);
  };
  const waitOf = (leg: Leg) => (leg.kind === 'ride' ? (leg as RideLeg).waitMinutes ?? 0 : 0);

  const toward = (leg: RideLegPlus) => {
    if (leg.towards) return leg.towards;
    const n = platforms?.[leg.fromPlatform]?.name ?? '';
    return n && !/line|only/i.test(n) ? n : '';
  };

  const legText = (leg: Leg) => {
    if (leg.kind === 'transfer') {
      return leg.fromPlatform === leg.toPlatform
        ? tr('Change trains at {station} (same platform).', { station: nameOf(leg.stationId) })
        : tr('Change at {station}: step-free path between platforms, about {n} min.', {
            station: nameOf(leg.stationId),
            n: Math.round(leg.minutes),
          });
    }
    const t = toward(leg);
    const stops = Math.max(1, leg.stationIds.length - 1);
    const wait = waitOf(leg);
    if (!en) {
      const routes = [...new Set([leg.route, ...((leg as RideLegPlus).alsoRoutes ?? [])])].map(routeName).join(' / ');
      return [
        tr('Take {route} from {from} to {to}.', { route: routes, from: nameOf(leg.fromStation), to: nameOf(leg.toStation) }),
        t ? tr('Toward {t}.', { t }) : '',
        tr('Stops: {n}. About {m} min on the train.', { n: stops, m: mins(leg.minutes) }),
        wait > 0 ? tr('Wait about {n} min for it.', { n: mins(wait) }) : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    return `Take ${legRoutesText(leg.route, (leg as RideLegPlus).alsoRoutes)}${t ? ` toward ${t}` : ''} from ${nameOf(leg.fromStation)} to ${nameOf(
      leg.toStation,
    )} (${stops} ${stops === 1 ? 'stop' : 'stops'}, about ${mins(leg.minutes)} min on the train${
      wait > 0 ? `; wait about ${mins(wait)} min for it` : ''
    }).`;
  };

  return { doorName, waitOf, legText };
}

function RouteDetails({
  route,
  query,
  nameOf,
  source,
  fetchedAt,
  onBreak,
  onReset,
  onSelectStation,
}: {
  route: RouteOkPlus;
  query: RouteQuery;
  nameOf: (id: string) => string;
  source?: DataSource;
  fetchedAt?: string;
  onBreak: (id: string) => void;
  onReset: () => void;
  onSelectStation: (id: string) => void;
}) {
  const { byId: facilities } = useFacilities();
  const tr = useT();
  const en = tr.lang === 'en';
  const { doorName, waitOf, legText } = useRouteText(route, nameOf);
  const totalWait = route.waitMinutes ?? route.legs.reduce((s, l) => s + waitOf(l), 0);
  const demoClosed = query.closed;

  return (
    <div className="lm-in mt-3 space-y-3">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-hidden="true" className="flex items-baseline gap-1.5">
            <span className={statNumber}>{mins(route.minutes)}</span>
            <span className="text-[15px] font-bold text-muted">{tr('min')}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <span className={`${badge} ${badgeOk}`}>
              <span aria-hidden="true">✓</span>
              {tr('step-free now')}
            </span>
            {route.approximate && (
              <span className={`${badge} ${badgeWarn}`}>
                <span aria-hidden="true">!</span>
                {tr('approximate')}
              </span>
            )}
          </div>
        </div>
        <p className="mt-3 text-[15px] font-bold leading-snug text-ink">
          <span aria-hidden="true" className="text-ok">
            ✓{' '}
          </span>
          {tr('Step-free route found: about {n} min', { n: mins(route.minutes) })}
          {totalWait > 0 && ` ${tr('(including about {n} min waiting)', { n: mins(totalWait) })}`}
        </p>
        <p className={`${mutedText} mt-1 leading-snug`}>
          {route.transfers === 0
            ? tr('No changes.')
            : en
              ? `${route.transfers} ${route.transfers === 1 ? 'change' : 'changes'}.`
              : tr('Changes: {n}.', { n: route.transfers })}{' '}
          {tr('Platform to platform; walks are listed separately. Times are approximate, from the weekday schedule')}
          {totalWait > 0 ? ` ${tr('(waits are half the usual time between trains)')}` : ''}.
        </p>
        {route.approximate && (
          <p className="mt-2 rounded-2xl bg-warn-bg px-3.5 py-2.5 text-[13px] font-semibold leading-snug text-warn">
            {tr("Some stations on this trip have no detailed elevator map, so we used the MBTA's station accessibility flag there.")}
          </p>
        )}
        <SourceBadge source={source} fetchedAt={fetchedAt} />
      </div>

      <ol className={card}>
        <TimelineStep color="var(--ink)" glyph={<DoorIcon />}>
          <p className="text-[15px] font-bold leading-snug text-ink">{tr('Enter by:')}</p>
          <p className={`${mutedText} leading-snug`}>
            {doorName(route.originEntranceId, route.originEntranceName ?? route.originEntrance?.name, 'entrance')} {tr('at')}{' '}
            <button type="button" className={linkBtn} onClick={() => onSelectStation(query.from)}>
              {nameOf(query.from)}
            </button>
          </p>
        </TimelineStep>
        {route.legs.map((leg, i) => {
          const ride = leg.kind === 'ride';
          const color = ride ? (ROUTE_COLORS[leg.route] ?? 'var(--ink-2)') : 'var(--muted)';
          const glyph = ride ? (
            leg.route.startsWith('Green-') ? leg.route.slice(6) : leg.route.charAt(0)
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
            </svg>
          );
          const title = ride
            ? [...new Set([leg.route, ...((leg as RideLegPlus).alsoRoutes ?? [])])].map((r) => tr(routeName(r))).join(' / ')
            : nameOf(leg.stationId);
          return (
            <TimelineStep key={i} color={color} glyph={glyph}>
              <p className="text-[15px] font-bold leading-snug text-ink">{title}</p>
              <p className={`${mutedText} leading-snug`}>{legText(leg)}</p>
            </TimelineStep>
          );
        })}
        <TimelineStep color="var(--ok)" glyph={<DoorIcon out />} last>
          <p className="text-[15px] font-bold leading-snug text-ink">{tr('Exit by:')}</p>
          <p className={`${mutedText} leading-snug`}>
            {doorName(route.destinationExitId, route.destinationExitName ?? route.destinationExit?.name, 'exit')} {tr('at')}{' '}
            <button type="button" className={linkBtn} onClick={() => onSelectStation(query.to)}>
              {nameOf(query.to)}
            </button>
          </p>
        </TimelineStep>
      </ol>

      <section aria-labelledby="demo-h" className="rounded-card border-2 border-dashed border-line-2 bg-soft p-4">
        <h3 id="demo-h" className={sectionTitle}>
          {tr('Demo: break an elevator')}
        </h3>
        <p className={`${mutedText} mt-0.5`}>{tr('Elevators and ramps this route needs:')}</p>
        {route.usedFacilityIds.length === 0 ? (
          <p className={`${mutedText} mt-2`}>{tr('None listed for this route (no detailed data, or level access).')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {route.usedFacilityIds.map((id) => {
              const f = facilities.get(id);
              const word = tr(facilityTypeWord(f?.type ?? 'ELEVATOR'));
              return (
                <li key={id} className="rounded-[18px] border border-line bg-white p-3.5 shadow-sh1">
                  <p className="text-[14px] leading-snug text-ink">
                    <span className="font-bold capitalize">{word}</span>: {f?.name ?? tr('Facility {id}', { id })}
                  </p>
                  <button type="button" className={`${btn} mt-2 h-auto py-2 text-left`} onClick={() => onBreak(id)}>
                    {tr('Pretend this {word} is broken', { word })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {demoClosed.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="rounded-2xl bg-bad-bg px-3.5 py-2.5 text-[14px] font-semibold leading-snug text-bad">
              <span aria-hidden="true">✕ </span>
              {tr('Pretending broken:')}{' '}
              {demoClosed.map((id) => facilities.get(id)?.shortName ?? facilities.get(id)?.name ?? id).join('; ')}
            </p>
            <button type="button" className={btnGhost} onClick={onReset}>
              {tr('Reset')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
