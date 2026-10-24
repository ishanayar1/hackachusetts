'use client';
// "Bluebikes near you": a backup for riders who can bike (/api/bluebikes, live GBFS counts).
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import { formatDistance, type LatLon } from '@/lib/ui/walk';
import { useT } from '@/lib/i18n';
import { mutedText } from './ui';

export type BikeStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  bikes: number;
  ebikes: number;
  docks: number;
  renting: boolean;
};

export function useBluebikes(p: LatLon | null, radius = 500) {
  return useSWR<ApiEnvelope<{ stations: BikeStation[] }>>(
    p ? `/api/bluebikes?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&radius=${radius}` : null,
    fetchJson,
    { revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: 60_000, refreshWhenHidden: false },
  );
}

export default function BluebikesBox({ point, label }: { point: LatLon | null; label?: string }) {
  const { data, error } = useBluebikes(point);
  const t = useT();
  if (!point) return null;
  const rows = (data?.data.stations ?? []).slice(0, 3);
  const en = t.lang === 'en';
  return (
    <div className="mt-2 rounded-card border border-line bg-soft p-3.5 text-[14px] text-ink">
      <p className="flex items-center gap-2 text-[14px] font-bold text-ink">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-[#1F7EC1] shadow-sh1">
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="13.5" r="3" />
            <circle cx="15" cy="13.5" r="3" />
            <path d="M5 13.5L8.5 7h5L15 13.5M8.5 7L10.5 13.5h-5.5M11.5 4.5h2.5" />
          </svg>
        </span>
        {t('Bluebikes {label} (backup if you can bike)', { label: label ?? t('near you') })}
      </p>
      <p className={`mt-1 ${mutedText}`}>
        {t('Only useful if you can ride a bike. Bluebikes are standard bikes and e-bikes, not adapted cycles.')}
      </p>
      {error && !data && <p className={`mt-2 ${mutedText}`}>{t('Bluebikes data is not available right now.')}</p>}
      {data && rows.length === 0 && <p className={`mt-2 ${mutedText}`}>{t('No Bluebikes station within 500 m.')}</p>}
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-[18px] border border-line bg-white p-3 shadow-sh1">
              <span aria-hidden="true" className="w-10 shrink-0 text-center">
                <span className="block text-[28px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
                  {s.bikes}
                </span>
              </span>
              {en ? (
                <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink-2">
                  <strong className="block text-[14px] font-bold text-ink">{s.name}</strong> ({formatDistance(s.distanceM)}):{' '}
                  {s.bikes} {s.bikes === 1 ? 'bike' : 'bikes'}
                  {s.ebikes > 0 && ` (${s.ebikes} electric)`}, {s.docks} empty {s.docks === 1 ? 'dock' : 'docks'}
                  {!s.renting && ' · not renting right now'}
                </span>
              ) : (
                <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink-2">
                  <strong className="block text-[14px] font-bold text-ink">{s.name}</strong> ({formatDistance(s.distanceM)}):{' '}
                  {t('Bikes: {b} (electric: {e}), empty docks: {d}', { b: s.bikes, e: s.ebikes, d: s.docks })}
                  {!s.renting && ` · ${t('not renting right now')}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
