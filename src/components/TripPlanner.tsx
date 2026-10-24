'use client';
// "Plan a trip": step-free route between two stations (optionally starting with a walk from a location),
// plus the "break an elevator" demo control.
import { useEffect, useId, useState } from 'react';
import type { DataSource } from '@/lib/mbta/types';
import type { Leg, RideLeg, RouteFailReason, RouteOk } from '@/lib/router';
import type { Station, StationStatusRow } from '@/lib/ui/api';
import { cleanEntranceId, facilityTypeWord, legRoutesText, stepFreeState } from '@/lib/ui/format';
import { useFacilities, usePlatformNames, useRoute, useWalk, type RouteQuery } from '@/lib/ui/hooks';
import {
  DEMO_PLACE,
  formatDistance,
  getMyLocation,
  nearestStepFree,
  WALK_SOURCE_LABEL,
  warningLines,
  type Place,
  type WalkResult,
} from '@/lib/ui/walk';
import { btn, btnPrimary, Notice, SourceBadge } from './ui';

const MARK = {
  yes: '✓ step-free now',
  partial: '! partly step-free now',
  no: '✕ not step-free now',
  unknown: '? no data',
} as const;

const FAIL_TEXT: Record<RouteFailReason, (o: string, d: string) => string> = {
  'origin-not-step-free': (o) => `There is no step-free way into ${o} right now.`,
  'destination-not-step-free': (_o, d) => `There is no step-free way out at ${d} right now.`,
  'no-path': (o, d) => `We could not find a step-free trip from ${o} to ${d} right now.`,
  'unknown-station': () => 'We do not know one of these stations. Pick both from the lists.',
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
type StartMode = 'station' | 'here' | 'demo';

const START_CHOICES: [StartMode, string][] = [
  ['station', 'A station'],
  ['here', 'My location'],
  ['demo', "Pretend I'm at Park Street (demo)"],
];

type Props = {
  stations: Station[];
  byId: Map<string, Station>;
  live: Map<string, StationStatusRow>;
  onRoute: (legs: Leg[] | null) => void;
  /** Walking lines ([lon, lat] lists) to draw dashed on the map, or null. */
  onWalk?: (lines: [number, number][][] | null) => void;
  onSelectStation: (id: string) => void;
};

export default function TripPlanner({ stations, byId, live, onRoute, onWalk, onSelectStation }: Props) {
  const ids = useId();
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
  const { data, error, isLoading, isValidating } = useRoute(query);
  const route = data?.data;
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

  useEffect(() => {
    onRoute(ok ? ok.legs : null);
  }, [ok, onRoute]);

  useEffect(() => {
    onWalk?.(walkData?.coordinates?.length ? [walkData.coordinates] : null);
  }, [walkData, onWalk]);

  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const setStartPlace = (p: Place) => {
    setPlace(p);
    const near = nearestStepFree(p, stations, live);
    if (near) setFrom(near.id);
  };

  const locate = async () => {
    setLocating(true);
    setLocError('');
    try {
      setStartPlace(await getMyLocation());
    } catch (e) {
      setPlace(null);
      setLocError(e instanceof Error ? e.message : 'We could not get your location.');
    } finally {
      setLocating(false);
    }
  };

  const chooseStart = (m: StartMode) => {
    setStartMode(m);
    setLocError('');
    if (m === 'station') setPlace(null);
    else if (m === 'demo') setStartPlace(DEMO_PLACE);
    else {
      setPlace(null);
      void locate();
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (startMode !== 'station' && !place)
      return setFormError('Your start location is not set yet. Try your location again or pick another start.');
    if (!from || !to) return setFormError('Choose both a start and a destination station.');
    if (from === to) return setFormError('Start and destination are the same station.');
    setFormError('');
    setWalkPlace(startMode === 'station' ? null : place);
    setQuery({ from, to, closed: [] });
  };

  const options = stations.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name} — {MARK[stepFreeState(s, live.get(s.id))]}
    </option>
  ));

  return (
    <section aria-labelledby="trip-h">
      <h2 id="trip-h" className="text-lg font-bold text-slate-900">
        Plan a step-free trip
      </h2>
      <form onSubmit={submit} className="mt-2 space-y-3">
        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">Start from</legend>
          <div className="mt-1">
            {START_CHOICES.map(([m, label]) => (
              <label key={m} className="flex min-h-11 items-center gap-2 text-sm text-slate-900">
                <input
                  type="radio"
                  name={`${ids}-start`}
                  value={m}
                  checked={startMode === m}
                  onChange={() => chooseStart(m)}
                  className="h-5 w-5"
                />
                {label}
              </label>
            ))}
          </div>
          <div aria-live="polite" className="text-sm text-slate-800">
            {startMode === 'here' && locating && <p>Finding your location…</p>}
            {startMode !== 'station' && place && !locating && (
              <p>
                Starting at {place.label}. Your location stays on this device and is only used to plan the walk. We
                picked the closest step-free station; you can change it below.
              </p>
            )}
          </div>
          {locError && (
            <div className="mt-1 space-y-1">
              <Notice tone="error">{locError}</Notice>
              <button type="button" className={btn} onClick={() => void locate()}>
                Try my location again
              </button>
            </div>
          )}
        </fieldset>
        <div>
          <label htmlFor={`${ids}-from`} className="block text-sm font-semibold text-slate-900">
            {startMode === 'station' ? 'From station' : 'Walk to station (where you board)'}
          </label>
          <select
            id={`${ids}-from`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
          >
            <option value="">Choose a station</option>
            {options}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-to`} className="block text-sm font-semibold text-slate-900">
            To station
          </label>
          <select
            id={`${ids}-to`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
          >
            <option value="">Choose a station</option>
            {options}
          </select>
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>
          Find step-free route
        </button>
        {formError && <Notice tone="error">{formError}</Notice>}
      </form>

      <div aria-live="polite" className="mt-3">
        {query && (isLoading || isValidating) && <p className="text-sm text-slate-800">Planning your trip…</p>}
        {query && error && <Notice tone="error">Route planning is not available right now. Try again in a minute.</Notice>}
      </div>

      {query && walkPlace && boardStation && (
        <WalkDetails
          place={walkPlace}
          station={boardStation}
          entranceName={entrance ? entrance.name || ok?.originEntranceName || 'Step-free' : undefined}
          walk={walkData}
          loading={walk.isLoading || (!routeSettled && !walkData)}
          failed={!!walk.error && !walkData}
          source={walk.data?.source}
          fetchedAt={walk.data?.fetchedAt}
        />
      )}

      {query && route && !route.ok && (
        <div className="mt-2 space-y-2">
          <Notice tone="error">{FAIL_TEXT[route.reason](nameOf(query.from), nameOf(query.to))}</Notice>
          {route.alternatives.length > 0 && (
            <>
              <p className="text-sm font-semibold text-slate-900">Nearby stations that are step-free now:</p>
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
                        {useAsOrigin ? 'Start from' : 'Go to'} {nameOf(a.stationId)} instead ({a.distanceKm} km away)
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {query.closed.length > 0 && (
            <button type="button" className={btn} onClick={() => setQuery({ ...query, closed: [] })}>
              Reset pretend-broken elevators
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
    </section>
  );
}

function WalkDetails({
  place,
  station,
  entranceName,
  walk,
  loading,
  failed,
  source,
  fetchedAt,
}: {
  place: Place;
  station: Station;
  entranceName?: string;
  walk: WalkResult | undefined;
  loading: boolean;
  failed: boolean;
  source?: DataSource;
  fetchedAt?: string;
}) {
  // Only name an entrance when the walk really ends at it; otherwise it ends at the station centre.
  const target = entranceName
    ? `${/entrance/i.test(entranceName) ? entranceName : `${entranceName} entrance`} at ${station.name}`
    : station.name;
  const warnings = warningLines(walk?.warnings);
  return (
    <section aria-labelledby="walk-h" className="mt-3 rounded-md border border-slate-500 bg-white p-3 text-slate-900">
      <h3 id="walk-h" className="font-bold">
        Walk to the station
      </h3>
      <div aria-live="polite">
        {loading && !walk && <p className="text-sm">Finding a walking route…</p>}
        {failed && (
          <Notice tone="error">
            Walking directions are not available right now. Head to {station.name} and look for the accessible entrance.
          </Notice>
        )}
      </div>
      {walk && (
        <>
          <p className="mt-1">
            From {place.label} to {target}: <strong>about {Math.max(1, Math.round(walk.minutes))} min</strong> (
            {formatDistance(walk.distanceM)}).
          </p>
          {!entranceName && (
            <p className="text-sm text-slate-800">
              The walk ends at the middle of the station; look for its step-free entrance there.
            </p>
          )}
          <p className="text-sm text-slate-800">
            <span aria-hidden="true">{walk.source === 'valhalla' ? '♿ ' : '⚠ '}</span>
            {WALK_SOURCE_LABEL[walk.source] ?? walk.source}
            {walk.approximate && walk.source === 'valhalla' ? ', approximate' : ''}. Shown as a dashed line on the map.
          </p>
          {walk.source === 'straight' && (
            <p className="text-sm text-slate-800">
              This is a straight line, not a street route. Check curbs and crossings on the way.
            </p>
          )}
          <SourceBadge source={source} fetchedAt={fetchedAt} />
          {walk.steps.length > 0 && (
            <>
              <h4 className="mt-2 text-sm font-semibold">Turn by turn</h4>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                {walk.steps.map((st, i) => (
                  <li key={i}>
                    {st.instruction}
                    {st.distanceM > 0 && <span className="text-slate-700"> ({formatDistance(st.distanceM)})</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {walk.warnings && (
            <>
              <h4 className="mt-2 text-sm font-semibold">Along this walk</h4>
              {warnings.length === 0 ? (
                <p className="text-sm text-slate-800">
                  No recorded crash areas, reported hazards or poor curb ramps near this route in our data. The data
                  can be incomplete.
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
                Crash counts are historical recorded crashes (911 dispatches), not live.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
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
  const needPlatforms = route.legs.some((l) => l.kind === 'ride' && !(l as RideLegPlus).towards);
  const platforms = usePlatformNames(needPlatforms);
  const { byId: facilities } = useFacilities();

  const doorName = (id: string | null, name: string | undefined, kind: 'entrance' | 'exit') => {
    if (name) return new RegExp(kind, 'i').test(name) ? name : `${name} ${kind}`;
    if (!id) return `Use the station's accessible ${kind} (no detailed data for this station)`;
    return cleanEntranceId(id, kind);
  };

  const toward = (leg: RideLegPlus) => {
    if (leg.towards) return leg.towards;
    const n = platforms?.[leg.fromPlatform]?.name ?? '';
    return n && !/line|only/i.test(n) ? n : '';
  };

  const legText = (leg: Leg) => {
    if (leg.kind === 'transfer') {
      return leg.fromPlatform === leg.toPlatform
        ? `Change trains at ${nameOf(leg.stationId)} (same platform).`
        : `Change at ${nameOf(leg.stationId)}: step-free path between platforms, about ${Math.round(leg.minutes)} min.`;
    }
    const t = toward(leg);
    const stops = Math.max(1, leg.stationIds.length - 1);
    return `Take ${legRoutesText(leg.route, (leg as RideLegPlus).alsoRoutes)}${t ? ` toward ${t}` : ''} from ${nameOf(leg.fromStation)} to ${nameOf(
      leg.toStation,
    )} (${stops} ${stops === 1 ? 'stop' : 'stops'}, about ${Math.round(leg.minutes)} min).`;
  };

  const demoClosed = query.closed;

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-emerald-800 bg-emerald-50 p-3 text-slate-900">
        <p className="font-bold">
          <span aria-hidden="true">✓ </span>Step-free route found: about {Math.round(route.minutes)} minutes on the
          train
        </p>
        <p className="text-sm">
          {route.transfers === 0 ? 'No changes.' : `${route.transfers} ${route.transfers === 1 ? 'change' : 'changes'}.`}{' '}
          Times are approximate, from the schedule.
        </p>
        {route.approximate && (
          <p className="mt-1 text-sm">
            Some stations on this trip have no detailed elevator map, so we used the MBTA&apos;s station accessibility
            flag there.
          </p>
        )}
        <SourceBadge source={source} fetchedAt={fetchedAt} />
      </div>

      <ol className="space-y-2 text-sm text-slate-900">
        <li className="rounded border border-slate-300 bg-white p-2">
          <strong>Enter by:</strong> {doorName(route.originEntranceId, route.originEntranceName ?? route.originEntrance?.name, 'entrance')} at{' '}
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
          <strong>Exit by:</strong> {doorName(route.destinationExitId, route.destinationExitName ?? route.destinationExit?.name, 'exit')} at{' '}
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
          Demo: break an elevator
        </h3>
        <p className="text-sm text-slate-800">Elevators and ramps this route needs:</p>
        {route.usedFacilityIds.length === 0 ? (
          <p className="mt-1 text-sm text-slate-800">None listed for this route (no detailed data, or level access).</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {route.usedFacilityIds.map((id) => {
              const f = facilities.get(id);
              const word = facilityTypeWord(f?.type ?? 'ELEVATOR');
              return (
                <li key={id} className="rounded border border-slate-300 bg-white p-2 text-sm">
                  <p className="text-slate-900">
                    <span className="font-semibold capitalize">{word}</span>: {f?.name ?? `Facility ${id}`}
                  </p>
                  <button type="button" className={`${btn} mt-1`} onClick={() => onBreak(id)}>
                    Pretend this {word} is broken
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {demoClosed.length > 0 && (
          <div className="mt-2 text-sm text-slate-900">
            <p>
              Pretending broken:{' '}
              {demoClosed.map((id) => facilities.get(id)?.shortName ?? facilities.get(id)?.name ?? id).join('; ')}
            </p>
            <button type="button" className={`${btn} mt-1`} onClick={onReset}>
              Reset
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
