'use client';
// "Plan a trip": step-free route between two stations (optionally starting with a walk from a location),
// plus the "break an elevator" demo control. A spot tapped on the map can be the start or the end.
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { DataSource } from '@/lib/mbta/types';
import type { Leg, RideLeg, RouteFailReason, RouteOk } from '@/lib/router';
import type { Station, StationStatusRow } from '@/lib/ui/api';
import { cleanEntranceId, facilityTypeWord, legRoutesText, routeName, stepFreeState } from '@/lib/ui/format';
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
import { btn, btnPrimary, Notice, SourceBadge } from './ui';
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

  const options = stations.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name} — {MARK[stepFreeState(s, live.get(s.id))][0]} {t(MARK[stepFreeState(s, live.get(s.id))][1])}
    </option>
  ));

  const formEl = (
    <form onSubmit={submit} className="mt-2 space-y-3">
      <fieldset>
        <legend className="text-sm font-semibold text-slate-900">{t('Start from')}</legend>
        <div className="mt-1">
          {START_CHOICES.filter(([m]) => m !== 'saved' || places.length > 0).map(([m, label]) => (
            <label key={m} className="flex min-h-11 items-center gap-2 text-sm text-slate-900">
              <input
                type="radio"
                name={`${ids}-start`}
                value={m}
                checked={startMode === m}
                onChange={() => chooseStart(m)}
                className="h-5 w-5"
              />
              {t(label)}
            </label>
          ))}
        </div>
        {startMode === 'saved' && (
          <div className="mt-1">
            <label htmlFor={`${ids}-saved`} className="block text-sm font-semibold text-slate-900">
              {t('Start at')}
            </label>
            <select
              id={`${ids}-saved`}
              value={place?.label ?? ''}
              onChange={(e) => {
                const p = places.find((x) => x.label === e.target.value);
                if (p) setStartPlace(p);
                else setPlace(null);
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
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
        <div aria-live="polite" className="text-sm text-slate-800">
          {startMode === 'here' && locating && <p>{t('Finding your location…')}</p>}
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
          <div className="mt-1 space-y-1">
            <Notice tone="error">{locError}</Notice>
            <button type="button" className={btn} onClick={() => void locate()}>
              {t('Try my location again')}
            </button>
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor={`${ids}-from`} className="block text-sm font-semibold text-slate-900">
          {t(startMode === 'station' ? 'From station' : 'Walk to station (where you board)')}
        </label>
        <select
          id={`${ids}-from`}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
        >
          <option value="">{t('Choose a station')}</option>
          {options}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-slate-900">{t('Destination')}</legend>
        <div className="mt-1">
          {END_CHOICES.map(([m, label]) => (
            <label key={m} className="flex min-h-11 items-center gap-2 text-sm text-slate-900">
              <input
                type="radio"
                name={`${ids}-end`}
                value={m}
                checked={endMode === m}
                onChange={() => chooseEnd(m)}
                className="h-5 w-5"
              />
              {t(label)}
            </label>
          ))}
        </div>
        {endMode === 'map' && (
          <p aria-live="polite" className="mt-1 text-sm text-slate-800">
            {destPlace
              ? t('We picked the closest step-free station to {place}; you can change it below.', { place: destPlace.label })
              : t('Tap a spot on the map, then choose End here.')}
          </p>
        )}
        {endMode === 'place' && (
          <div>
            <label htmlFor={`${ids}-place`} className="block text-sm font-semibold text-slate-900">
              {t('Place')}
            </label>
            <select
              id={`${ids}-place`}
              value={destPlace?.label ?? ''}
              onChange={(e) => chooseDestPlace(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
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
              <p aria-live="polite" className="mt-1 text-sm text-slate-800">
                {t('We picked the closest step-free station to {place}; you can change it below.', { place: destPlace.label })}
              </p>
            )}
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor={`${ids}-to`} className="block text-sm font-semibold text-slate-900">
          {t(endMode === 'station' ? 'To station' : 'Leave the train at (station)')}
        </label>
        <select
          id={`${ids}-to`}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
        >
          <option value="">{t('Choose a station')}</option>
          {options}
        </select>
      </div>
      <button type="submit" className={`${btnPrimary} w-full`}>
        {t('Find step-free route')}
      </button>
      {formError && <Notice tone="error">{formError}</Notice>}
    </form>
  );

  return (
    <section aria-labelledby="trip-h">
      <h2 id="trip-h" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-slate-900 outline-none">
        {t('Plan a step-free trip')}
      </h2>
      {hasTrip && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className={btnPrimary} disabled={!steps?.length} onClick={onStart}>
            <span aria-hidden="true">▶</span> {t('Start')}
          </button>
          <button type="button" className={btn} onClick={clear}>
            <span aria-hidden="true">✕</span> {t('Close trip')}
          </button>
        </div>
      )}

      <div aria-live="polite" className="mt-3">
        {query && (isLoading || isValidating) && <p className="text-sm text-slate-800">{t('Planning your trip…')}</p>}
        {query && error && <Notice tone="error">{t('Route planning is not available right now. Try again in a minute.')}</Notice>}
      </div>

      {direct && (
        <>
          <p className="mt-3 text-sm text-slate-800">{t('Both places use the same station, so this trip is a walk.')}</p>
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
        <section aria-labelledby="start-h" className="mt-3 rounded-md border border-slate-500 bg-white p-3 text-slate-900">
          <h3 id="start-h" className="font-bold">
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
        <div className="mt-2 space-y-2">
          <Notice tone="error">{t(FAIL_TEXT[route.reason], { o: nameOf(query.from), d: nameOf(query.to) })}</Notice>
          {route.alternatives.length > 0 && (
            <>
              <p className="text-sm font-semibold text-slate-900">{t('Nearby stations that are step-free now:')}</p>
              <ul className="space-y-2">
                {route.alternatives.map((a) => {
                  const useAsOrigin = route.reason === 'origin-not-step-free';
                  return (
                    <li key={a.stationId}>
                      <button
                        type="button"
                        className={`${btn} w-full justify-start text-left`}
                        onClick={() => {
                          const next = useAsOrigin
                            ? { ...query, from: a.stationId }
                            : { ...query, to: a.stationId };
                          if (useAsOrigin) setFrom(a.stationId);
                          else setTo(a.stationId);
                          setQuery(next);
                        }}
                      >
                        {t(useAsOrigin ? 'Start from {name} instead ({km} km away)' : 'Go to {name} instead ({km} km away)', {
                          name: nameOf(a.stationId),
                          km: a.distanceKm,
                        })}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {query.closed.length > 0 && (
            <button type="button" className={btn} onClick={() => setQuery({ ...query, closed: [] })}>
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

      {hasTrip ? (
        <details
          open={editOpen}
          onToggle={(e) => setEditOpen(e.currentTarget.open)}
          className="mt-3 rounded-md border border-slate-400 bg-white px-3 py-1"
        >
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-slate-900">
            {t('Change start or destination')}
          </summary>
          {formEl}
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
    <section aria-labelledby={id} className="mt-3 rounded-md border border-slate-500 bg-white p-3 text-slate-900">
      <h3 id={id} className="font-bold">
        {heading}
      </h3>
      <div aria-live="polite">
        {loading && !walk && <p className="text-sm">{t('Finding a walking route…')}</p>}
        {failed && <Notice tone="error">{failText}</Notice>}
      </div>
      {walk && (
        <>
          <p className="mt-1">
            {t('From {from} to {to}:', { from: fromText, to: toText })}{' '}
            <strong>{t('about {n} min', { n: mins(walk.minutes) })}</strong> ({formatDistance(walk.distanceM)}).
          </p>
          {centreNote && <p className="text-sm text-slate-800">{centreNote}</p>}
          <p className="text-sm text-slate-800">
            <span aria-hidden="true">{walk.source === 'valhalla' ? '♿ ' : '⚠ '}</span>
            {t(WALK_SOURCE_LABEL[walk.source] ?? walk.source)}
            {walk.approximate && walk.source === 'valhalla' ? `, ${t('approximate')}` : ''}. {t('Shown as a dashed line on the map.')}
          </p>
          {walk.source === 'straight' && (
            <p className="text-sm text-slate-800">
              {t('This is a straight line, not a street route. Check curbs and crossings on the way.')}
            </p>
          )}
          <SourceBadge source={source} fetchedAt={fetchedAt} />
          {walk.steps.length > 0 && (
            <>
              <h4 className="mt-2 text-sm font-semibold">{t('Turn by turn')}</h4>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                {walk.steps.map((st, i) => (
                  <li key={i}>
                    {st.instruction}
                    {st.distanceM >= 5 && <span className="text-slate-700"> ({formatDistance(st.distanceM)})</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {walk.warnings && (
            <>
              <h4 className="mt-2 text-sm font-semibold">{t('Along this walk')}</h4>
              {warnings.length === 0 ? (
                <p className="text-sm text-slate-800">
                  {t(
                    'No recorded crash areas, recorded fatal crashes, resident reports, open 311 hazards or poor curb ramps near this route in our data. The data can be incomplete.',
                  )}
                </p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span aria-hidden="true">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-slate-700">
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
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-emerald-800 bg-emerald-50 p-3 text-slate-900">
        <p className="font-bold">
          <span aria-hidden="true">✓ </span>
          {tr('Step-free route found: about {n} min', { n: mins(route.minutes) })}
          {totalWait > 0 && ` ${tr('(including about {n} min waiting)', { n: mins(totalWait) })}`}
        </p>
        <p className="text-sm">
          {route.transfers === 0
            ? tr('No changes.')
            : en
              ? `${route.transfers} ${route.transfers === 1 ? 'change' : 'changes'}.`
              : tr('Changes: {n}.', { n: route.transfers })}{' '}
          {tr('Platform to platform; walks are listed separately. Times are approximate, from the weekday schedule')}
          {totalWait > 0 ? ` ${tr('(waits are half the usual time between trains)')}` : ''}.
        </p>
        {route.approximate && (
          <p className="mt-1 text-sm">
            {tr("Some stations on this trip have no detailed elevator map, so we used the MBTA's station accessibility flag there.")}
          </p>
        )}
        <SourceBadge source={source} fetchedAt={fetchedAt} />
      </div>

      <ol className="space-y-2 text-sm text-slate-900">
        <li className="rounded border border-slate-300 bg-white p-2">
          <strong>{tr('Enter by:')}</strong> {doorName(route.originEntranceId, route.originEntranceName ?? route.originEntrance?.name, 'entrance')} {tr('at')}{' '}
          <button
            type="button"
            className="min-h-11 font-semibold text-blue-800 underline"
            onClick={() => onSelectStation(query.from)}
          >
            {nameOf(query.from)}
          </button>
        </li>
        {route.legs.map((leg, i) => (
          <li key={i} className="rounded border border-slate-300 bg-white p-2">
            {legText(leg)}
          </li>
        ))}
        <li className="rounded border border-slate-300 bg-white p-2">
          <strong>{tr('Exit by:')}</strong> {doorName(route.destinationExitId, route.destinationExitName ?? route.destinationExit?.name, 'exit')} {tr('at')}{' '}
          <button
            type="button"
            className="min-h-11 font-semibold text-blue-800 underline"
            onClick={() => onSelectStation(query.to)}
          >
            {nameOf(query.to)}
          </button>
        </li>
      </ol>

      <section aria-labelledby="demo-h" className="rounded-md border-2 border-dashed border-slate-500 p-3">
        <h3 id="demo-h" className="font-bold text-slate-900">
          {tr('Demo: break an elevator')}
        </h3>
        <p className="text-sm text-slate-800">{tr('Elevators and ramps this route needs:')}</p>
        {route.usedFacilityIds.length === 0 ? (
          <p className="mt-1 text-sm text-slate-800">{tr('None listed for this route (no detailed data, or level access).')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {route.usedFacilityIds.map((id) => {
              const f = facilities.get(id);
              const word = tr(facilityTypeWord(f?.type ?? 'ELEVATOR'));
              return (
                <li key={id} className="rounded border border-slate-300 bg-white p-2 text-sm">
                  <p className="text-slate-900">
                    <span className="font-semibold capitalize">{word}</span>: {f?.name ?? tr('Facility {id}', { id })}
                  </p>
                  <button type="button" className={`${btn} mt-1`} onClick={() => onBreak(id)}>
                    {tr('Pretend this {word} is broken', { word })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {demoClosed.length > 0 && (
          <div className="mt-2 text-sm text-slate-900">
            <p>
              {tr('Pretending broken:')}{' '}
              {demoClosed.map((id) => facilities.get(id)?.shortName ?? facilities.get(id)?.name ?? id).join('; ')}
            </p>
            <button type="button" className={`${btn} mt-1`} onClick={onReset}>
              {tr('Reset')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
