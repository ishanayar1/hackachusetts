'use client';
// Weather at a walk's start point (/api/weather, National Weather Service). Hidden when the API is down (503).
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import type { LatLon } from '@/lib/ui/walk';
import { useT } from '@/lib/i18n';

export type WeatherNow = {
  tempF: number;
  summary: string;
  precipChance: number | null;
  wind: string;
  alerts: { event: string; headline: string }[];
  walkNote: string | null;
};

/** Rounded to ~100 m so nearby points share one cached request. */
export function weatherUrl(p: LatLon): string {
  return `/api/weather?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`;
}

export function useWeather(p: LatLon | null) {
  return useSWR<ApiEnvelope<WeatherNow>>(p ? weatherUrl(p) : null, fetchJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: 10 * 60_000,
    refreshWhenHidden: false,
  });
}

export default function WeatherBox({ point, label }: { point: LatLon | null; label: string }) {
  const { data } = useWeather(point);
  const t = useT();
  const w = data?.data;
  if (!w) return null; // loading, outside the area, or weather.gov down: show nothing
  return (
    <div className="mt-2 rounded border border-sky-800 bg-sky-50 p-2 text-sm text-slate-900">
      <p className="font-semibold">
        <span aria-hidden="true">☁ </span>
        {t('Weather {label}', { label })}
      </p>
      <p>
        {Math.round(w.tempF)}°F, {w.summary}
        {w.precipChance != null && `, ${t('{n}% chance of rain or snow', { n: w.precipChance })}`}
        {w.wind && `, ${t('wind {w}', { w: w.wind })}`}.
      </p>
      {w.walkNote && (
        <p className="mt-1 flex items-start gap-1.5">
          <span aria-hidden="true">⚠</span>
          <span>{w.walkNote}</span>
        </p>
      )}
      {w.alerts.length > 0 && (
        <ul className="mt-1 space-y-1">
          {w.alerts.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span aria-hidden="true">⚠</span>
              <span>
                <strong>{a.event}:</strong> {a.headline}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-700">{t('Forecast for this hour from the National Weather Service.')}</p>
    </div>
  );
}
