'use client';
// "Drive": a car route to a place, or to an MBTA lot with accessible spaces and then the step-free train.
import { useEffect, useId, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { ParkingLot, Station } from '@/lib/ui/api';
import { useDrive, useStaticFile } from '@/lib/ui/hooks';
import { DEMO_DESTINATIONS, DEMO_PLACE, formatDistance, getMyLocation, type LatLon, type Place } from '@/lib/ui/walk';
import { btn, btnPrimary, Notice, SourceBadge } from './ui';

type StartMode = 'saved' | 'here' | 'demo';
type Goal = 'place' | 'park';
type Query = { from: Place; to: LatLon; toText: string; stationId?: string; lot?: ParkingLot };

const select = 'mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-white px-2 text-base text-slate-900';
const mins = (m: number) => Math.max(1, Math.round(m));

type Props = {
  stations: Station[];
  places: Place[];
  /** Car route ([lon, lat] list) to draw on the map, or null. */
  onDrive: (coords: [number, number][] | null) => void;
  /** Park & ride: continue with the step-free train from this station. */
  onPlanTrain: (stationId: string) => void;
};

export default function DrivePlanner({ stations, places, onDrive, onPlanTrain }: Props) {
  const t = useT();
  const ids = useId();
  const [startMode, setStartMode] = useState<StartMode>(places.length ? 'saved' : 'demo');
  const [start, setStart] = useState<Place | null>(places.length ? places[0] : DEMO_PLACE);
  const [locError, setLocError] = useState('');
  const [goal, setGoal] = useState<Goal>('place');
  const [destLabel, setDestLabel] = useState('');
  const [lotId, setLotId] = useState('');
  const [formError, setFormError] = useState('');
  const [query, setQuery] = useState<Query | null>(null);

  const parking = useStaticFile<ParkingLot[]>('/data/parking.json', true);
  const byStation = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const lots = useMemo(
    () =>
      (parking.data ?? [])
        .filter((l) => (l.accessibleSpaces ?? 0) > 0 && l.lat !== undefined && l.lon !== undefined)
        .sort((a, b) => (byStation.get(a.stationId)?.name ?? '').localeCompare(byStation.get(b.stationId)?.name ?? '')),
    [parking.data, byStation],
  );
  const destinations = [...places, ...DEMO_DESTINATIONS];

  const drive = useDrive(query?.from ?? null, query?.to ?? null);
  const result = drive.data?.data;
  useEffect(() => onDrive(result ? result.coordinates : null), [result, onDrive]);

  const chooseStart = async (m: StartMode) => {
    setStartMode(m);
    setLocError('');
    if (m === 'saved') setStart(places[0] ?? null);
    else if (m === 'demo') setStart(DEMO_PLACE);
    else {
      setStart(null);
      try {
        setStart(await getMyLocation());
      } catch (e) {
        setLocError(e instanceof Error ? e.message : t('We could not get your location.'));
      }
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start) return setFormError(t('Your start location is not set yet.'));
    if (goal === 'place') {
      const d = destinations.find((x) => x.label === destLabel);
      if (!d) return setFormError(t('Choose where you are going.'));
      setQuery({ from: start, to: d, toText: d.label });
    } else {
      const lot = lots.find((l) => l.id === lotId);
      if (!lot) return setFormError(t('Choose a station to park at.'));
      setQuery({ from: start, to: { lat: lot.lat!, lon: lot.lon! }, toText: lot.name, stationId: lot.stationId, lot });
    }
    setFormError('');
  };

  const stationName = (id: string) => byStation.get(id)?.name ?? id;

  return (
    <section aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="text-lg font-bold text-slate-900">
        {t('Drive')}
      </h2>
      <form onSubmit={submit} className="mt-2 space-y-3">
        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">{t('Start from')}</legend>
          {(
            [
              ['saved', 'One of my places'],
              ['here', 'My location'],
              ['demo', "Pretend I'm at Park Street (demo)"],
            ] as [StartMode, string][]
          )
            .filter(([m]) => m !== 'saved' || places.length > 0)
            .map(([m, label]) => (
              <label key={m} className="flex min-h-11 items-center gap-2 text-sm text-slate-900">
                <input
                  type="radio"
                  name={`${ids}-start`}
                  checked={startMode === m}
                  onChange={() => void chooseStart(m)}
                  className="h-5 w-5"
                />
                {t(label)}
              </label>
            ))}
          {startMode === 'saved' && (
            <select
              aria-label={t('Start at')}
              value={start?.label ?? ''}
              onChange={(e) => setStart(places.find((p) => p.label === e.target.value) ?? null)}
              className={select}
            >
              {places.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          {locError && <Notice tone="error">{locError}</Notice>}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">{t('Trip')}</legend>
          {(
            [
              ['place', 'Drive all the way'],
              ['park', 'Park at a station and take the T'],
            ] as [Goal, string][]
          ).map(([g, label]) => (
            <label key={g} className="flex min-h-11 items-center gap-2 text-sm text-slate-900">
              <input
                type="radio"
                name={`${ids}-goal`}
                checked={goal === g}
                onChange={() => setGoal(g)}
                className="h-5 w-5"
              />
              {t(label)}
            </label>
          ))}
        </fieldset>

        {goal === 'place' ? (
          <div>
            <label htmlFor={`${ids}-dest`} className="block text-sm font-semibold text-slate-900">
              {t('Going to')}
            </label>
            <select id={`${ids}-dest`} value={destLabel} onChange={(e) => setDestLabel(e.target.value)} className={select}>
              <option value="">{t('Choose a place')}</option>
              {places.length > 0 && (
                <optgroup label={t('Your places')}>
                  {places.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={t('Examples')}>
                {DEMO_DESTINATIONS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor={`${ids}-lot`} className="block text-sm font-semibold text-slate-900">
              {t('Park at (stations with accessible parking)')}
            </label>
            <select id={`${ids}-lot`} value={lotId} onChange={(e) => setLotId(e.target.value)} className={select}>
              <option value="">{t('Choose a station')}</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {t('{station}: {lot} — {n} accessible spaces', {
                    station: stationName(l.stationId),
                    lot: l.name,
                    n: l.accessibleSpaces ?? 0,
                  })}
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="submit" className={`${btnPrimary} w-full`}>
          {t('Find driving route')}
        </button>
        {formError && <Notice tone="error">{formError}</Notice>}
      </form>

      <div aria-live="polite" className="mt-3">
        {query && drive.isLoading && <p className="text-sm text-slate-800">{t('Finding a driving route…')}</p>}
        {query && drive.error && <Notice tone="error">{t('Driving directions are not available right now.')}</Notice>}
      </div>

      {query && result && (
        <section className="mt-3 rounded-md border border-slate-500 bg-white p-3 text-slate-900">
          <h3 className="font-bold">{t('Drive to {place}', { place: query.toText })}</h3>
          <p className="text-sm">
            {t('About {min} min, {dist}.', { min: mins(result.minutes), dist: formatDistance(result.distanceM) })}{' '}
            {result.approximate && t('Straight-line estimate: road routing is not available right now.')}
          </p>
          <SourceBadge source={drive.data?.source} fetchedAt={drive.data?.fetchedAt} />
          <details className="mt-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
              {t('Turn-by-turn ({n} steps)', { n: result.steps.length })}
            </summary>
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              {result.steps.map((s, i) => (
                <li key={i}>
                  {s.instruction} {s.distanceM > 0 && <span className="text-slate-700">({formatDistance(s.distanceM)})</span>}
                </li>
              ))}
            </ol>
          </details>

          {query.lot && query.stationId ? (
            <div className="mt-2 space-y-2 text-sm">
              <p>
                {t('{lot}: {n} accessible spaces.', { lot: query.lot.name, n: query.lot.accessibleSpaces ?? 0 })}
                {query.lot.feeDaily && ` ${t('Daily fee: {fee}', { fee: query.lot.feeDaily.trim() })}`}
              </p>
              <button type="button" className={btn} onClick={() => onPlanTrain(query.stationId!)}>
                {t('Plan the step-free train from {station}', { station: stationName(query.stationId) })}
              </button>
            </div>
          ) : (
            <div className="mt-2 text-sm">
              <h4 className="font-semibold">{t('Accessible parking near {place}', { place: query.toText })}</h4>
              {result.parking.length ? (
                <ul className="mt-1 space-y-1">
                  {result.parking.map((l) => (
                    <li key={l.id}>
                      {t('{lot} ({station}): {n} accessible spaces, {dist} away', {
                        lot: l.name,
                        station: stationName(l.stationId),
                        n: l.accessibleSpaces ?? 0,
                        dist: formatDistance(l.distanceM),
                      })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t('No MBTA lots with accessible spaces near here. Check street parking signs on arrival.')}</p>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-700">{t('Driving times are estimates without live traffic.')}</p>
        </section>
      )}
    </section>
  );
}
