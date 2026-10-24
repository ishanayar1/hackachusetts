'use client';
// Main screen: panel (tabs + details) and the map. All map content is also available as text in the panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Leg } from '@/lib/router';
import type { CrashHex, StationStatusRow } from '@/lib/ui/api';
import type { CrashMode } from '@/lib/ui/format';
import { routeGeojson, stationsGeojson, walkGeojson } from '@/lib/ui/geo';
import { useStations, useStationsStatus } from '@/lib/ui/hooks';
import { isPartial } from '@/lib/ui/format';
import { newlyBlocked, useMyStations, type StepFreeLevel } from '@/lib/ui/myStations';
import BrokenNow from './BrokenNow';
import CrashSpots from './CrashSpots';
import HexDetails from './HexDetails';
import MapClient from './MapClient';
import MapKey from './MapKey';
import type { FlyTarget } from './MapView';
import MyStations from './MyStations';
import StationDetails from './StationDetails';
import Tabs from './Tabs';
import TripPlanner from './TripPlanner';
import { btn, Notice, SourceBadge, StarButton } from './ui';

export default function LastMileApp() {
  const { stations, byId, sorted, error: stationsError } = useStations();
  const status = useStationsStatus();
  const [tab, setTab] = useState('broken');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedHex, setSelectedHex] = useState<CrashHex | null>(null);
  const [crashMode, setCrashMode] = useState<CrashMode>('recorded');
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [walkLines, setWalkLines] = useState<[number, number][][] | null>(null);
  const mine = useMyStations();
  const [banner, setBanner] = useState<string[]>([]);
  const prevStepFree = useRef<Map<string, StepFreeLevel> | null>(null);

  const live = useMemo(
    () => new Map<string, StationStatusRow>((status.data?.data.stations ?? []).map((s) => [s.id, s])),
    [status.data],
  );
  const stationsFc = useMemo(() => stationsGeojson(stations, live), [stations, live]);
  const routeFc = useMemo(() => routeGeojson(legs ?? undefined, byId), [legs, byId]);
  const walkFc = useMemo(() => walkGeojson(walkLines), [walkLines]);

  // Banner when a saved station loses step-free access (fully or for one platform) between two refreshes.
  const statusRows = status.data?.data.stations;
  useEffect(() => {
    if (!statusRows) return;
    const now = new Map<string, StepFreeLevel>(
      statusRows.map((r) => [r.id, isPartial(r) ? 'partial' : r.stepFree]),
    );
    const changed = newlyBlocked(mine.ids, prevStepFree.current, now);
    if (changed.length) setBanner((b) => [...new Set([...b, ...changed])]);
    prevStepFree.current = now;
  }, [statusRows, mine.ids]);

  const selectStation = useCallback(
    (id: string) => {
      setSelectedStationId(id);
      const s = byId.get(id);
      if (s) setFlyTo((f) => ({ lng: s.lon, lat: s.lat, zoom: 14.5, seq: (f?.seq ?? 0) + 1 }));
    },
    [byId],
  );
  const selectHexFromMap = useCallback((h: CrashHex) => setSelectedHex(h), []);
  const selectHexFromList = useCallback((h: CrashHex) => {
    setSelectedHex(h);
    setFlyTo((f) => ({ lng: h.lng, lat: h.lat, zoom: 14.5, seq: (f?.seq ?? 0) + 1 }));
  }, []);

  const selected = selectedStationId ? byId.get(selectedStationId) : undefined;
  const blockedNow = (status.data?.data.stations ?? []).filter(
    (s) => (!s.stepFree && s.blockedBy.length > 0) || isPartial(s),
  );

  return (
    <div className="app-shell bg-slate-50 text-slate-900">
      <header className="app-header border-b border-slate-300 bg-white px-4 py-2">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900">LastMile</h1>
        <p className="text-sm text-slate-700">Step-free MBTA trips</p>
      </header>

      <main className="app-panel space-y-3 px-4 py-3" aria-label="Trip tools">
        {stationsError && <Notice tone="error">Station list could not load. Reload the page to try again.</Notice>}
        {status.error && !status.data && (
          <Notice>Live step-free status is not available right now. Stations show their usual accessibility.</Notice>
        )}
        {status.data && <SourceBadge source={status.data.source} fetchedAt={status.data.fetchedAt} />}
        <div role="status" aria-live="polite">
          {banner.length > 0 && (
            <div className="rounded-md border-2 border-red-800 bg-red-50 p-3 text-slate-900">
              <p className="font-bold">
                <span aria-hidden="true">✕ </span>
                {banner.map((id) => byId.get(id)?.name ?? id).join(', ')}{' '}
                {banner.length === 1 ? 'is' : 'are'} no longer fully step-free (
                {banner.length === 1 ? 'one of your saved stations' : 'your saved stations'}).
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {banner.map((id) => (
                  <button key={id} type="button" className={btn} onClick={() => selectStation(id)}>
                    See {byId.get(id)?.name ?? id}
                  </button>
                ))}
                <button type="button" className={btn} onClick={() => setBanner([])}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <StationDetails
            station={selected}
            live={live.get(selected.id)}
            onClose={() => setSelectedStationId(null)}
            saved={mine.has(selected.id)}
            onToggleSave={() => mine.toggle(selected.id)}
          />
        )}
        {selectedHex && (
          <HexDetails hex={selectedHex} showModel={crashMode === 'model'} onClose={() => setSelectedHex(null)} />
        )}

        <MapKey mode={crashMode} onMode={setCrashMode} />

        <Tabs
          label="LastMile sections"
          active={tab}
          onChange={setTab}
          tabs={[
            {
              id: 'broken',
              label: 'Broken now',
              content: (
                <div className="space-y-4">
                  <MyStations
                    ids={mine.ids}
                    byId={byId}
                    live={live}
                    onSelectStation={selectStation}
                    onToggle={mine.toggle}
                  />
                  {blockedNow.length > 0 && (
                    <section aria-labelledby="blocked-h" className="rounded-md border border-red-800 bg-red-50 p-3">
                      <h2 id="blocked-h" className="font-bold text-slate-900">
                        <span aria-hidden="true">✕ </span>Stations with step-free access blocked by broken equipment
                      </h2>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {blockedNow.map((s) => (
                          <li key={s.id} className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => selectStation(s.id)}
                              className="min-h-11 rounded-md border border-red-800 bg-white px-3 text-sm font-semibold text-red-900 hover:bg-red-100"
                            >
                              {s.name}
                              {isPartial(s) ? ' (partly step-free)' : ' (not step-free)'}
                            </button>
                            <StarButton saved={mine.has(s.id)} name={s.name} onToggle={() => mine.toggle(s.id)} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <BrokenNow stationsById={byId} onSelectStation={selectStation} />
                </div>
              ),
            },
            {
              id: 'trip',
              label: 'Plan a trip',
              content: (
                <TripPlanner
                  stations={sorted}
                  byId={byId}
                  live={live}
                  onRoute={setLegs}
                  onWalk={setWalkLines}
                  onSelectStation={selectStation}
                />
              ),
            },
            {
              id: 'crash',
              label: 'Crash spots',
              content: <CrashSpots selectedHex={selectedHex?.hex ?? null} onSelectHex={selectHexFromList} />,
            },
          ]}
        />

        <footer className="border-t border-slate-300 pt-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">Not official MBTA information. Confirm before you travel.</p>
          <p className="mt-1">© OpenStreetMap contributors · OpenFreeMap · MBTA</p>
        </footer>
      </main>

      <div className="app-map" role="region" aria-label="Map of subway stations and recorded crash areas">
        <MapClient
          stations={stationsFc}
          route={routeFc}
          walk={walkFc}
          crashMode={crashMode}
          selectedStationId={selectedStationId}
          selectedHex={selectedHex?.hex ?? null}
          flyTo={flyTo}
          onSelectStation={selectStation}
          onSelectHex={selectHexFromMap}
        />
      </div>
    </div>
  );
}
