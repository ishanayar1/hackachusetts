'use client';
// "Broken now": live accessibility alerts first, then other subway disruptions.
import { useMemo, useState } from 'react';
import type { NormalizedAlert, Station } from '@/lib/ui/api';
import { ACCESS_EFFECTS, alertActive, alertDatesKnown, effectLabel, formatTime } from '@/lib/ui/format';
import { useAlerts } from '@/lib/ui/hooks';
import { AlertText, useAlertSummary, type PlainAlert } from './AlertSummary';
import EquitySummary from './EquitySummary';
import { Notice, SourceBadge } from './ui';
import { useT } from '@/lib/i18n';

function EffectIcon({ effect }: { effect: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'shrink-0' } as const;
  if (effect === 'ELEVATOR_CLOSURE')
    return (
      <svg {...common}>
        <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="#b91c1c" strokeWidth="2" />
        <path d="M9 9l3-3 3 3M9 15l3 3 3-3" fill="none" stroke="#b91c1c" strokeWidth="2" />
      </svg>
    );
  if (effect === 'ESCALATOR_CLOSURE')
    return (
      <svg {...common}>
        <path d="M3 20h5l8-12h5" fill="none" stroke="#9a3412" strokeWidth="2.5" />
      </svg>
    );
  if (effect === 'ACCESS_ISSUE')
    return (
      <svg {...common}>
        <circle cx="12" cy="4" r="2" fill="#b91c1c" />
        <path d="M12 7v6h5l2 6M12 10H8" fill="none" stroke="#b91c1c" strokeWidth="2" />
        <circle cx="10" cy="17" r="4" fill="none" stroke="#b91c1c" strokeWidth="2" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3l10 18H2z" fill="none" stroke="#334155" strokeWidth="2" />
      <path d="M12 10v5M12 17v1.5" stroke="#334155" strokeWidth="2" />
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
    <li className="rounded-md border border-slate-300 bg-white p-3">
      <div className="flex items-start gap-2">
        <EffectIcon effect={alert.effect} />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {t(effectLabel(alert.effect))}
            {!active && <span className="font-normal text-slate-700"> ({t('not active right now')})</span>}
          </p>
          {names.length > 0 && (
            <p className="text-sm text-slate-800">
              {t(names.length === 1 ? 'Station:' : 'Stations:')}{' '}
              {names.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <button
                    type="button"
                    className="min-h-11 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950"
                    onClick={() => onSelectStation(s.id)}
                  >
                    {s.name}
                  </button>
                </span>
              ))}
            </p>
          )}
          <AlertText summary={summary} original={alert.header || alert.shortHeader} />
          {!datesKnown && <p className="mt-1 text-xs text-slate-700">{t('Start date not announced')}</p>}
          {datesKnown && period && (
            <p className="mt-1 text-xs text-slate-700">
              {period.start && <>{t('Since {time}', { time: formatTime(period.start) })}</>}
              {period.end && <> · {t('Until {time}', { time: formatTime(period.end) })}</>}
            </p>
          )}
        </div>
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
    <section aria-labelledby="broken-h">
      <h2 id="broken-h" className="text-lg font-bold text-slate-900">
        {t('Broken now')}
      </h2>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-slate-900">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={includeEscalators}
          onChange={(e) => setIncludeEscalators(e.target.checked)}
        />
        {t('Include escalators')}
      </label>
      <p aria-live="polite" className="text-sm text-slate-800">
        {isLoading ? t('Loading live alerts…') : summary}
      </p>
      <SourceBadge source={data?.source} fetchedAt={data?.fetchedAt} />
      {error && !data && <Notice tone="error">{t('Live alerts are not available right now. Try again in a minute.')}</Notice>}
      <EquitySummary onSelectStation={onSelectStation} />

      {access.length > 0 && (
        <>
          <h3 className="mt-3 font-semibold text-slate-900">{t('Elevators, escalators and access')}</h3>
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
      {data && access.length === 0 && <Notice>{t('No elevator, escalator or access alerts reported right now.')}</Notice>}
      {other.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold text-slate-900">{t('Other subway disruptions')}</h3>
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
