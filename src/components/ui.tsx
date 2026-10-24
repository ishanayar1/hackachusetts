'use client';
// Small shared presentational pieces: status icons that match the map shapes, source badge, messages.
import type { DataSource } from '@/lib/mbta/types';
import { formatTime, STATE_TEXT, type StepFreeState } from '@/lib/ui/format';
import { useT } from '@/lib/i18n';

/** Same shapes as the map: filled green dot, green dot in an amber ring with "!", hollow red ring with ×, small grey dot. */
export function StateIcon({ state, size = 18 }: { state: StepFreeState; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      {state === 'yes' && <circle cx="10" cy="10" r="7" fill="#047857" stroke="#fff" strokeWidth="2" />}
      {state === 'partial' && (
        <>
          <circle cx="10" cy="10" r="7.5" fill="#047857" stroke="#b45309" strokeWidth="3" />
          <path d="M10 5.5v5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="10" cy="14" r="1.3" fill="#fff" />
        </>
      )}
      {state === 'no' && (
        <>
          <circle cx="10" cy="10" r="7" fill="#fff" stroke="#b91c1c" strokeWidth="3" />
          <path d="M7 7l6 6M13 7l-6 6" stroke="#b91c1c" strokeWidth="2" />
        </>
      )}
      {state === 'unknown' && <circle cx="10" cy="10" r="5" fill="#6b7280" stroke="#fff" strokeWidth="1.5" />}
    </svg>
  );
}

export function StateText({ state }: { state: StepFreeState }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateIcon state={state} />
      <span>{t(STATE_TEXT[state])}</span>
    </span>
  );
}

export function SourceBadge({ source, fetchedAt }: { source?: DataSource; fetchedAt?: string }) {
  const t = useT();
  if (!source || source === 'v3') return null;
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-700 bg-amber-50 px-2 py-1 text-sm text-amber-900">
      <span aria-hidden="true">⚠</span>
      {t('Showing saved data from {time}', { time: formatTime(fetchedAt) || t('earlier') })}
      {source === 'demo' ? ` (${t('demo snapshot')})` : ''}
    </p>
  );
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'error' }) {
  const cls =
    tone === 'error' ? 'border-red-700 bg-red-50 text-red-900' : 'border-slate-400 bg-slate-50 text-slate-800';
  return <p className={`rounded border px-3 py-2 text-sm ${cls}`}>{children}</p>;
}

export const btn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-700 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50';
export const btnPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50';

/** Star / unstar a station for "My stations". Text changes too, so state is not shown by the icon alone. */
export function StarButton({ saved, name, onToggle }: { saved: boolean; name: string; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className={btn}
      aria-pressed={saved}
      onClick={onToggle}
    >
      <span aria-hidden="true">{saved ? '★' : '☆'}</span>
      {t(saved ? 'Saved' : 'Save')}
      <span className="sr-only"> {t('{name} to My stations', { name })}</span>
    </button>
  );
}
