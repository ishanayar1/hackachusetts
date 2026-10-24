'use client';
// "Crash spots": searchable list of recorded crash areas. Each item flies the map there and shows details.
import { useDeferredValue, useId, useState } from 'react';
import type { CrashHex } from '@/lib/ui/api';
import { crashSpotsFromGeojson, crashTitle } from '@/lib/ui/format';
import { useCrashGeojson, useCrashLocations } from '@/lib/ui/hooks';
import { Notice } from './ui';

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

  return (
    <section aria-labelledby="crash-h">
      <h2 id="crash-h" className="text-lg font-bold text-slate-900">
        Crash spots
      </h2>
      <p className="mt-1 text-sm text-slate-800">
        Recorded crashes come from Boston Vision Zero (police-reported, 2015 to Aug 2026). Historical, not live.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-q`} className="block text-sm font-semibold text-slate-900">
            Search by street or area
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Mass Ave"
            className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
          />
        </div>
        <div>
          <label htmlFor={`${ids}-sort`} className="block text-sm font-semibold text-slate-900">
            Sort by
          </label>
          <select
            id={`${ids}-sort`}
            value={sort}
            onChange={(e) => setSort(e.target.value as 'recorded' | 'model')}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900"
          >
            <option value="recorded">Recorded pedestrian &amp; bike crashes</option>
            <option value="model">Team model estimate</option>
          </select>
        </div>
      </div>
      {sort === 'model' && (
        <p className="mt-2 text-sm text-slate-800">Model estimate from police-reported crashes. Not a guarantee.</p>
      )}
      <p aria-live="polite" className="mt-2 text-sm text-slate-800">
        {loading ? 'Loading crash spots…' : `${results.length} ${results.length === 1 ? 'area' : 'areas'} shown.`}
      </p>
      {api.error && local.error && <Notice tone="error">Crash data is not available right now.</Notice>}
      <ul className="mt-2 space-y-2">
        {results.map((h) => (
          <li key={h.hex}>
            <button
              type="button"
              aria-pressed={selectedHex === h.hex}
              onClick={() => onSelectHex(h)}
              className={`min-h-11 w-full rounded-md border p-2 text-left text-sm ${
                selectedHex === h.hex ? 'border-blue-800 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="block font-semibold text-slate-900">{crashTitle(h)}</span>
              <span className="block text-slate-800">
                {sort === 'model'
                  ? `Team model: about ${h.estimatePerYear.toFixed(1)} crashes a year · ${h.pedBike} pedestrian & bike recorded`
                  : `${h.pedBike} pedestrian & bike crashes recorded (${h.ped} pedestrian, ${h.bike} bike) · ${h.total} total`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
