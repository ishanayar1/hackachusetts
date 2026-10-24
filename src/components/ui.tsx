'use client';
// Small shared presentational pieces: status icons that match the map shapes, source badge, messages.
import type { DataSource } from '@/lib/mbta/types';
import { formatTime, STATE_TEXT, type StepFreeState } from '@/lib/ui/format';
import { useT } from '@/lib/i18n';

/** Same shapes as the map: green circle with a wheelchair, green in an amber ring with "!", red ring with ×, grey with "?". */
export function StateIcon({ state, size = 18 }: { state: StepFreeState; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      {state === 'yes' && (
        <>
          <circle cx="10" cy="10" r="8.5" fill="#047857" stroke="#fff" strokeWidth="1.5" />
          <circle cx="10.2" cy="5.2" r="1.4" fill="#fff" />
          <path
            d="M9.8 7.5V11.5H13.4L14.6 14.6M9.8 9.3H12.8M7.6 10.4A3.6 3.6 0 1 0 12.4 14.6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
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
      {state === 'unknown' && (
        <>
          <circle cx="10" cy="10" r="6.5" fill="#6b7280" stroke="#fff" strokeWidth="1.5" />
          <text x="10" y="13.3" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">
            ?
          </text>
        </>
      )}
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
    <p className={`${badge} ${badgeWarn} mt-2`}>
      <span aria-hidden="true">⚠</span>
      {t('Showing saved data from {time}', { time: formatTime(fetchedAt) || t('earlier') })}
      {source === 'demo' ? ` (${t('demo snapshot')})` : ''}
    </p>
  );
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'error' }) {
  const cls = tone === 'error' ? 'bg-bad-bg text-bad' : 'bg-soft text-ink-2';
  return <p className={`rounded-2xl px-3.5 py-2.5 text-[14px] font-semibold ${cls}`}>{children}</p>;
}

/*
 * Shared class strings (Transit Pop look, compact sizes). Type: body 15px, secondary 13-14px, buttons 15px bold,
 * section titles 16px, page titles 24px. Icons: 18px in buttons, 14-16px inline, 22px in the nav.
 */
const press = 'transition duration-200 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50';
export const btn = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-[15px] font-bold text-ink shadow-sh1 hover:border-line-2 hover:bg-soft hover:shadow-sh2 [&_svg]:size-[18px] ${press}`;
export const btnPrimary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-bold text-white shadow-sh2 hover:bg-[#2a2e37] hover:shadow-sh3 [&_svg]:size-[18px] ${press}`;
/** Quiet button on a soft grey fill (secondary actions, "Close"). */
export const btnGhost = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-soft px-4 text-[15px] font-bold text-ink hover:bg-soft-2 [&_svg]:size-[18px] ${press}`;
/** Round 44px icon-only button. Give it an aria-label. */
export const iconBtn = `inline-grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white text-ink shadow-sh2 hover:shadow-sh3 [&_svg]:size-5 ${press}`;
/** Toggle chip: add aria-pressed; the pressed state turns it dark. */
export const chip = `inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-3.5 text-[14px] font-bold text-ink hover:border-line-2 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white [&_svg]:size-4 ${press}`;
export const card = 'rounded-card border border-line bg-white p-4 shadow-sh1';
/** A card that lifts on hover (clickable rows). */
export const cardHover = `${card} transition duration-200 hover:-translate-y-px hover:shadow-sh2`;
/** Full-width tappable list row. */
export const listItem =
  'flex w-full items-start gap-3 rounded-[18px] border border-line bg-white p-3.5 text-left shadow-sh1 transition duration-200 hover:-translate-y-px hover:shadow-sh2';
export const badge =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-bold [&_svg]:size-3.5';
export const badgeOk = 'bg-ok-bg text-ok';
export const badgeWarn = 'bg-warn-bg text-warn';
export const badgeBad = 'bg-bad-bg text-bad';
export const badgeNeutral = 'border border-line bg-soft text-ink-2';
export const input =
  'min-h-12 w-full rounded-2xl border border-line bg-white px-4 text-[15px] font-semibold text-ink shadow-sh1 outline-none transition placeholder:font-medium placeholder:text-muted focus:border-t-blue focus:ring-4 focus:ring-t-blue/15';
export const pageTitle = 'text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-ink';
export const sectionTitle = 'text-[16px] font-bold tracking-[-0.01em] text-ink';
export const mutedText = 'text-[13px] font-medium text-muted';
/** Small stat tile: big number on top, label below. */
export const statTile = 'flex-1 rounded-[18px] border border-line bg-soft p-3.5';
export const statNumber = 'text-[28px] font-extrabold leading-none tracking-[-0.03em] text-ink';

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
