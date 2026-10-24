'use client';
// "My stations": starred stations with step-free status now and any active accessibility alert.
import type { Station, StationStatusRow } from '@/lib/ui/api';
import { ACCESS_EFFECTS, alertActive, effectLabel, partialLines, stepFreeState } from '@/lib/ui/format';
import { useAlerts, useFacilities } from '@/lib/ui/hooks';
import { StarButton, StateText } from './ui';

export default function MyStations({
  ids,
  byId,
  live,
  onSelectStation,
  onToggle,
}: {
  ids: string[];
  byId: Map<string, Station>;
  live: Map<string, StationStatusRow>;
  onSelectStation: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { data } = useAlerts();
  const { byId: facilities } = useFacilities();
  const alerts = (data?.data.alerts ?? []).filter(
    (a) => !a.informational && alertActive(a) && ACCESS_EFFECTS.has(a.effect),
  );
  const facilityName = (id: string) => facilities.get(id)?.shortName ?? facilities.get(id)?.name ?? id;
  const saved = ids.map((id) => byId.get(id)).filter((s): s is Station => !!s);

  return (
    <section aria-labelledby="mine-h" className="rounded-md border border-slate-400 bg-white p-3">
      <h2 id="mine-h" className="text-lg font-bold text-slate-900">
        <span aria-hidden="true">★ </span>My stations
      </h2>
      {saved.length === 0 ? (
        <p className="mt-1 text-sm text-slate-800">
          No saved stations yet. Open a station and choose Save to see it here. Saved on this device only.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {saved.map((s) => {
            const row = live.get(s.id);
            const state = stepFreeState(s, row);
            const mine = alerts.filter((a) => a.stationIds.includes(s.id));
            return (
              <li key={s.id} className="rounded border border-slate-300 p-2 text-sm text-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="min-h-11 text-left font-semibold text-blue-800 underline underline-offset-2"
                    onClick={() => onSelectStation(s.id)}
                  >
                    {s.name}
                  </button>
                  <StarButton saved name={s.name} onToggle={() => onToggle(s.id)} />
                </div>
                <StateText state={state} />
                {state === 'no' && row && row.blockedBy.length > 0 && (
                  <p className="text-slate-800">
                    Out of service: {row.blockedBy.map(facilityName).join('; ')}
                  </p>
                )}
                {state === 'partial' && row && (
                  <ul className="text-slate-800">
                    {partialLines(row.blockedPlatforms, row.blockedBy ?? [], facilityName).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {mine.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {mine.map((a) => (
                      <li key={a.id} className="flex items-start gap-1.5">
                        <span aria-hidden="true">⚠</span>
                        <span>
                          <strong>{effectLabel(a.effect)}:</strong> {a.shortHeader || a.header}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  data && <p className="text-slate-700">No active accessibility alerts.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
