'use client';
// "Crash spots": searchable list of recorded crash intersections. Each item flies the map there and shows details.
import { useDeferredValue, useId, useState } from 'react';
import type { CrashHex } from '@/lib/ui/api';
import { crashSpotsFromGeojson } from '@/lib/ui/format';
import { useCrashGeojson, useCrashLocations } from '@/lib/ui/hooks';
import { input, listItem, mutedText, Notice, pageTitle } from './ui';
import { useT } from '@/lib/i18n';

/** Segmented control: soft pill track, active pill turns ink. */
const segTrack = 'grid grid-cols-2 gap-1 rounded-full bg-soft p-1';
const segBtn =
  'min-h-11 rounded-full px-3 text-[14px] font-bold leading-tight text-ink-2 transition duration-200 hover:text-ink active:scale-[.97] aria-pressed:bg-ink aria-pressed:text-white aria-pressed:shadow-sh1';

export default function CrashSpots({
  selectedHex,
  onSelectHex,
}: {
  selectedHex: string | null;
  onSelectHex: (h: CrashHex) => void;
}) {
  const ids = useId();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recorded' | 'model'>('recorded');
  const dq = useDeferredValue(q);
  const api = useCrashLocations(dq, sort);
  // If the API is missing or failing, read the static layer directly.
  const local = useCrashGeojson(!!api.error);
  const results = api.data?.data.results ?? (api.error ? crashSpotsFromGeojson(local.data, dq, sort) : []);
  const loading = !api.data && !api.error;
  const t = useT();
  const en = t.lang === 'en';

  return (
    <section aria-labelledby="crash-h">
      <h2 id="crash-h" className={pageTitle}>
        {t('Crash spots')}
      </h2>
      <p className={`mt-1 ${mutedText}`}>
        {t('Recorded crashes come from Boston Vision Zero (police-reported, 2015 to Aug 2026). Historical, not live.')}
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor={`${ids}-q`} className="mb-1.5 block text-[14px] font-bold text-ink">
            {t('Search by street or neighborhood')}
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('e.g. Mass Ave')}
            className={input}
          />
        </div>
        <div>
          <p id={`${ids}-sort-l`} className="mb-1.5 text-[14px] font-bold text-ink">
            {t('Sort by')}
          </p>
          <div id={`${ids}-sort`} role="group" aria-labelledby={`${ids}-sort-l`} className={segTrack}>
            {(
              [
                ['recorded', t('Recorded pedestrian & bike crashes')],
                ['model', t('Team model estimate')],
              ] as ['recorded' | 'model', string][]
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={sort === v} onClick={() => setSort(v)} className={segBtn}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {sort === 'model' && (
        <p className="mt-2 rounded-2xl bg-warn-bg px-3.5 py-2.5 text-[13px] font-semibold text-warn">
          {t('Model estimate from police-reported crashes. Not a guarantee.')}
        </p>
      )}
      <p aria-live="polite" className={`mt-3 ${mutedText}`}>
        {loading
          ? t('Loading crash spots…')
          : en
            ? `${results.length} ${results.length === 1 ? 'intersection' : 'intersections'} shown.`
            : t('Intersections shown: {n}.', { n: results.length })}
      </p>
      {api.error && local.error && <Notice tone="error">{t('Crash data is not available right now.')}</Notice>}
      <ul className="mt-2 space-y-2">
        {results.map((h, i) => (
          <li key={h.site}>
            <button
              type="button"
              aria-pressed={selectedHex === h.site}
              onClick={() => onSelectHex(h)}
              className={`${listItem} min-h-11 items-center active:scale-[.99] aria-pressed:border-ink aria-pressed:ring-1 aria-pressed:ring-ink`}
            >
              <span
                aria-hidden="true"
                className="grid size-[30px] shrink-0 place-items-center rounded-full bg-soft-2 text-[14px] font-bold text-ink"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold leading-snug text-ink">{h.label}</span>
                {h.neighborhood && <span className={`block ${mutedText}`}>{h.neighborhood}</span>}
                <span className="mt-0.5 block text-[13px] font-medium leading-snug text-ink-2">
                {sort === 'model'
                  ? t('Team model: about {n} crashes a year · {pb} pedestrian & bike recorded', {
                      n: h.estimatePerYear.toFixed(1),
                      pb: h.pedBike,
                    })
                  : t('{pb} pedestrian & bike crashes recorded ({p} pedestrian, {b} bike) · {t} total', {
                      pb: h.pedBike,
                      p: h.ped,
                      b: h.bike,
                      t: h.total,
                    })}
                </span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-right">
                <span className="block text-[18px] font-extrabold leading-none tracking-[-0.02em] text-ink tabular-nums">
                  {sort === 'model' ? h.estimatePerYear.toFixed(1) : h.pedBike}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
