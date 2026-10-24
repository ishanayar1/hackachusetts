'use client';
// Map key (legend) and the crash layer radio group. Lives outside the map so it works without it.
import { useId, type ReactNode } from 'react';
import type { MapLayerToggles } from '@/lib/ui/api';
import { DEFAULT_LAYERS, MODEL_BINS, RECORDED_BINS, type CrashMode } from '@/lib/ui/format';
import { SKINS, type MapSkin } from '@/lib/ui/map-skins';
import { StateIcon } from './ui';
import { useT, type T } from '@/lib/i18n';

const MODES: { id: CrashMode; label: string }[] = [
  { id: 'recorded', label: 'Recorded pedestrian & bike crashes (2015-2026)' },
  { id: 'model', label: 'Next-month estimate (team model)' },
  { id: 'off', label: 'Off' },
];

export { DEFAULT_LAYERS };

function Sym({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

function RampSym({ kind }: { kind: 'poor' | 'lip' | 'both' }) {
  const fill = kind === 'lip' ? '#fff' : '#9a3412';
  const mark = kind === 'lip' ? '#9a3412' : '#fff';
  return (
    <Sym>
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill={fill} stroke={kind === 'both' ? '#111827' : kind === 'lip' ? '#9a3412' : '#fff'} strokeWidth="1.5" />
      <path d="M5 14 H15 V6.5 Z" fill={mark} />
      {kind !== 'poor' && <rect x="3.8" y="10" width="1.6" height="4" fill={mark} />}
    </Sym>
  );
}

/** Warning-sign icon as drawn on the map for crash intersections. */
export function WarnSym({ fill }: { fill: string }) {
  return (
    <Sym>
      <path d="M10 2 L18.5 17 H1.5 Z" fill={fill} stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7 V12" stroke="#111827" strokeWidth="1.8" />
      <circle cx="10" cy="14.3" r="1" fill="#111827" />
    </Sym>
  );
}

function AccessSym({ fill, glyph, out }: { fill: string; glyph: ReactNode; out?: boolean }) {
  return (
    <Sym>
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill={fill} stroke="#fff" strokeWidth="1.2" />
      {glyph}
      {out && <path d="M5 15 L15 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
    </Sym>
  );
}
const ELEV_GLYPH = <path d="M10 5 L13 9 H7 Z M7 11 H13 L10 15 Z" fill="#fff" />;
const DOOR_GLYPH = <rect x="7" y="5" width="6" height="10" fill="none" stroke="#fff" strokeWidth="1.4" />;

const LAYER_ROWS: { id: keyof MapLayerToggles; label: string; symbol: ReactNode }[] = [
  {
    id: 'access',
    label: 'Elevators, lifts, ramps and station doors (zoom in to see them)',
    symbol: <AccessSym fill="#1d4ed8" glyph={ELEV_GLYPH} />,
  },
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
        <circle cx="10" cy="10" r="8" fill="#111827" stroke="#fff" strokeWidth="1.5" />
        <path d="M7 7 L13 13 M13 7 L7 13" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </Sym>
    ),
  },
  {
    id: 'danger',
    label: 'Spots residents reported as dangerous (Boston Vision Zero)',
    symbol: (
      <Sym>
        <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="#7e22ce" stroke="#fff" strokeWidth="1.2" />
        <path d="M10 5.5 V11.5" stroke="#fff" strokeWidth="2.2" />
        <circle cx="10" cy="14.3" r="1.2" fill="#fff" />
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
      <RampSym kind="poor" />
    ),
  },
];

/** Extra legend lines shown under a layer while it is on. */
const LAYER_NOTES: Partial<Record<keyof MapLayerToggles, (t: T) => ReactNode>> = {
  access: (t) => (
    <ul className="space-y-1">
      <li className="flex items-center gap-2">
        <AccessSym fill="#1d4ed8" glyph={ELEV_GLYPH} />
        {t('Blue: elevator, lift or ramp working')}
      </li>
      <li className="flex items-center gap-2">
        <AccessSym fill="#b91c1c" glyph={ELEV_GLYPH} out />
        {t('Red with a slash: out of service now')}
      </li>
      <li className="flex items-center gap-2">
        <AccessSym fill="#475569" glyph={<path d="M5 14 H8 L12 7 H15" stroke="#fff" strokeWidth="1.6" fill="none" />} />
        {t('Grey-blue: escalator (not step-free)')}
      </li>
      <li className="flex items-center gap-2">
        <AccessSym fill="#047857" glyph={DOOR_GLYPH} />
        {t('Green door: step-free station entrance')}
      </li>
      <li className="flex items-center gap-2">
        <AccessSym fill="#6b7280" glyph={DOOR_GLYPH} out />
        {t('Grey door with a slash: entrance with stairs')}
      </li>
      <li>{t('Faded icons are placed at the station because MBTA gives no exact spot.')}</li>
    </ul>
  ),
  trains: (t) => t('Dot in the line color with a white outline; the arrow (from zoom 11) points the way the train is going.'),
  fatal: (t) => t('Black circle with a white cross. Recorded fatal crashes, not a prediction. Tap one for date and place.'),
  danger: (t) => t('Purple square with a white !. Reports from residents, not verified crashes. Tap one for the concern.'),
  equity: (t) => t('Hatched teal areas, under the street names. Tap an area for population and limited-English share.'),
  ramps: (t) => (
    <ul className="space-y-1">
      <li className="flex items-center gap-2">
        <RampSym kind="poor" />
        {t('Brown square with a white ramp: poor condition')}
      </li>
      <li className="flex items-center gap-2">
        <RampSym kind="lip" />
        {t('White square with a brown ramp and a bar: lip at the edge')}
      </li>
      <li className="flex items-center gap-2">
        <RampSym kind="both" />
        {t('Brown square in a dark border with a bar: both')}
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
  skin,
  onSkin,
}: {
  skin?: MapSkin;
  onSkin?: (s: MapSkin) => void;
  mode: CrashMode;
  onMode: (m: CrashMode) => void;
  layers?: MapLayerToggles;
  onLayers?: (l: MapLayerToggles) => void;
  /** Text equivalent of each layer while it is on (counts, load state). */
  summary?: Partial<Record<keyof MapLayerToggles, string>>;
}) {
  const name = useId();
  const skinName = useId();
  const t = useT();
  // The model hides its lowest bin on the map (see crashFilter), so the key does too.
  const bins = mode === 'model' ? MODEL_BINS.slice(1) : RECORDED_BINS;
  return (
    <details className="rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{t('Map style, key and layers')}</summary>
      <div className="space-y-3 pt-2">
        {skin && onSkin && (
          <fieldset>
            <legend className="font-semibold">{t('Map style')}</legend>
            <div className="flex flex-wrap gap-x-4">
              {SKINS.map((k) => (
                <label key={k.id} className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name={skinName}
                    value={k.id}
                    checked={skin === k.id}
                    onChange={() => onSkin(k.id)}
                    className="h-5 w-5"
                  />
                  {t(k.label)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
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
            <StateIcon state="yes" /> {t('Green circle with a wheelchair: step-free now')}
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="partial" /> {t('Green circle in an amber ring with !: partly step-free (one platform blocked)')}
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="no" /> {t('White circle in a red ring with ×: not step-free right now')}
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="unknown" /> {t('Small grey circle with ?: no step-free data')}
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
              {bins.map((b) => (
                <li key={b.label} className="flex items-center gap-2">
                  <WarnSym fill={b.color} />
                  {t(b.label)}
                </li>
              ))}
            </ul>
            {mode === 'model' && (
              <p className="mt-1 text-slate-800">
                {t('Intersections under 0.5 crashes a year are hidden to keep the map clear.')}
              </p>
            )}
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
