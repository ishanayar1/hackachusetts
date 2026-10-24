'use client';
// Who is affected right now: people in environmental-justice block groups near stations that are not step-free.
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import { StateIcon } from './ui';
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
  if (!d) return <p className="mt-3 text-sm text-slate-800">{t('Loading who is affected…')}</p>;
  const rows = d.blockedStations.filter((r) => r.ejPopulationWithin800m > 0);
  const km = d.radiusM >= 1000 ? `${d.radiusM / 1000} km` : `${d.radiusM} m`;
  return (
    <section aria-labelledby="equity-h" className="mt-3 rounded-md border border-slate-400 bg-white p-3 text-slate-900">
      <h3 id="equity-h" className="font-semibold">
        {t('Who is affected')}
      </h3>
      {en ? (
        <p className="mt-1 text-sm">
          About <strong>{fmt(d.totalEjPopulationAffected)} people</strong> in environmental-justice neighborhoods live
          within {km} of a station that is not step-free right now.
        </p>
      ) : (
        <p className="mt-1 text-sm">
          {t('About {n} people in environmental-justice neighborhoods live within {km} of a station that is not step-free right now.', {
            n: fmt(d.totalEjPopulationAffected),
            km,
          })}
        </p>
      )}
      {rows.length > 0 && (
        <details className="mt-1 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-blue-800 underline">
            {en ? `Show the ${rows.length} ${rows.length === 1 ? 'station' : 'stations'}` : t('Show the stations ({n})', { n: rows.length })}
          </summary>
          <ul className="mt-1 space-y-1">
            {rows.map((r) => (
              <li key={r.stationId} className="flex items-start gap-1.5">
                <StateIcon state={r.status === 'partly step-free' ? 'partial' : 'no'} />
                <span>
                  <button
                    type="button"
                    className="min-h-11 font-semibold text-blue-800 underline underline-offset-2"
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
      <p className="mt-1 text-xs text-slate-700">
        {t('Massachusetts 2020 environmental-justice block groups (census). Station counts overlap; the total counts each neighborhood once.')}
      </p>
    </section>
  );
}
