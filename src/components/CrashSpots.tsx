'use client';
// "Crash spots": searchable list of recorded crash intersections. Each item flies the map there and shows details.
import { useDeferredValue, useId, useState } from 'react';
import type { CrashHex } from '@/lib/ui/api';
import { crashSpotsFromGeojson } from '@/lib/ui/format';
import { useCrashGeojson, useCrashLocations } from '@/lib/ui/hooks';
import { Notice } from './ui';
import { useT } from '@/lib/i18n';

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
      <h2 id="crash-h" className="text-lg font-bold text-slate-900">
        {t('Crash spots')}
      </h2>
      <p className="mt-1 text-sm text-slate-800">
        {t('Recorded crashes come from Boston Vision Zero (police-reported, 2015 to Aug 2026). Historical, not live.')}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-q`} className="block text-sm font-semibold text-slate-900">
            {t('Search by street or neighborhood')}
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('e.g. Mass Ave')}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
          />
        </div>
        <div>
          <label htmlFor={`${ids}-sort`} className="block text-sm font-semibold text-slate-900">
            {t('Sort by')}
          </label>
          <select
            id={`${ids}-sort`}
            value={sort}
            onChange={(e) => setSort(e.target.value as 'recorded' | 'model')}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
          >
            <option value="recorded">{t('Recorded pedestrian & bike crashes')}</option>
            <option value="model">{t('Team model estimate')}</option>
          </select>
        </div>
      </div>
      {sort === 'model' && (
        <p className="mt-2 text-sm text-slate-800">{t('Model estimate from police-reported crashes. Not a guarantee.')}</p>
      )}
      <p aria-live="polite" className="mt-2 text-sm text-slate-800">
        {loading
          ? t('Loading crash spots…')
          : en
            ? `${results.length} ${results.length === 1 ? 'intersection' : 'intersections'} shown.`
            : t('Intersections shown: {n}.', { n: results.length })}
      </p>
      {api.error && local.error && <Notice tone="error">{t('Crash data is not available right now.')}</Notice>}
      <ul className="mt-2 space-y-2">
        {results.map((h) => (
          <li key={h.site}>
            <button
              type="button"
              aria-pressed={selectedHex === h.site}
              onClick={() => onSelectHex(h)}
              className={`min-h-11 w-full rounded-md border p-2 text-left text-sm ${
                selectedHex === h.site ? 'border-blue-800 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="block font-semibold text-slate-900">{h.label}</span>
              {h.neighborhood && <span className="block text-slate-700">{h.neighborhood}</span>}
              <span className="block text-slate-800">
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
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
