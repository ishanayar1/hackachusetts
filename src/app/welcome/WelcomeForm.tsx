'use client';
// Three short questions after sign-up: main way of travel, access needs, saved places.
import { useEffect, useId, useRef, useState } from 'react';
import { btn, btnPrimary, Notice } from '@/components/ui';
import type { GeoHit } from '@/lib/geocode';
import { useT } from '@/lib/i18n';
import { ProfileSchema, type Need, type Profile, type SavedPlace, type Service } from '@/lib/profile';
import { authClient } from '@/lib/ui/auth-client';

const SERVICE_TEXT: [Service, string][] = [
  ['transit', 'MBTA subway (step-free routes)'],
  ['drive', 'My own car'],
  ['park-ride', 'Car to a station, then the T (park & ride)'],
];
const NEED_TEXT: [Need, string][] = [
  ['wheelchair', 'Wheelchair or scooter'],
  ['stroller', 'Stroller'],
  ['walker', 'Cane, walker or limited walking'],
  ['low-vision', 'Low vision'],
  ['hearing', 'Deaf or hard of hearing'],
  ['none', 'None of these'],
];
const MAX_PLACES = 10;
const input = 'mt-1 block min-h-11 w-full rounded-md border border-slate-500 px-3 text-base';

type Row = { key: number; kind: SavedPlace['kind']; name: string; query: string; hit: GeoHit | null };
let nextKey = 0;
const row = (kind: Row['kind'], p?: SavedPlace): Row => ({
  key: nextKey++,
  kind,
  name: p && kind === 'other' ? p.label : '',
  query: p?.address ?? '',
  hit: p ? { label: p.address, lat: p.lat, lon: p.lon } : null,
});

function initialRows(initial: Profile | null): Row[] {
  const places = initial?.places ?? [];
  const find = (k: 'home' | 'work') => places.find((p) => p.kind === k);
  const others = places.filter((p) => p.kind === 'other').map((p) => row('other', p));
  return [row('home', find('home')), row('work', find('work')), ...(others.length ? others : [row('other')])];
}

export default function WelcomeForm({ initial }: { initial: Profile | null }) {
  const t = useT();
  const ids = useId();
  const [step, setStep] = useState(1);
  const [service, setService] = useState<Service | null>(initial?.service ?? null);
  const [needs, setNeeds] = useState<Need[]>(initial?.needs ?? []);
  const [rows, setRows] = useState<Row[]>(() => initialRows(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Move focus to each step's heading so screen readers hear the new question.
  useEffect(() => heading.current?.focus(), [step]);

  const toggleNeed = (n: Need) =>
    setNeeds((cur) =>
      n === 'none'
        ? cur.includes('none') ? [] : ['none']
        : cur.includes(n) ? cur.filter((x) => x !== n) : [...cur.filter((x) => x !== 'none'), n],
    );
  const updateRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    const places: SavedPlace[] = rows
      .filter((r) => r.hit)
      .map((r) => ({
        kind: r.kind,
        label: r.kind === 'home' ? 'Home' : r.kind === 'work' ? 'Work' : (r.name.trim() || r.hit!.label).slice(0, 40),
        address: r.hit!.label.slice(0, 200),
        lat: r.hit!.lat,
        lon: r.hit!.lon,
      }));
    const parsed = ProfileSchema.safeParse({ service, needs, places });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t('Something went wrong. Try again.'));
    setBusy(true);
    setError(null);
    const { error } = await authClient.updateUser({ profile: parsed.data });
    setBusy(false);
    if (error) return setError(error.message ?? t('Could not save. Try again.'));
    // Full load: the client router may still hold the old "/" -> "/welcome" redirect.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/');
  }

  const next = () => {
    if (step === 1 && !service) return setError(t('Choose how you will travel most.'));
    setError(null);
    setStep(step + 1);
  };

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-700">{t('Step {n} of 3', { n: step })}</p>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
        {t(step === 1 ? 'How will you travel most?' : step === 2 ? 'What should we plan around?' : 'Save your places')}
      </h2>

      {step === 1 && (
        <fieldset>
          <legend className="sr-only">{t('How will you travel most?')}</legend>
          {SERVICE_TEXT.map(([id, label]) => (
            <label key={id} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name={`${ids}-service`}
                checked={service === id}
                onChange={() => setService(id)}
                className="h-5 w-5"
              />
              {t(label)}
            </label>
          ))}
        </fieldset>
      )}

      {step === 2 && (
        <fieldset>
          <legend className="text-sm text-slate-700">{t('Optional. Pick any that apply.')}</legend>
          {NEED_TEXT.map(([id, label]) => (
            <label key={id} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={needs.includes(id)} onChange={() => toggleNeed(id)} className="h-5 w-5" />
              {t(label)}
            </label>
          ))}
        </fieldset>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">{t('Optional. Search an address in Greater Boston and pick the right one.')}</p>
          {rows.map((r) => (
            <PlaceRow
              key={r.key}
              row={r}
              onChange={(patch) => updateRow(r.key, patch)}
              onRemove={r.kind === 'other' ? () => setRows((rs) => rs.filter((x) => x.key !== r.key)) : undefined}
            />
          ))}
          {rows.length < MAX_PLACES && (
            <button type="button" className={btn} onClick={() => setRows((rs) => [...rs, row('other')])}>
              {t('Add another place')}
            </button>
          )}
        </div>
      )}

      <div role="alert">{error && <Notice tone="error">{error}</Notice>}</div>
      <div className="flex flex-wrap gap-2">
        {step > 1 && (
          <button type="button" className={btn} onClick={() => setStep(step - 1)}>
            {t('Back')}
          </button>
        )}
        {step < 3 ? (
          <button type="button" className={btnPrimary} onClick={next}>
            {t('Next')}
          </button>
        ) : (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {t(busy ? 'Saving…' : 'Save and start')}
          </button>
        )}
      </div>
    </div>
  );
}

function PlaceRow({ row: r, onChange, onRemove }: { row: Row; onChange: (p: Partial<Row>) => void; onRemove?: () => void }) {
  const t = useT();
  const ids = useId();
  const [results, setResults] = useState<GeoHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = r.kind === 'home' ? t('Home') : r.kind === 'work' ? t('Work') : t('Other place');

  async function search() {
    if (r.query.trim().length < 3) return;
    setSearching(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(r.query.trim())}`);
      if (!res.ok) throw new Error(String(res.status));
      setResults(((await res.json()) as { data: GeoHit[] }).data);
    } catch {
      setFailed(true);
      setResults(null);
    }
    setSearching(false);
  }

  return (
    <fieldset className="rounded-md border border-slate-300 p-3">
      <legend className="px-1 font-semibold">{title}</legend>
      {r.kind === 'other' && (
        <label className="block text-sm font-semibold">
          {t('Name')}
          <input
            className={input}
            value={r.name}
            maxLength={40}
            placeholder={t('e.g. Clinic')}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
      )}
      <label className="mt-2 block text-sm font-semibold" htmlFor={`${ids}-q`}>
        {t('Address')}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={`${ids}-q`}
          className={`${input} mt-0`}
          value={r.query}
          autoComplete="street-address"
          onChange={(e) => onChange({ query: e.target.value, hit: null })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className={btn} disabled={searching} onClick={() => void search()}>
          {t('Search')}
        </button>
      </div>
      <div aria-live="polite" className="mt-2 text-sm">
        {searching && <p>{t('Searching…')}</p>}
        {failed && <Notice tone="error">{t('Address search is not available right now. You can skip this.')}</Notice>}
        {results && results.length === 0 && <p>{t('No match in Greater Boston. Try adding the town.')}</p>}
        {r.hit && !results && <p>{t('Saved: {place}', { place: r.hit.label })}</p>}
      </div>
      {results && results.length > 0 && (
        <fieldset className="mt-1">
          <legend className="sr-only">{t('Pick the right address')}</legend>
          {results.map((h) => (
            <label key={`${h.lat},${h.lon}`} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${ids}-hit`}
                checked={r.hit?.lat === h.lat && r.hit?.lon === h.lon}
                onChange={() => onChange({ hit: h })}
                className="h-5 w-5"
              />
              {h.label}
            </label>
          ))}
        </fieldset>
      )}
      {onRemove && (
        <button type="button" className={`${btn} mt-2`} onClick={onRemove}>
          {t('Remove')}
        </button>
      )}
    </fieldset>
  );
}
