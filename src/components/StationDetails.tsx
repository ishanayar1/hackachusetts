'use client';
// Selected station: step-free now (with reason), elevators, parking, next trains.
import { useEffect, useRef } from 'react';
import type { Station, StationStatusRow } from '@/lib/ui/api';
import {
  ACCESS_EFFECTS,
  alertActive,
  effectLabel,
  facilityTypeWord,
  minutesText,
  nextTrainGroups,
  partialLines,
  routeName,
  stepFreeState,
  type StepFreeState,
} from '@/lib/ui/format';
import { useFacilities, usePredictions, useStationDetail } from '@/lib/ui/hooks';
import { AlertText, useAlertSummary } from './AlertSummary';
import { btn, Notice, SourceBadge, StarButton, StateIcon, StateText } from './ui';
import { useT } from '@/lib/i18n';

/** Street doors from /api/station/[id] (names already cleaned on the server). Absent on older servers. */
type Entrance = { id: string; name: string; stepFree: boolean; lat?: number; lon?: number };

export default function StationDetails({
  station,
  live,
  onClose,
  saved,
  onToggleSave,
}: {
  station: Station;
  live: StationStatusRow | undefined;
  onClose: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tr = useT();
  const mins = (p: Parameters<typeof minutesText>[0]) =>
    tr.lang === 'en'
      ? minutesText(p)
      : p.minutesAway === 0
        ? tr('now')
        : tr(p.approximate ? 'about {n} min' : '{n} min', { n: p.minutesAway });
  const detail = useStationDetail(station.id);
  const preds = usePredictions(station.id);

  useEffect(() => {
    headingRef.current?.focus();
  }, [station.id]);

  const d = detail.data?.data;
  const { byId: allFacilities } = useFacilities();
  const facilityName = (id: string) =>
    d?.facilities.find((f) => f.id === id)?.name ?? allFacilities.get(id)?.name ?? tr('Facility {id}', { id });
  let state: StepFreeState = stepFreeState(station, live);
  let blockedBy = live?.blockedBy ?? [];
  let blockedPlatforms = live?.blockedPlatforms;
  if (d) {
    state = stepFreeState(station, d.status);
    blockedBy = d.status.blockedBy ?? [];
    blockedPlatforms = d.status.blockedPlatforms;
  }
  const lifts = (d?.facilities ?? []).filter((f) => f.type !== 'ESCALATOR');
  const escalators = (d?.facilities ?? []).filter((f) => f.type === 'ESCALATOR');
  const groups = nextTrainGroups(preds.data?.data ?? []);
  const demoEmpty = preds.data?.source === 'demo' && groups.length === 0;
  const entrances = [...((d as { entrances?: Entrance[] } | undefined)?.entrances ?? [])].sort(
    (a, b) => Number(b.stepFree) - Number(a.stepFree) || a.name.localeCompare(b.name),
  );
  const summaries = useAlertSummary();
  const stationAlerts = (d?.alerts ?? []).filter((a) => !a.informational && ACCESS_EFFECTS.has(a.effect) && alertActive(a));

  return (
    <section aria-labelledby="station-h" className="rounded-md border border-slate-400 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 id="station-h" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-slate-900">
          {station.name}
        </h2>
        <div className="flex shrink-0 gap-2">
          {onToggleSave && <StarButton saved={!!saved} name={station.name} onToggle={onToggleSave} />}
          <button type="button" className={btn} onClick={onClose} aria-label={tr('Close {name} details', { name: station.name })}>
            {tr('Close')}
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-700">{station.routes.map(routeName).join(', ')}</p>

      <div className="mt-2 text-base font-semibold text-slate-900">
        <StateText state={state} />
      </div>
      {state === 'no' && blockedBy.length > 0 && (
        <p className="text-sm text-slate-800">
          {tr(blockedBy.length === 1 ? 'Because this is out of service: {list}' : 'Because these are out of service: {list}', {
            list: blockedBy.map(facilityName).join('; '),
          })}
        </p>
      )}
      {state === 'no' && blockedBy.length === 0 && (
        <p className="text-sm text-slate-800">{tr('This station has no step-free route between the street and its platforms.')}</p>
      )}
      {state === 'partial' && (
        <ul className="text-sm text-slate-800">
          {partialLines(blockedPlatforms, blockedBy, facilityName).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {(d?.status.approximate ?? live?.approximate) && (
        <p className="text-sm text-slate-700">{tr('Based on the MBTA station flag (no detailed elevator map).')}</p>
      )}
      <SourceBadge source={detail.data?.source} fetchedAt={detail.data?.fetchedAt} />
      {detail.error && !d && <Notice tone="error">{tr('Live station details are not available right now.')}</Notice>}

      {lifts.length > 0 && (
        <>
          {/* Out-of-service equipment stays in view; the full list is folded because the map shows it. */}
          {lifts.some((f) => f.closed) && (
            <>
              <h3 className="mt-3 font-semibold text-slate-900">{tr('Out of service here')}</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {lifts.filter((f) => f.closed).map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-slate-900">
                <span aria-hidden="true" className={f.closed ? 'font-bold text-red-700' : 'font-bold text-emerald-800'}>
                  {f.closed ? '✕' : '✓'}
                </span>
                <span>
                  <strong>{tr(f.closed ? 'Out of service' : 'Working')}</strong> ({tr(facilityTypeWord(f.type))}): {f.shortName ?? f.name}
                  {f.closed && f.alternateServiceText && (
                    <span className="mt-0.5 block text-slate-800">{tr('MBTA suggests:')} {f.alternateServiceText}</span>
                  )}
                </span>
              </li>
                ))}
              </ul>
            </>
          )}
          <details className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-900">
              {tr('All elevators and lifts here ({n}), also on the map', { n: lifts.length })}
            </summary>
            <ul className="mt-1 space-y-1 text-sm">
              {lifts.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-slate-900">
                <span aria-hidden="true" className={f.closed ? 'font-bold text-red-700' : 'font-bold text-emerald-800'}>
                  {f.closed ? '✕' : '✓'}
                </span>
                <span>
                  <strong>{tr(f.closed ? 'Out of service' : 'Working')}</strong> ({tr(facilityTypeWord(f.type))}): {f.shortName ?? f.name}
                  {f.closed && f.alternateServiceText && (
                    <span className="mt-0.5 block text-slate-800">{tr('MBTA suggests:')} {f.alternateServiceText}</span>
                  )}
                </span>
              </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {stationAlerts.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-slate-900">{tr('Accessibility alerts here')}</h3>
          <ul className="mt-1 space-y-2">
            {stationAlerts.map((a) => (
              <li key={a.id} className="flex items-start gap-1.5 text-sm text-slate-900">
                <span aria-hidden="true">⚠</span>
                <div className="min-w-0">
                  <p className="font-semibold">{tr(effectLabel(a.effect))}</p>
                  <AlertText summary={summaries.get(a.id)} original={a.header || a.shortHeader} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {entrances.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-slate-900">{tr('Which door to use')}</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-900">
            {entrances.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <StateIcon state={e.stepFree ? 'yes' : 'no'} />
                <span>
                  {e.name}: <strong>{tr(e.stepFree ? 'step-free' : 'stairs or escalator only')}</strong>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-700">{tr('Step-free means there is a working elevator or ramp path from this door right now.')}</p>
        </>
      )}
      {escalators.some((f) => f.closed) && (
        <p className="mt-2 text-sm text-slate-800">
          {tr('Escalators out of service: {list}', {
            list: escalators.filter((f) => f.closed).map((f) => f.shortName ?? f.name).join('; '),
          })}
        </p>
      )}

      {d && d.parking.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-slate-900">{tr('Parking')}</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-900">
            {d.parking.map((p) => (
              <li key={p.id}>
                {p.name}: {tr('{n} accessible spaces', { n: p.accessibleSpaces ?? tr('unknown') })}
                {p.capacity != null && ` ${tr('of {n} total', { n: p.capacity })}`}
                {p.feeDaily && ` · ${p.feeDaily}`}
                <span className="block text-xs text-slate-700">{tr('No live occupancy data.')}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-3 font-semibold text-slate-900">{tr('Next trains')}</h3>
      {preds.error && !preds.data && <p className="text-sm text-slate-800">{tr('Next trains are not available right now.')}</p>}
      {preds.data && demoEmpty && <p className="text-sm text-slate-800">{tr('Live train times unavailable right now.')}</p>}
      {preds.data && !demoEmpty && groups.length === 0 && (
        <p className="text-sm text-slate-800">{tr('No upcoming trains listed.')}</p>
      )}
      {!preds.data && !preds.error && <p className="text-sm text-slate-800">{tr('Loading next trains…')}</p>}
      <ul className="mt-1 space-y-1 text-sm text-slate-900">
        {groups.map((g) => {
          const heads = [...new Set(g.trains.map((t) => t.headsign ?? ''))];
          const sameHead = heads.length === 1;
          return (
            <li key={g.key}>
              {routeName(g.routeId)}
              {sameHead && heads[0] ? ` ${tr('to {headsign}', { headsign: heads[0] })}` : ''}:{' '}
              {g.trains.map((t, i) => (
                <span key={`${t.platformId}-${t.time}-${i}`}>
                  {i > 0 && (sameHead ? ', ' : ' · ')}
                  {!sameHead && t.headsign ? `${t.headsign} ` : ''}
                  <strong>{mins(t)}</strong>
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
