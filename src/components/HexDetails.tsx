'use client';
// Text details for the crash intersection selected on the map or in the list.
import type { CrashHex } from '@/lib/ui/api';
import { binLabel, RECORDED_BINS } from '@/lib/ui/format';
import { card, iconBtn, mutedText } from './ui';
import { useT } from '@/lib/i18n';

const body = 'text-[14px] font-medium leading-relaxed text-ink-2';

export default function HexDetails({
  hex,
  showModel,
  onClose,
}: {
  hex: CrashHex;
  /** Only show the team model's number when the viewer chose the model layer (recorded history is the default). */
  showModel: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <section aria-labelledby="hex-h" className={`${card} lm-in rounded-sheet p-5 shadow-sh2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="hex-h" className="text-[18px] font-bold leading-snug tracking-[-0.01em] text-ink">
            {t('Intersection: {label}', { label: hex.label })}
          </h2>
          {hex.neighborhood && <p className={`mt-0.5 ${mutedText}`}>{hex.neighborhood}</p>}
        </div>
        <button type="button" className={iconBtn} onClick={onClose} aria-label={t('Close intersection details')}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="sr-only">{t('Close')}</span>
        </button>
      </div>
      <div className="mt-3 flex gap-2" aria-hidden="true">
        {(
          [
            ['ped', hex.ped, t('pedestrian'), 'bg-t-red'],
            ['bike', hex.bike, t('bike'), 'bg-t-orange'],
            ['total', hex.total, t('total'), 'bg-ink'],
          ] as [string, number, string, string][]
        ).map(([key, n, label, dot]) => (
          <div key={key} className="flex-1 rounded-[18px] border border-line bg-soft px-3 py-2.5">
            <div className="text-[22px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">{n}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-muted">
              <span className={`size-2 rounded-full ${dot}`} />
              {label}
            </div>
          </div>
        ))}
      </div>
      {t.lang === 'en' ? (
        <p className={`mt-3 ${body}`}>
          Recorded at this intersection (police-reported, 2015 to Aug 2026): <strong className="text-ink">{hex.ped}</strong> pedestrian,{' '}
          <strong className="text-ink">{hex.bike}</strong> bike, <strong className="text-ink">{hex.mv}</strong> motor vehicle,{' '}
          <strong className="text-ink">{hex.total}</strong> total.
        </p>
      ) : (
        <p className={`mt-3 ${body}`}>
          {t('Recorded at this intersection (police-reported, 2015 to Aug 2026): {p} pedestrian, {b} bike, {mv} motor vehicle, {t} total.', {
            p: hex.ped,
            b: hex.bike,
            mv: hex.mv,
            t: hex.total,
          })}
        </p>
      )}
      <p className={`mt-1 ${body}`}>
        {t('Map shading group: {bin} pedestrian & bike.', { bin: t(binLabel(hex.pedBike, RECORDED_BINS)) })}
      </p>
      {(hex.first || hex.last) && (
        <p className={`mt-1 ${body}`}>
          {t('First recorded {first}, most recent {last}.', { first: hex.first ?? t('unknown'), last: hex.last ?? t('unknown') })}
        </p>
      )}
      {showModel && (
        <p className="mt-3 rounded-2xl bg-warn-bg px-3.5 py-2.5 text-[13px] font-semibold text-warn">
          {t('Team model: about {n} crashes a year. Model estimate from police-reported crashes. Not a guarantee.', {
            n: hex.estimatePerYear.toFixed(1),
          })}
        </p>
      )}
      <p className={`mt-3 border-t border-line pt-3 ${mutedText}`}>
        {t('Historical, not live. Counts only crashes recorded at the intersection, not mid-block.')}
      </p>
    </section>
  );
}
