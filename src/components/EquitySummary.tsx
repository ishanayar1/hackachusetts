'use client';
// Who is affected right now: people in environmental-justice block groups near stations that are not step-free.
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import { card, mutedText, sectionTitle, StateIcon, statNumber } from './ui';
import { useT } from '@/lib/i18n';

export type EquityRow = {
  stationId: string;
  name: string;
  status: 'not step-free' | 'partly step-free';
  ejPopulationWithin800m: number;
  ejBlockGroups: number;
  limitedEnglishPct: number | null;
};
export type EquityData = { blockedStations: EquityRow[]; totalEjPopulationAffected: number; radiusM: number };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export default function EquitySummary({ onSelectStation }: { onSelectStation: (id: string) => void }) {
  const { data, error } = useSWR<ApiEnvelope<EquityData>>('/api/equity', fetchJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: 5 * 60_000,
    refreshWhenHidden: false,
  });
  const t = useT();
  const en = t.lang === 'en';
  const d = data?.data;
  if (error && !d) return null;
  if (!d)
    return (
      <p className={`mt-3 ${mutedText}`}>
        <span className="lm-shimmer mb-2 block h-24 rounded-card" aria-hidden="true" />
        {t('Loading who is affected…')}
      </p>
    );
  const rows = d.blockedStations.filter((r) => r.ejPopulationWithin800m > 0);
  const km = d.radiusM >= 1000 ? `${d.radiusM / 1000} km` : `${d.radiusM} m`;
  return (
    <section aria-labelledby="equity-h" className={`${card} mt-3 text-ink`}>
      <h3 id="equity-h" className={sectionTitle}>
        {t('Who is affected')}
      </h3>
      <div className="mt-3 rounded-[18px] border border-line bg-soft p-3.5" aria-hidden="true">
        <div className={statNumber}>{fmt(d.totalEjPopulationAffected)}</div>
        <div className={`mt-1 ${mutedText}`}>{t('people near a station that is not step-free')}</div>
      </div>
      {en ? (
        <p className="mt-2 text-[14px] font-medium leading-relaxed text-ink-2">
          About <strong className="text-ink">{fmt(d.totalEjPopulationAffected)} people</strong> in environmental-justice neighborhoods live
          within {km} of a station that is not step-free right now.
        </p>
      ) : (
        <p className="mt-2 text-[14px] font-medium leading-relaxed text-ink-2">
          {t('About {n} people in environmental-justice neighborhoods live within {km} of a station that is not step-free right now.', {
            n: fmt(d.totalEjPopulationAffected),
            km,
          })}
        </p>
      )}
      {rows.length > 0 && (
        <details className="group mt-2 text-[14px]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-full bg-soft px-4 font-bold text-ink transition duration-200 hover:bg-soft-2 [&::-webkit-details-marker]:hidden">
            {en ? `Show the ${rows.length} ${rows.length === 1 ? 'station' : 'stations'}` : t('Show the stations ({n})', { n: rows.length })}
            <svg viewBox="0 0 16 16" className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <ul className="mt-2 space-y-2">
            {rows.map((r) => (
              <li key={r.stationId} className="flex items-start gap-3 rounded-[18px] border border-line bg-white p-3 shadow-sh1">
                <span className="mt-3">
                  <StateIcon state={r.status === 'partly step-free' ? 'partial' : 'no'} size={16} />
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink-2">
                  <button
                    type="button"
                    className="min-h-11 text-left text-[15px] font-bold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                    onClick={() => onSelectStation(r.stationId)}
                  >
                    {r.name}
                  </button>{' '}
                  ({t(r.status)}): {t('about {n} people nearby', { n: fmt(r.ejPopulationWithin800m) })}
                  {r.limitedEnglishPct != null && `, ${t('{pct}% with limited English', { pct: r.limitedEnglishPct })}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className={`mt-3 ${mutedText}`}>
        {t('Massachusetts 2020 environmental-justice block groups (census). Station counts overlap; the total counts each neighborhood once.')}
      </p>
    </section>
  );
}
