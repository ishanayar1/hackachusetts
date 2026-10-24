'use client';
// Text details for the crash area selected on the map or in the list.
import type { CrashHex } from '@/lib/ui/api';
import { binLabel, crashTitle, RECORDED_BINS } from '@/lib/ui/format';
import { btn } from './ui';

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
  return (
    <section aria-labelledby="hex-h" className="rounded-md border border-slate-400 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 id="hex-h" className="text-base font-bold text-slate-900">
          Crash area: {crashTitle(hex)}
        </h2>
        <button type="button" className={btn} onClick={onClose} aria-label="Close crash area details">
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-800">
        Recorded (police-reported, 2015 to Aug 2026): <strong>{hex.ped}</strong> pedestrian,{' '}
        <strong>{hex.bike}</strong> bike, <strong>{hex.mv}</strong> motor vehicle, <strong>{hex.total}</strong> total.
      </p>
      <p className="text-sm text-slate-800">Map shading group: {binLabel(hex.pedBike, RECORDED_BINS)} pedestrian &amp; bike.</p>
      {(hex.first || hex.last) && (
        <p className="text-sm text-slate-800">
          First recorded {hex.first ?? 'unknown'}, most recent {hex.last ?? 'unknown'}.
        </p>
      )}
      {showModel && (
        <p className="mt-1 text-sm text-slate-800">
          Team model: about {hex.estimatePerYear.toFixed(1)} crashes a year. Model estimate from police-reported crashes.
          Not a guarantee.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-700">Historical, not live. Each area is about 350 m across.</p>
    </section>
  );
}
