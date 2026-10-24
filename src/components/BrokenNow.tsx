'use client';
// "Broken now": live accessibility alerts first, then other subway disruptions.
import { useMemo, useState } from 'react';
import type { NormalizedAlert, Station } from '@/lib/ui/api';
import { ACCESS_EFFECTS, alertActive, alertDatesKnown, effectLabel, formatTime } from '@/lib/ui/format';
import { useAlerts } from '@/lib/ui/hooks';
import { AlertText, useAlertSummary, type PlainAlert } from './AlertSummary';
import EquitySummary from './EquitySummary';
import {
  badge,
  badgeBad,
  badgeNeutral,
  badgeWarn,
  chip,
  listItem,
  mutedText,
  Notice,
  pageTitle,
  sectionTitle,
  SourceBadge,
  statNumber,
  statTile,
} from './ui';
import { useT } from '@/lib/i18n';

/** Icon tile tone per effect: elevator/access red, escalator amber, other disruptions grey. */
function effectTone(effect: string) {
  if (effect === 'ELEVATOR_CLOSURE' || effect === 'ACCESS_ISSUE') return 'bg-bad-bg text-bad';
  if (effect === 'ESCALATOR_CLOSURE') return 'bg-warn-bg text-warn';
  return 'bg-soft text-ink-2';
}

function EffectIcon({ effect }: { effect: string }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'shrink-0' } as const;
  if (effect === 'ELEVATOR_CLOSURE')
    return (
      <svg {...common}>
        <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M9 9l3-3 3 3M9 15l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  if (effect === 'ESCALATOR_CLOSURE')
    return (
      <svg {...common}>
        <path d="M3 20h5l8-12h5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    );
  if (effect === 'ACCESS_ISSUE')
    return (
      <svg {...common}>
        <circle cx="12" cy="4" r="2" fill="currentColor" />
        <path d="M12 7v6h5l2 6M12 10H8" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="10" cy="17" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3l10 18H2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v5M12 17v1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function AlertItem({
  alert,
  stationsById,
  onSelectStation,
  summary,
}: {
  alert: NormalizedAlert;
  stationsById: Map<string, Station>;
  onSelectStation: (id: string) => void;
  /** Plain-language text from /api/alert-summary (accessibility alerts only). */
  summary?: PlainAlert;
}) {
  const period = alert.activePeriods[0];
  const datesKnown = alertDatesKnown(alert);
  const active = alertActive(alert);
  const names = alert.stationIds.map((id) => ({ id, name: stationsById.get(id)?.name })).filter((s) => s.name);
  const t = useT();
  return (
    <li className={listItem}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${effectTone(alert.effect)}`}>
        <EffectIcon effect={alert.effect} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span
            className={`${badge} ${
              !active ? badgeNeutral : ACCESS_EFFECTS.has(alert.effect) ? badgeBad : badgeWarn
            }`}
          >
            {t(effectLabel(alert.effect))}
          </span>
          {!active && <span className={mutedText}> ({t('not active right now')})</span>}
        </p>
        {names.length > 0 && (
          <p className="mt-0.5 text-[14px] font-medium text-ink-2">
            {t(names.length === 1 ? 'Station:' : 'Stations:')}{' '}
            {names.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="min-h-11 text-[15px] font-bold text-ink underline decoration-line-2 underline-offset-4 transition hover:decoration-ink"
                  onClick={() => onSelectStation(s.id)}
                >
                  {s.name}
                </button>
              </span>
            ))}
          </p>
        )}
        <AlertText summary={summary} original={alert.header || alert.shortHeader} />
        {!datesKnown && <p className={`mt-1.5 ${mutedText}`}>{t('Start date not announced')}</p>}
        {datesKnown && period && (
          <p className={`mt-1.5 ${mutedText}`}>
            {period.start && <>{t('Since {time}', { time: formatTime(period.start) })}</>}
            {period.end && <> · {t('Until {time}', { time: formatTime(period.end) })}</>}
          </p>
        )}
      </div>
    </li>
  );
}

export default function BrokenNow({
  stationsById,
  onSelectStation,
}: {
  stationsById: Map<string, Station>;
  onSelectStation: (id: string) => void;
}) {
  const { data, error, isLoading } = useAlerts();
  const [includeEscalators, setIncludeEscalators] = useState(true);
  const summaries = useAlertSummary();

  const { access, other } = useMemo(() => {
    // Informational notices (parking, amenities) are not disruptions: left out of the lists and counts.
    const alerts = (data?.data.alerts ?? [])
      .filter((a) => !a.informational)
      .sort((a, b) => Number(alertActive(b)) - Number(alertActive(a)) || b.severity - a.severity);
    return {
      access: alerts.filter(
        (a) => ACCESS_EFFECTS.has(a.effect) && (includeEscalators || a.effect !== 'ESCALATOR_CLOSURE'),
      ),
      other: alerts.filter((a) => !ACCESS_EFFECTS.has(a.effect)),
    };
  }, [data, includeEscalators]);

  const elevators = access.filter((a) => a.effect === 'ELEVATOR_CLOSURE' && alertActive(a)).length;
  const t = useT();
  const summary = data && t.lang !== 'en'
    ? t('Accessibility alerts: {a} (elevators out now: {e}). Other subway disruptions: {o}.', {
        a: access.length,
        e: elevators,
        o: other.length,
      })
    : data
    ? `${access.length} accessibility ${access.length === 1 ? 'alert' : 'alerts'} (${elevators} elevator${
        elevators === 1 ? '' : 's'
      } out now), ${other.length} other subway ${other.length === 1 ? 'disruption' : 'disruptions'}.`
    : '';

  return (
    <section aria-labelledby="broken-h" className="lm-in">
      <h2 id="broken-h" className={pageTitle}>
        {t('Broken now')}
      </h2>
      {/* Visual counts; the live sentence below carries the same numbers for screen readers. */}
      {data && (
        <div aria-hidden="true" className="mt-3 flex gap-2">
          <div className={statTile}>
            <p className={statNumber}>{access.length}</p>
            <p className={`mt-1 ${mutedText}`}>{t('Access alerts')}</p>
          </div>
          <div className={statTile}>
            <p className={statNumber}>{elevators}</p>
            <p className={`mt-1 ${mutedText}`}>{t('Elevators out now')}</p>
          </div>
          <div className={statTile}>
            <p className={statNumber}>{other.length}</p>
            <p className={`mt-1 ${mutedText}`}>{t('Other disruptions')}</p>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={chip}
          aria-pressed={includeEscalators}
          onClick={() => setIncludeEscalators((v) => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            {includeEscalators ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M3 20h5l8-12h5" />}
          </svg>
          {t('Include escalators')}
        </button>
      </div>
      <p aria-live="polite" className={data && !isLoading ? 'sr-only' : 'mt-2 text-[14px] font-medium text-ink-2'}>
        {isLoading ? t('Loading live alerts…') : summary}
      </p>
      <SourceBadge source={data?.source} fetchedAt={data?.fetchedAt} />
      {error && !data && <Notice tone="error">{t('Live alerts are not available right now. Try again in a minute.')}</Notice>}
      <EquitySummary onSelectStation={onSelectStation} />

      {access.length > 0 && (
        <>
          <h3 className={`mt-5 ${sectionTitle}`}>{t('Elevators, escalators and access')}</h3>
          <ul className="mt-2 space-y-2">
            {access.map((a) => (
              <AlertItem
                key={a.id}
                alert={a}
                stationsById={stationsById}
                onSelectStation={onSelectStation}
                summary={summaries.get(a.id)}
              />
            ))}
          </ul>
        </>
      )}
      {data && access.length === 0 && (
        <div className="mt-3">
          <Notice>{t('No elevator, escalator or access alerts reported right now.')}</Notice>
        </div>
      )}
      {other.length > 0 && (
        <>
          <h3 className={`mt-5 ${sectionTitle}`}>{t('Other subway disruptions')}</h3>
          <ul className="mt-2 space-y-2">
            {other.map((a) => (
              <AlertItem key={a.id} alert={a} stationsById={stationsById} onSelectStation={onSelectStation} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
