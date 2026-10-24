'use client';
// Map key (legend) and the crash layer radio group. Lives outside the map so it works without it.
import { useId, type ReactNode } from 'react';
import type { MapLayerToggles } from '@/lib/ui/api';
import { MODEL_BINS, RECORDED_BINS, type CrashMode } from '@/lib/ui/format';
import { StateIcon } from './ui';
import { useT, type T } from '@/lib/i18n';

const MODES: { id: CrashMode; label: string }[] = [
  { id: 'recorded', label: 'Recorded pedestrian & bike crashes (2015-2026)' },
  { id: 'model', label: 'Next-month estimate (team model)' },
  { id: 'off', label: 'Off' },
];

export const DEFAULT_LAYERS: MapLayerToggles = { trains: true, fatal: true, danger: false, equity: false, ramps: false };

function Sym({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

const LAYER_ROWS: { id: keyof MapLayerToggles; label: string; symbol: ReactNode }[] = [
  {
    id: 'trains',
    label: 'Trains (live, updated every 15 s)',
    symbol: (
      <Sym>
        <path d="M10 1 L14 7 L6 7 Z" fill="#DA291C" stroke="#fff" strokeWidth="1" />
        <circle cx="10" cy="12" r="5" fill="#DA291C" stroke="#fff" strokeWidth="1.5" />
      </Sym>
    ),
  },
  {
    id: 'fatal',
    label: 'Fatal crashes since 2015 (Boston Vision Zero)',
    symbol: (
      <Sym>
        <circle cx="10" cy="10" r="6" fill="#fff" stroke="#000" strokeWidth="3" />
      </Sym>
    ),
  },
  {
    id: 'danger',
    label: 'Spots residents reported as dangerous (Boston Vision Zero)',
    symbol: (
      <Sym>
        <circle cx="10" cy="10" r="6" fill="#fff" stroke="#7e22ce" strokeWidth="2.5" />
        <circle cx="10" cy="10" r="2" fill="#7e22ce" />
      </Sym>
    ),
  },
  {
    id: 'equity',
    label: 'Environmental-justice neighborhoods (MassGIS)',
    symbol: (
      <Sym>
        <rect x="2" y="2" width="16" height="16" fill="rgba(13,148,136,0.12)" stroke="#0f766e" strokeWidth="1" />
        <path d="M2 10 L10 2 M2 18 L18 2 M10 18 L18 10" stroke="#0f766e" strokeWidth="1.5" />
      </Sym>
    ),
  },
  {
    id: 'ramps',
    label: 'Curb ramps in poor condition / with a lip (City of Boston inventory)',
    symbol: (
      <Sym>
        <circle cx="6" cy="10" r="4" fill="#9a3412" stroke="#fff" strokeWidth="1" />
        <circle cx="15" cy="10" r="3.5" fill="#fff" stroke="#9a3412" strokeWidth="2" />
      </Sym>
    ),
  },
];

/** Extra legend lines shown under a layer while it is on. */
const LAYER_NOTES: Partial<Record<keyof MapLayerToggles, (t: T) => ReactNode>> = {
  trains: (t) => t('Dot in the line color with a white outline; the arrow (from zoom 11) points the way the train is going.'),
  fatal: (t) => t('Black ring with a white center. Recorded fatal crashes, not a prediction. Tap one for date and place.'),
  danger: (t) => t('Purple ring with a dot. Reports from residents, not verified crashes. Tap one for the concern.'),
  equity: (t) => t('Hatched teal areas, under the street names. Tap an area for population and limited-English share.'),
  ramps: (t) => (
    <ul className="space-y-1">
      <li className="flex items-center gap-2">
        <Sym>
          <circle cx="10" cy="10" r="4" fill="#9a3412" stroke="#fff" strokeWidth="1" />
        </Sym>
        {t('Filled brown dot: poor condition')}
      </li>
      <li className="flex items-center gap-2">
        <Sym>
          <circle cx="10" cy="10" r="3.5" fill="#fff" stroke="#9a3412" strokeWidth="2" />
        </Sym>
        {t('Hollow brown ring: lip at the edge')}
      </li>
      <li className="flex items-center gap-2">
        <Sym>
          <circle cx="10" cy="10" r="4.5" fill="#9a3412" stroke="#111827" strokeWidth="2" />
        </Sym>
        {t('Filled dot in a dark ring: both')}
      </li>
      <li>{t('Shown from zoom 14 (zoom in on a street).')}</li>
    </ul>
  ),
};

export default function MapKey({
  mode,
  onMode,
  layers,
  onLayers,
  summary,
}: {
  mode: CrashMode;
  onMode: (m: CrashMode) => void;
  layers?: MapLayerToggles;
  onLayers?: (l: MapLayerToggles) => void;
  /** Text equivalent of each layer while it is on (counts, load state). */
  summary?: Partial<Record<keyof MapLayerToggles, string>>;
}) {
  const name = useId();
  const t = useT();
  const bins = mode === 'model' ? MODEL_BINS : RECORDED_BINS;
  return (
    <details className="rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{t('Map key and layers')}</summary>
      <div className="space-y-3 pt-2">
        {layers && onLayers && (
          <fieldset>
            <legend className="font-semibold">{t('Map layers')}</legend>
            <ul className="space-y-1">
              {LAYER_ROWS.map((row) => (
                <li key={row.id}>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={layers[row.id]}
                      onChange={(e) => onLayers({ ...layers, [row.id]: e.target.checked })}
                      className="h-5 w-5 shrink-0"
                    />
                    {row.symbol}
                    <span>{t(row.label)}</span>
                  </label>
                  {layers[row.id] && (
                    <div className="ml-7 space-y-1 text-slate-800">
                      <div>{LAYER_NOTES[row.id]?.(t)}</div>
                      {summary?.[row.id] && <p>{summary[row.id]}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <ul className="space-y-1" aria-label={t('Station symbols')}>
          <li className="flex items-center gap-2">
            <StateIcon state="yes" /> {t('Filled green dot: step-free now')}
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="partial" /> {t('Green dot in an amber ring with !: partly step-free (one platform blocked)')}
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="no" /> {t('Red ring with ×: not step-free right now')}
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="unknown" /> {t('Small grey dot: no step-free data')}
          </li>
          <li className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2 10h16" stroke="#111827" strokeWidth="7" />
              <path d="M2 10h16" stroke="#DA291C" strokeWidth="3.5" />
            </svg>
            {t('Thick outlined line: your planned route')}
          </li>
          <li className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M1 10h18" stroke="#111827" strokeWidth="3" strokeDasharray="4 3" />
            </svg>
            {t('Dashed line: your walk to the station')}
          </li>
        </ul>
        <fieldset>
          <legend className="font-semibold">{t('Crash layer')}</legend>
          {MODES.map((m) => (
            <label key={m.id} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name={name}
                value={m.id}
                checked={mode === m.id}
                onChange={() => onMode(m.id)}
                className="h-5 w-5"
              />
              {t(m.label)}
            </label>
          ))}
        </fieldset>
        {mode !== 'off' && (
          <div>
            <p className="font-semibold">
              {t(mode === 'model' ? 'Estimated crashes per intersection (team model)' : 'Pedestrian & bike crashes per intersection')}
            </p>
            <ul className="mt-1 space-y-1">
              {bins.map((b, i) => (
                <li key={b.label} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-5 w-8 items-center justify-center rounded-sm border border-slate-500 text-[10px] font-bold"
                    style={{ background: b.color, color: i >= 2 ? '#fff' : '#111' }}
                  >
                    {i + 1}
                  </span>
                  {t(b.label)}
                </li>
              ))}
            </ul>
            {mode === 'model' && (
              <p className="mt-1 text-slate-800">{t('Model estimate from police-reported crashes. Not a guarantee.')}</p>
            )}
            <p className="mt-1 text-slate-700">{t('Historical, not live. Tap an intersection for its numbers.')}</p>
          </div>
        )}
      </div>
    </details>
  );
}
