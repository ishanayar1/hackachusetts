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
  ROUTE_COLORS,
  routeName,
  stepFreeState,
  type StepFreeState,
} from '@/lib/ui/format';
import { useFacilities, usePredictions, useStationDetail } from '@/lib/ui/hooks';
import { AlertText, useAlertSummary } from './AlertSummary';
import {
  badge,
  badgeBad,
  badgeNeutral,
  badgeOk,
  badgeWarn,
  card,
  iconBtn,
  listItem,
  mutedText,
  Notice,
  pageTitle,
  sectionTitle,
  SourceBadge,
  StarButton,
  StateIcon,
  StateText,
} from './ui';
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

  const stateTone: Record<StepFreeState, string> = {
    yes: badgeOk,
    partial: badgeWarn,
    no: badgeBad,
    unknown: badgeNeutral,
  };
  const facilityRow = (f: (typeof lifts)[number]) => (
    <li key={f.id} className={listItem}>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-ink">{f.shortName ?? f.name}</p>
        <p className={mutedText}>{tr(facilityTypeWord(f.type))}</p>
        {f.closed && f.alternateServiceText && (
          <p className="mt-1 text-[13px] font-medium text-ink-2">
            {tr('MBTA suggests:')} {f.alternateServiceText}
          </p>
        )}
      </div>
      <span className={`${badge} ${f.closed ? badgeBad : badgeOk}`}>
        <span aria-hidden="true">{f.closed ? '✕' : '✓'}</span>
        {tr(f.closed ? 'Out of service' : 'Working')}
      </span>
    </li>
  );
  const bodyText = 'text-[14px] font-medium text-ink-2';

  return (
    <section aria-labelledby="station-h" className="lm-in space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="station-h" ref={headingRef} tabIndex={-1} className={`${pageTitle} outline-none`}>
            {station.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {station.routes.map((r) => (
              <span key={r} className={`${badge} ${badgeNeutral}`}>
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: ROUTE_COLORS[r] ?? 'var(--muted)' }}
                />
                {routeName(r)}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={iconBtn}
          onClick={onClose}
          aria-label={tr('Close {name} details', { name: station.name })}
          title={tr('Close')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${badge} ${stateTone[state]}`}>
          <StateText state={state} />
        </span>
        {onToggleSave && <StarButton saved={!!saved} name={station.name} onToggle={onToggleSave} />}
      </div>
      {state === 'no' && blockedBy.length > 0 && (
        <p className={bodyText}>
          {tr(blockedBy.length === 1 ? 'Because this is out of service: {list}' : 'Because these are out of service: {list}', {
            list: blockedBy.map(facilityName).join('; '),
          })}
        </p>
      )}
      {state === 'no' && blockedBy.length === 0 && (
        <p className={bodyText}>{tr('This station has no step-free route between the street and its platforms.')}</p>
      )}
      {state === 'partial' && (
        <ul className={`${bodyText} space-y-0.5`}>
          {partialLines(blockedPlatforms, blockedBy, facilityName).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {(d?.status.approximate ?? live?.approximate) && (
        <p className={mutedText}>{tr('Based on the MBTA station flag (no detailed elevator map).')}</p>
      )}
      <SourceBadge source={detail.data?.source} fetchedAt={detail.data?.fetchedAt} />
      {detail.error && !d && <Notice tone="error">{tr('Live station details are not available right now.')}</Notice>}

      {lifts.length > 0 && (
        <div className={card}>
          {/* Out-of-service equipment stays in view; the full list is folded because the map shows it. */}
          {lifts.some((f) => f.closed) && (
            <>
              <h3 className={sectionTitle}>{tr('Out of service here')}</h3>
              <ul className="mt-2 space-y-2">{lifts.filter((f) => f.closed).map((f) => facilityRow(f))}</ul>
            </>
          )}
          <details className={lifts.some((f) => f.closed) ? 'mt-2' : ''}>
            <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-bold text-ink">
              {tr('All elevators and lifts here ({n}), also on the map', { n: lifts.length })}
            </summary>
            <ul className="mt-2 space-y-2">{lifts.map((f) => facilityRow(f))}</ul>
          </details>
        </div>
      )}

      {entrances.length > 0 && (
        <div className={card}>
          <h3 className={sectionTitle}>{tr('Which door to use')}</h3>
          <ul className="mt-2 space-y-2">
            {entrances.map((e) => (
              <li key={e.id} className={listItem}>
                <span className="min-w-0 flex-1 text-[15px] font-bold text-ink">
                  {e.name}
                  <span className="sr-only">:</span>
                </span>
                <span className={`${badge} ${e.stepFree ? badgeOk : badgeBad}`}>
                  <StateIcon state={e.stepFree ? 'yes' : 'no'} size={14} />
                  {tr(e.stepFree ? 'step-free' : 'stairs or escalator only')}
                </span>
              </li>
            ))}
          </ul>
          <p className={`mt-2 ${mutedText}`}>
            {tr('Step-free means there is a working elevator or ramp path from this door right now.')}
          </p>
        </div>
      )}
      {escalators.some((f) => f.closed) && (
        <p className={`rounded-2xl bg-soft px-3.5 py-2.5 ${bodyText}`}>
          {tr('Escalators out of service: {list}', {
            list: escalators.filter((f) => f.closed).map((f) => f.shortName ?? f.name).join('; '),
          })}
        </p>
      )}

      <div className={card}>
        <h3 className={sectionTitle}>{tr('Next trains')}</h3>
        {preds.error && !preds.data && <p className={`mt-2 ${bodyText}`}>{tr('Next trains are not available right now.')}</p>}
        {preds.data && demoEmpty && <p className={`mt-2 ${bodyText}`}>{tr('Live train times unavailable right now.')}</p>}
        {preds.data && !demoEmpty && groups.length === 0 && (
          <p className={`mt-2 ${bodyText}`}>{tr('No upcoming trains listed.')}</p>
        )}
        {!preds.data && !preds.error && <p className={`mt-2 ${bodyText}`}>{tr('Loading next trains…')}</p>}
        <ul className="mt-2 space-y-2 empty:hidden">
          {groups.map((g) => {
            const heads = [...new Set(g.trains.map((t) => t.headsign ?? ''))];
            const sameHead = heads.length === 1;
            return (
              <li key={g.key} className={listItem}>
                <span
                  aria-hidden="true"
                  className="w-1.5 shrink-0 self-stretch rounded-full"
                  style={{ background: ROUTE_COLORS[g.routeId] ?? 'var(--muted)' }}
                />
                {/* DOM order reads "Red Line, to Alewife"; shown with the headsign on top. */}
                <div className="flex min-w-0 flex-1 flex-col-reverse">
                  {sameHead && heads[0] ? (
                    <>
                      <p className={mutedText}>{routeName(g.routeId)}</p>
                      <p className="text-[15px] font-bold text-ink">{tr('to {headsign}', { headsign: heads[0] })}</p>
                    </>
                  ) : (
                    <p className="text-[15px] font-bold text-ink">{routeName(g.routeId)}</p>
                  )}
                </div>
                <p className="flex shrink-0 flex-col items-end text-right">
                  <span className="sr-only">: </span>
                  {g.trains.map((t, i) => (
                    <span key={`${t.platformId}-${t.time}-${i}`} className="text-[18px] font-extrabold leading-tight text-ink">
                      {i > 0 && <span className="sr-only">{sameHead ? ', ' : ' · '}</span>}
                      {!sameHead && t.headsign ? (
                        <span className="mr-1.5 text-[13px] font-semibold text-muted">{t.headsign}</span>
                      ) : null}
                      {mins(t)}
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      {d && d.parking.length > 0 && (
        <div className={card}>
          <h3 className={sectionTitle}>{tr('Parking')}</h3>
          <ul className="mt-2 space-y-2">
            {d.parking.map((p) => (
              <li key={p.id} className={listItem}>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-ink">
                    {p.name}
                    <span className="sr-only">:</span>
                  </p>
                  <p className={bodyText}>
                    {tr('{n} accessible spaces', { n: p.accessibleSpaces ?? tr('unknown') })}
                    {p.capacity != null && ` ${tr('of {n} total', { n: p.capacity })}`}
                    {p.feeDaily && ` · ${p.feeDaily}`}
                  </p>
                  <p className={mutedText}>{tr('No live occupancy data.')}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stationAlerts.length > 0 && (
        <div className={card}>
          <h3 className={sectionTitle}>{tr('Accessibility alerts here')}</h3>
          <ul className="mt-2 space-y-2">
            {stationAlerts.map((a) => (
              <li key={a.id} className={listItem}>
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-bad-bg text-[16px] font-bold text-bad"
                >
                  ⚠
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-ink">{tr(effectLabel(a.effect))}</p>
                  <AlertText summary={summaries.get(a.id)} original={a.header || a.shortHeader} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
