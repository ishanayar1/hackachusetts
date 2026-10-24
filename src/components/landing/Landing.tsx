// Signed-out home page: the cinematic hero, then what each tab does, who it's for, and where the data comes from.
import { Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import CinematicHero, { GITHUB_URL, GitHubIcon } from './CinematicHero';
import { LogoMark, TAB_ICONS } from './PhoneScreen';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

// Counts from public/data (facilities.json, stations.json) and src/lib/i18n.ts.
const STATS = [
  ['125', 'subway stations'],
  ['188', 'elevators watched live'],
  ['454', 'elevators, ramps, lifts and escalators'],
  ['6', 'languages'],
] as const;

const ICONS = {
  ...TAB_ICONS,
  Crash: 'M12 2l8.7 5v10L12 22l-8.7-5V7L12 2zM12 8v5M12 16h.01',
  Assistant: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
};

// Crash wording rule (src/lib/crash.ts): "recorded crashes", never a prediction or "risk".
const FEATURES: { icon: keyof typeof ICONS; label: string; color: string; title: string; body: string }[] = [
  { icon: 'Trip', label: 'Trip', color: '#DA291C', title: 'Trips that skip the stairs', body: 'Step-free subway routes that reroute around closed elevators, with the walk and the entrance to use.' },
  { icon: 'Broken', label: 'Broken', color: '#ED8B00', title: "What's broken right now", body: 'Every elevator, escalator, ramp and portable lift out of service, in plain language.' },
  { icon: 'Station', label: 'Station', color: '#00843D', title: 'Know the station first', body: 'Step-free status, accessible entrances and the next trains for any station.' },
  { icon: 'Safety', label: 'Safety', color: '#003DA5', title: 'Watch the walk', body: 'Poor curb ramps and open sidewalk reports along the way, on the map and as a list.' },
  { icon: 'Crash', label: 'Crash spots', color: '#7C878E', title: 'Know the crash history', body: 'Search Boston intersections by recorded pedestrian and bike crashes from Vision Zero data. Tap one to see it on the map.' },
  { icon: 'Assistant', label: 'Safe route', color: '#008EAA', title: 'Ask for a safer bike route', body: 'Name two places in plain words. The assistant picks the route with the fewest recorded crashes and avoids the worst intersections.' },
  { icon: 'Mine', label: 'Mine', color: '#FFC72C', title: 'Your stations, watched', body: 'Star the stations you use. LastMile flags it when one stops being step-free.' },
  { icon: 'More', label: 'More', color: '#80276C', title: 'And the rest of the trip', body: 'Driving and park & ride with accessible parking, in six languages.' },
];

const FOR_WHO = ['Wheelchair users', 'Parents with strollers', 'Canes and walkers', 'Heavy luggage', 'Older riders'];

const PROMISES = [
  ['Everything on the map is also a text list.', 'Screen reader users get the same information, not a summary.'],
  ['Finger-sized controls, visible keyboard focus.', '44 px map buttons and a clear focus ring on everything you can press.'],
  ['Plain words, six languages.', 'English, Español, Português, Kreyòl ayisyen, 中文 and Tiếng Việt.'],
] as const;

function Legend({ color, mark, label }: { color: string; mark: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-base font-bold shadow-sm">
      <span className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: color }} aria-hidden="true">
        {mark}
      </span>
      {label}
    </span>
  );
}

function Buttons() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#111] px-6 py-3.5 text-base font-extrabold text-white transition hover:-translate-y-0.5">
        Plan a step-free trip
      </Link>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 rounded-full border border-black/20 px-6 py-3.5 text-base font-bold text-[#111] transition hover:bg-black/5"
      >
        <GitHubIcon className="h-5 w-5" /> View on GitHub
      </a>
    </div>
  );
}

export default function Landing() {
  return (
    <div className={`${jakarta.className} w-full overflow-x-hidden bg-[#F4F2EC] text-[#111]`}>
      <header className="fixed inset-x-0 top-0 z-[60] flex items-center justify-between px-4 py-4 md:px-8">
        <Link href="/" className="inline-flex items-center gap-2 rounded-full bg-white/85 py-1.5 pl-1.5 pr-4 text-lg font-extrabold tracking-tight shadow-lg backdrop-blur">
          <LogoMark size={30} /> LastMile
        </Link>
        <Link href="/login" className="rounded-full bg-[#111] px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5">
          Sign in
        </Link>
      </header>

      <main>
        <CinematicHero />

        {/* Stats */}
        <section aria-label="LastMile in numbers" className="mx-4 grid max-w-6xl grid-cols-2 min-[1184px]:mx-auto gap-px overflow-hidden rounded-3xl bg-black/10 md:grid-cols-4">
          {STATS.map(([n, label]) => (
            <div key={label} className="bg-[#F4F2EC] px-6 py-8 text-center">
              <p className="text-4xl font-extrabold tracking-tight md:text-5xl">{n}</p>
              <p className="mt-1 text-sm font-medium text-slate-600">{label}</p>
            </div>
          ))}
        </section>

        {/* Tabs */}
        <section className="mx-auto max-w-6xl px-4 py-24 md:px-8">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Everything in the app</p>
          <h2 className="mt-3 max-w-3xl text-4xl font-extrabold tracking-tight md:text-6xl">Get there without the stairs.</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <article key={f.label} className="relative overflow-hidden rounded-3xl bg-white p-7 shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)]">
                <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: f.color }} aria-hidden="true" />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#111] px-3 py-1.5 text-xs font-bold text-white">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={ICONS[f.icon]} />
                  </svg>
                  {f.label}
                </span>
                <h3 className="mt-5 text-xl font-extrabold tracking-tight">{f.title}</h3>
                <p className="mt-2 leading-relaxed text-slate-600">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Who it's for */}
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-24 md:px-8 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Made for people who can&apos;t use stairs</p>
            <h2 className="mt-3 text-4xl font-extrabold tracking-tight md:text-5xl">One look tells you if a station works for you.</h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <Legend color="#2E7D32" mark="✓" label="Step-free" />
              <Legend color="#D97706" mark="!" label="Partly" />
              <Legend color="#DC2626" mark="✕" label="Not step-free" />
            </div>
            <ul className="mt-8 flex flex-wrap gap-2">
              {FOR_WHO.map((w) => (
                <li key={w} className="rounded-full border border-black/15 px-4 py-1.5 text-sm font-semibold">
                  {w}
                </li>
              ))}
            </ul>
          </div>
          <ul className="space-y-4">
            {PROMISES.map(([t, d]) => (
              <li key={t} className="rounded-3xl bg-white p-6 shadow-sm">
                <p className="text-lg font-extrabold tracking-tight">{t}</p>
                <p className="mt-1 text-slate-600">{d}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing CTA */}
        <section className="px-4 pb-6 md:px-8">
          <div className="mx-auto max-w-6xl rounded-[40px] bg-[#DBCDF0] px-8 py-16 text-[#111] md:px-16 md:py-20">
            <h2 className="max-w-2xl text-4xl font-extrabold tracking-tight md:text-6xl">Check the elevators before you leave.</h2>
            <p className="mt-5 max-w-xl text-lg text-slate-700">
              Live data from the MBTA V3 API and GTFS feed, with Boston Vision Zero crash records. Built at Hackachusetts 2026, Civic Action track.
            </p>
            <div className="mt-10">
              <Buttons />
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 md:flex-row md:justify-between md:px-8">
        <p>LastMile is a hackathon project, not an MBTA service.</p>
        <p>Walking times are estimates. Check posted signs at the station.</p>
      </footer>
    </div>
  );
}
