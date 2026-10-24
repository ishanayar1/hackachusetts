'use client';
// "Bluebikes near you": a backup for riders who can bike (/api/bluebikes, live GBFS counts).
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import { formatDistance, type LatLon } from '@/lib/ui/walk';
import { useT } from '@/lib/i18n';

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
    <div className="mt-2 rounded border border-slate-400 bg-white p-2 text-sm text-slate-900">
      <p className="font-semibold">
        <span aria-hidden="true">🚲 </span>
        {t('Bluebikes {label} (backup if you can bike)', { label: label ?? t('near you') })}
      </p>
      <p className="text-slate-800">
        {t('Only useful if you can ride a bike. Bluebikes are standard bikes and e-bikes, not adapted cycles.')}
      </p>
      {error && !data && <p className="mt-1 text-slate-800">{t('Bluebikes data is not available right now.')}</p>}
      {data && rows.length === 0 && <p className="mt-1 text-slate-800">{t('No Bluebikes station within 500 m.')}</p>}
      {rows.length > 0 && (
        <ul className="mt-1 space-y-1">
          {rows.map((s) =>
            en ? (
              <li key={s.id}>
                <strong>{s.name}</strong> ({formatDistance(s.distanceM)}): {s.bikes} {s.bikes === 1 ? 'bike' : 'bikes'}
                {s.ebikes > 0 && ` (${s.ebikes} electric)`}, {s.docks} empty {s.docks === 1 ? 'dock' : 'docks'}
                {!s.renting && ' · not renting right now'}
              </li>
            ) : (
              <li key={s.id}>
                <strong>{s.name}</strong> ({formatDistance(s.distanceM)}):{' '}
                {t('Bikes: {b} (electric: {e}), empty docks: {d}', { b: s.bikes, e: s.ebikes, d: s.docks })}
                {!s.renting && ` · ${t('not renting right now')}`}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
