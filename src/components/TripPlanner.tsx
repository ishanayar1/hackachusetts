'use client';
// "Plan a trip": step-free route between two stations, plus the "break an elevator" demo control.
import { useEffect, useId, useState } from 'react';
import type { Leg, RouteFailReason, RouteOk } from '@/lib/router';
import type { Station, StationStatusRow } from '@/lib/ui/api';
import { cleanEntranceId, facilityTypeWord, routeName, stepFreeState } from '@/lib/ui/format';
import { useFacilities, usePathways, usePlatformNames, useRoute, type RouteQuery } from '@/lib/ui/hooks';
import { btn, btnPrimary, Notice, SourceBadge } from './ui';

const MARK = { yes: '✓ step-free now', no: '✕ not step-free now', unknown: '? no data' } as const;

const FAIL_TEXT: Record<RouteFailReason, (o: string, d: string) => string> = {
  'origin-not-step-free': (o) => `There is no step-free way into ${o} right now.`,
  'destination-not-step-free': (_o, d) => `There is no step-free way out at ${d} right now.`,
  'no-path': (o, d) => `We could not find a step-free trip from ${o} to ${d} right now.`,
  'unknown-station': () => 'We do not know one of these stations. Pick both from the lists.',
};

type Props = {
  stations: Station[];
  byId: Map<string, Station>;
  live: Map<string, StationStatusRow>;
  onRoute: (legs: Leg[] | null) => void;
  onSelectStation: (id: string) => void;
};

export default function TripPlanner({ stations, byId, live, onRoute, onSelectStation }: Props) {
  const ids = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState<RouteQuery | null>(null);
  const [formError, setFormError] = useState('');
  const { data, error, isLoading, isValidating } = useRoute(query);
  const route = data?.data;
  const ok = route?.ok ? (route as RouteOk & { closedFacilityIds: string[] }) : null;

  useEffect(() => {
    onRoute(ok ? ok.legs : null);
  }, [ok, onRoute]);

  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!from || !to) return setFormError('Choose both a start and a destination station.');
    if (from === to) return setFormError('Start and destination are the same station.');
    setFormError('');
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
        <div>
          <label htmlFor={`${ids}-from`} className="block text-sm font-semibold text-slate-900">
            From station
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
  route: RouteOk & { closedFacilityIds: string[] };
  query: RouteQuery;
  nameOf: (id: string) => string;
  source?: import('@/lib/mbta/types').DataSource;
  fetchedAt?: string;
  onBreak: (id: string) => void;
  onReset: () => void;
  onSelectStation: (id: string) => void;
}) {
  const platforms = usePlatformNames();
  const { byId: facilities } = useFacilities();
  const pathways = usePathways(!!(route.originEntranceId || route.destinationExitId));

  const doorName = (stationId: string, id: string | null, kind: 'entrance' | 'exit') => {
    if (!id) return `Use the station's accessible ${kind} (no detailed data for this station)`;
    const n = pathways?.[stationId]?.nodes[id]?.name;
    return n ? `${n} ${kind}` : cleanEntranceId(id, kind);
  };

  const toward = (pid: string) => {
    const n = platforms?.[pid]?.name ?? '';
    return n && !/line|only/i.test(n) ? n : '';
  };

  const legText = (leg: Leg) => {
    if (leg.kind === 'transfer') {
      return leg.fromPlatform === leg.toPlatform
        ? `Change trains at ${nameOf(leg.stationId)} (same platform).`
        : `Change at ${nameOf(leg.stationId)}: step-free path between platforms, about ${Math.round(leg.minutes)} min.`;
    }
    const t = toward(leg.fromPlatform);
    const stops = Math.max(1, leg.stationIds.length - 1);
    return `Take the ${routeName(leg.route)}${t ? ` toward ${t}` : ''} from ${nameOf(leg.fromStation)} to ${nameOf(
      leg.toStation,
    )} (${stops} ${stops === 1 ? 'stop' : 'stops'}, about ${Math.round(leg.minutes)} min).`;
  };

  const demoClosed = query.closed;

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-emerald-800 bg-emerald-50 p-3 text-slate-900">
        <p className="font-bold">
          <span aria-hidden="true">✓ </span>Step-free route found: about {Math.round(route.minutes)} minutes
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
          <strong>Enter by:</strong> {doorName(query.from, route.originEntranceId, 'entrance')} at{' '}
          <button type="button" className="font-semibold text-blue-800 underline" onClick={() => onSelectStation(query.from)}>
            {nameOf(query.from)}
          </button>
        </li>
        {route.legs.map((leg, i) => (
          <li key={i} className="rounded border border-slate-300 bg-white p-2">
            {legText(leg)}
          </li>
        ))}
        <li className="rounded border border-slate-300 bg-white p-2">
          <strong>Exit by:</strong> {doorName(query.to, route.destinationExitId, 'exit')} at{' '}
          <button type="button" className="font-semibold text-blue-800 underline" onClick={() => onSelectStation(query.to)}>
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
