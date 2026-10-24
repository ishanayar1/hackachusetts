'use client';
// Text details for the crash intersection selected on the map or in the list.
import type { CrashHex } from '@/lib/ui/api';
import { binLabel, RECORDED_BINS } from '@/lib/ui/format';
import { btn } from './ui';
import { useT } from '@/lib/i18n';

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
    <section aria-labelledby="hex-h" className="rounded-md border border-slate-400 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 id="hex-h" className="text-base font-bold text-slate-900">
          {t('Intersection: {label}', { label: hex.label })}
        </h2>
        <button type="button" className={btn} onClick={onClose} aria-label={t('Close intersection details')}>
          {t('Close')}
        </button>
      </div>
      {hex.neighborhood && <p className="text-sm text-slate-700">{hex.neighborhood}</p>}
      {t.lang === 'en' ? (
        <p className="mt-1 text-sm text-slate-800">
          Recorded at this intersection (police-reported, 2015 to Aug 2026): <strong>{hex.ped}</strong> pedestrian,{' '}
          <strong>{hex.bike}</strong> bike, <strong>{hex.mv}</strong> motor vehicle, <strong>{hex.total}</strong> total.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          {t('Recorded at this intersection (police-reported, 2015 to Aug 2026): {p} pedestrian, {b} bike, {mv} motor vehicle, {t} total.', {
            p: hex.ped,
            b: hex.bike,
            mv: hex.mv,
            t: hex.total,
          })}
        </p>
      )}
      <p className="text-sm text-slate-800">
        {t('Map shading group: {bin} pedestrian & bike.', { bin: t(binLabel(hex.pedBike, RECORDED_BINS)) })}
      </p>
      {(hex.first || hex.last) && (
        <p className="text-sm text-slate-800">
          {t('First recorded {first}, most recent {last}.', { first: hex.first ?? t('unknown'), last: hex.last ?? t('unknown') })}
        </p>
      )}
      {showModel && (
        <p className="mt-1 text-sm text-slate-800">
          {t('Team model: about {n} crashes a year. Model estimate from police-reported crashes. Not a guarantee.', {
            n: hex.estimatePerYear.toFixed(1),
          })}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-700">{t('Historical, not live. Counts only crashes recorded at the intersection, not mid-block.')}</p>
    </section>
  );
}
