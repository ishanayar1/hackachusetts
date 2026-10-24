'use client';
// "My stations": starred stations with step-free status now and any active accessibility alert.
import type { Station, StationStatusRow } from '@/lib/ui/api';
import {
  ACCESS_EFFECTS,
  alertActive,
  effectLabel,
  partialLines,
  ROUTE_COLORS,
  stepFreeState,
  type StepFreeState,
} from '@/lib/ui/format';
import { useAlerts, useFacilities } from '@/lib/ui/hooks';
import {
  badge,
  badgeBad,
  badgeNeutral,
  badgeOk,
  badgeWarn,
  listItem,
  mutedText,
  pageTitle,
  StarButton,
  StateText,
} from './ui';

const STATE_TONE: Record<StepFreeState, string> = { yes: badgeOk, partial: badgeWarn, no: badgeBad, unknown: badgeNeutral };

/** Line color(s) for the small station tile; a split tile when the station serves more than one line. */
function tileBackground(routes: string[]) {
  const colors = [...new Set(routes.map((r) => ROUTE_COLORS[r]).filter(Boolean))];
  if (colors.length === 0) return 'var(--muted)';
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  return `linear-gradient(135deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}
import { useT } from '@/lib/i18n';

export default function MyStations({
  ids,
  byId,
  live,
  onSelectStation,
  onToggle,
}: {
  ids: string[];
  byId: Map<string, Station>;
  live: Map<string, StationStatusRow>;
  onSelectStation: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { data } = useAlerts();
  const { byId: facilities } = useFacilities();
  const alerts = (data?.data.alerts ?? []).filter(
    (a) => !a.informational && alertActive(a) && ACCESS_EFFECTS.has(a.effect),
  );
  const facilityName = (id: string) => facilities.get(id)?.shortName ?? facilities.get(id)?.name ?? id;
  const saved = ids.map((id) => byId.get(id)).filter((s): s is Station => !!s);
  const t = useT();

  return (
    <section aria-labelledby="mine-h" className="lm-in">
      <h2 id="mine-h" className={pageTitle}>
        <span aria-hidden="true" className="text-t-yellow">★ </span>
        {t('My stations')}
      </h2>
      {saved.length === 0 ? (
        <p className="mt-3 rounded-[18px] border border-dashed border-line-2 bg-soft p-4 text-[14px] font-medium text-ink-2">
          {t('No saved stations yet. Open a station and choose Save to see it here.')}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {saved.map((s) => {
            const row = live.get(s.id);
            const state = stepFreeState(s, row);
            const mine = alerts.filter((a) => a.stationIds.includes(s.id));
            return (
              <li key={s.id} className={listItem}>
                <span
                  aria-hidden="true"
                  className="mt-2 size-[30px] shrink-0 rounded-[10px] shadow-sh1"
                  style={{ background: tileBackground(s.routes) }}
                />
                <div className="min-w-0 flex-1 text-[14px] text-ink-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="min-h-11 min-w-0 text-left text-[15px] font-bold text-ink underline decoration-line-2 underline-offset-4 transition hover:decoration-ink"
                      onClick={() => onSelectStation(s.id)}
                    >
                      {s.name}
                    </button>
                    <StarButton saved name={s.name} onToggle={() => onToggle(s.id)} />
                  </div>
                  <span className={`${badge} ${STATE_TONE[state]} mt-1`}>
                    <StateText state={state} />
                  </span>
                  {state === 'no' && row && row.blockedBy.length > 0 && (
                    <p className="mt-1.5 font-medium">
                      {t('Out of service: {list}', { list: row.blockedBy.map(facilityName).join('; ') })}
                    </p>
                  )}
                  {state === 'partial' && row && (
                    <ul className="mt-1.5 space-y-0.5 font-medium">
                      {partialLines(row.blockedPlatforms, row.blockedBy ?? [], facilityName).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {mine.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {mine.map((a) => (
                        <li key={a.id} className="flex items-start gap-2 rounded-xl bg-bad-bg px-3 py-2 text-ink">
                          <span aria-hidden="true" className="font-bold text-bad">
                            ⚠
                          </span>
                          <span>
                            <strong>{t(effectLabel(a.effect))}:</strong> {a.shortHeader || a.header}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    data && <p className={`mt-1.5 ${mutedText}`}>{t('No active accessibility alerts.')}</p>
                  )}
                  <PhoneAlerts stationId={s.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {saved.length > 0 && (
        <p className={`mt-3 ${mutedText}`}>
          {t('Alerts in this app update while it is open. For alerts when it is closed, use phone alerts below each station.')}
        </p>
      )}
    </section>
  );
}

/** Phone push via ntfy.sh: the server posts new accessibility alerts for a station to topic lastmile-<stationId>. */
function PhoneAlerts({ stationId }: { stationId: string }) {
  const topic = `lastmile-${stationId}`;
  const t = useT();
  return (
    <details className="mt-1">
      <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-bold text-t-blue underline decoration-t-blue/30 underline-offset-4 hover:decoration-t-blue">
        {t('Get phone alerts')}
      </summary>
      <p>
        {t('Topic:')} <code className="rounded-lg border border-line bg-soft px-1.5 py-0.5 text-[13px] text-ink">{topic}</code>
      </p>
      <p>
        <a
          href={`https://ntfy.sh/${topic}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center font-bold text-t-blue underline underline-offset-4"
        >
          ntfy.sh/{topic}
          <span className="sr-only"> {t('(opens in a new tab)')}</span>
        </a>
      </p>
      <p>{t('Install the free ntfy app and subscribe to this topic.')}</p>
    </details>
  );
}
