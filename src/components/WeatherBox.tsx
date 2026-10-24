'use client';
// Weather at a walk's start point (/api/weather, National Weather Service). Hidden when the API is down (503).
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import type { LatLon } from '@/lib/ui/walk';
import { useT } from '@/lib/i18n';
import { mutedText } from './ui';

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
    <div className="mt-2 rounded-card border border-line bg-soft p-3.5 text-[14px] text-ink">
      <p className="flex items-center gap-2 text-[14px] font-bold text-ink">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-t-blue shadow-sh1">
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M6 15.5h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 5.3 9.6 3 3 0 0 0 6 15.5z" />
          </svg>
        </span>
        {t('Weather {label}', { label })}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <span aria-hidden="true" className="text-[28px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
          {Math.round(w.tempF)}°
        </span>
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink-2">
          {Math.round(w.tempF)}°F, {w.summary}
          {w.precipChance != null && `, ${t('{n}% chance of rain or snow', { n: w.precipChance })}`}
          {w.wind && `, ${t('wind {w}', { w: w.wind })}`}.
        </p>
      </div>
      {w.walkNote && (
        <p className="mt-2 flex items-start gap-1.5 rounded-2xl bg-warn-bg px-3 py-2 text-[13px] font-semibold text-warn">
          <span aria-hidden="true">⚠</span>
          <span>{w.walkNote}</span>
        </p>
      )}
      {w.alerts.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {w.alerts.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5 rounded-2xl bg-bad-bg px-3 py-2 text-[13px] font-medium text-bad">
              <span aria-hidden="true">⚠</span>
              <span>
                <strong className="font-bold">{a.event}:</strong> {a.headline}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={`mt-2 ${mutedText}`}>{t('Forecast for this hour from the National Weather Service.')}</p>
    </div>
  );
}
