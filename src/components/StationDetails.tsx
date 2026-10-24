'use client';
// Selected station: step-free now (with reason), elevators, parking, next trains.
import { useEffect, useRef } from 'react';
import type { Station, StationStatusRow } from '@/lib/ui/api';
import { facilityTypeWord, routeName, stepFreeState, type StepFreeState } from '@/lib/ui/format';
import { usePredictions, useStationDetail } from '@/lib/ui/hooks';
import { btn, Notice, SourceBadge, StateText } from './ui';

export default function StationDetails({
  station,
  live,
  onClose,
}: {
  station: Station;
  live: StationStatusRow | undefined;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detail = useStationDetail(station.id);
  const preds = usePredictions(station.id);

  useEffect(() => {
    headingRef.current?.focus();
  }, [station.id]);

  const d = detail.data?.data;
  const facilityName = (id: string) => d?.facilities.find((f) => f.id === id)?.name ?? `Facility ${id}`;
  let state: StepFreeState = stepFreeState(station, live);
  let blockedBy = live?.blockedBy ?? [];
  if (d) {
    state = d.status.stepFree ? 'yes' : d.status.approximate && station.wheelchair === 0 ? 'unknown' : 'no';
    blockedBy = d.status.blockedBy;
  }
  const lifts = (d?.facilities ?? []).filter((f) => f.type !== 'ESCALATOR');
  const escalators = (d?.facilities ?? []).filter((f) => f.type === 'ESCALATOR');
  const trains = (preds.data?.data ?? []).slice().sort((a, b) => a.minutesAway - b.minutesAway).slice(0, 6);

  return (
    <section aria-labelledby="station-h" className="rounded-md border border-slate-400 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 id="station-h" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-slate-900">
          {station.name}
        </h2>
        <button type="button" className={btn} onClick={onClose} aria-label={`Close ${station.name} details`}>
          Close
        </button>
      </div>
      <p className="text-sm text-slate-700">{station.routes.map(routeName).join(', ')}</p>

      <div className="mt-2 text-base font-semibold text-slate-900">
        <StateText state={state} />
      </div>
      {state === 'no' && blockedBy.length > 0 && (
        <p className="text-sm text-slate-800">
          Because {blockedBy.length === 1 ? 'this is' : 'these are'} out of service: {blockedBy.map(facilityName).join('; ')}
        </p>
      )}
      {state === 'no' && blockedBy.length === 0 && (
        <p className="text-sm text-slate-800">This station has no step-free route between the street and its platforms.</p>
      )}
      {(d?.status.approximate ?? live?.approximate) && (
        <p className="text-sm text-slate-700">Based on the MBTA station flag (no detailed elevator map).</p>
      )}
      <SourceBadge source={detail.data?.source} fetchedAt={detail.data?.fetchedAt} />
      {detail.error && !d && <Notice tone="error">Live station details are not available right now.</Notice>}

      {lifts.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-slate-900">Elevators and lifts</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {lifts.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-slate-900">
                <span aria-hidden="true" className={f.closed ? 'font-bold text-red-700' : 'font-bold text-emerald-800'}>
                  {f.closed ? '✕' : '✓'}
                </span>
                <span>
                  <strong>{f.closed ? 'Out of service' : 'Working'}</strong> ({facilityTypeWord(f.type)}): {f.shortName ?? f.name}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {escalators.some((f) => f.closed) && (
        <p className="mt-2 text-sm text-slate-800">
          Escalators out of service: {escalators.filter((f) => f.closed).map((f) => f.shortName ?? f.name).join('; ')}
        </p>
      )}

      {d && d.parking.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-slate-900">Parking</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-900">
            {d.parking.map((p) => (
              <li key={p.id}>
                {p.name}: {p.accessibleSpaces ?? 'unknown'} accessible spaces
                {p.capacity != null && ` of ${p.capacity} total`}
                {p.feeDaily && ` · ${p.feeDaily}`}
                <span className="block text-xs text-slate-700">No live occupancy data.</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-3 font-semibold text-slate-900">Next trains</h3>
      {preds.error && !preds.data && <p className="text-sm text-slate-800">Next trains are not available right now.</p>}
      {preds.data && trains.length === 0 && <p className="text-sm text-slate-800">No upcoming trains listed.</p>}
      {!preds.data && !preds.error && <p className="text-sm text-slate-800">Loading next trains…</p>}
      <ul className="mt-1 space-y-1 text-sm text-slate-900">
        {trains.map((t, i) => (
          <li key={`${t.platformId}-${t.time}-${i}`}>
            {routeName(t.routeId)}
            {t.headsign ? ` to ${t.headsign}` : ''}:{' '}
            <strong>{t.minutesAway === 0 ? 'now' : `${t.approximate ? 'about ' : ''}${t.minutesAway} min`}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
