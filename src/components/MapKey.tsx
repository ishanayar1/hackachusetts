'use client';
// Map key (legend) and the crash layer radio group. Lives outside the map so it works without it.
import { useId } from 'react';
import { MODEL_BINS, RECORDED_BINS, type CrashMode } from '@/lib/ui/format';
import { StateIcon } from './ui';

const MODES: { id: CrashMode; label: string }[] = [
  { id: 'recorded', label: 'Recorded pedestrian & bike crashes (2015-2026)' },
  { id: 'model', label: 'Next-month estimate (team model)' },
  { id: 'off', label: 'Off' },
];

export default function MapKey({ mode, onMode }: { mode: CrashMode; onMode: (m: CrashMode) => void }) {
  const name = useId();
  const bins = mode === 'model' ? MODEL_BINS : RECORDED_BINS;
  return (
    <details className="rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Map key and crash layer</summary>
      <div className="space-y-3 pt-2">
        <ul className="space-y-1" aria-label="Station symbols">
          <li className="flex items-center gap-2">
            <StateIcon state="yes" /> Filled green dot: step-free now
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="partial" /> Green dot in an amber ring with !: partly step-free (one platform blocked)
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="no" /> Red ring with ×: not step-free right now
          </li>
          <li className="flex items-center gap-2">
            <StateIcon state="unknown" /> Small grey dot: no step-free data
          </li>
          <li className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2 10h16" stroke="#111827" strokeWidth="7" />
              <path d="M2 10h16" stroke="#DA291C" strokeWidth="3.5" />
            </svg>
            Thick outlined line: your planned route
          </li>
          <li className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M1 10h18" stroke="#111827" strokeWidth="3" strokeDasharray="4 3" />
            </svg>
            Dashed line: your walk to the station
          </li>
        </ul>
        <fieldset>
          <legend className="font-semibold">Crash layer</legend>
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
              {m.label}
            </label>
          ))}
        </fieldset>
        {mode !== 'off' && (
          <div>
            <p className="font-semibold">
              {mode === 'model' ? 'Estimated crashes per area (team model)' : 'Pedestrian & bike crashes per area'}
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
                  {b.label}
                </li>
              ))}
            </ul>
            {mode === 'model' && (
              <p className="mt-1 text-slate-800">Model estimate from police-reported crashes. Not a guarantee.</p>
            )}
            <p className="mt-1 text-slate-700">Historical, not live. Tap an area for its numbers.</p>
          </div>
        )}
      </div>
    </details>
  );
}
