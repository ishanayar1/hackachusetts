// Hand-drawn mini copy of the LastMile phone screen (map, step-free badges, bottom sheet, tab bar) for the landing mockup.
// Pure markup: elements with class "phone-widget" are staggered in by CinematicHero's scroll timeline.

type State = 'yes' | 'partial' | 'no';

const LINE = { red: '#DA291C', green: '#00843D', orange: '#ED8B00', blue: '#003DA5' } as const;
const BADGE: Record<State, string> = { yes: '#2E7D32', partial: '#D97706', no: '#DC2626' };

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#111" />
      <path d="M10 24V14a6 6 0 0 1 12 0v10" fill="none" stroke="#FFC72C" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

/** ✓ / ! / ✗ badge, same meaning as the app's map key. Drawn in SVG user units around (x, y). */
function Badge({ x, y, s }: { x: number; y: number; s: State }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="5.2" fill={BADGE[s]} stroke="#fff" strokeWidth="1.4" />
      {s === 'yes' && <path d="M-2.3 0.2l1.6 1.6 3-3.2" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
      {s === 'partial' && (
        <>
          <path d="M0-2.6v2.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          <circle cy="2.2" r="0.85" fill="#fff" />
        </>
      )}
      {s === 'no' && <path d="M-2-2l4 4M2-2l-4 4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />}
    </g>
  );
}

const STATIONS: { x: number; y: number; s: State; label?: string; dx?: number; dy?: number }[] = [
  { x: 14, y: 108, s: 'yes', label: 'Harvard', dx: 8, dy: 3 },
  { x: 56, y: 146, s: 'yes', label: 'Central', dx: 8, dy: 10 },
  { x: 98, y: 186, s: 'yes', label: 'Kendall/MIT', dx: 8, dy: 3 },
  { x: 150, y: 92, s: 'yes', label: 'Lechmere', dx: -46, dy: 3 },
  { x: 166, y: 126, s: 'yes' },
  { x: 200, y: 136, s: 'yes', label: 'North Station', dx: 8, dy: 3 },
  { x: 216, y: 166, s: 'yes', label: 'Haymarket', dx: 8, dy: 3 },
  { x: 140, y: 212, s: 'yes', label: 'Charles/MGH', dx: -58, dy: 12 },
  { x: 176, y: 194, s: 'yes', label: 'Bowdoin', dx: -40, dy: -6 },
  { x: 204, y: 214, s: 'yes' },
  { x: 230, y: 222, s: 'yes', label: 'State', dx: 7, dy: -6 },
  { x: 182, y: 250, s: 'partial', label: 'Park Street', dx: -60, dy: 0 },
  { x: 214, y: 276, s: 'partial', label: 'Downtown Crossing', dx: 8, dy: 3 },
  { x: 172, y: 280, s: 'no', label: 'Boylston', dx: -44, dy: 12 },
  { x: 138, y: 292, s: 'yes' },
  { x: 100, y: 302, s: 'yes', label: 'Copley', dx: -14, dy: 14 },
  { x: 242, y: 300, s: 'yes', label: 'South Sta.', dx: -16, dy: 15 },
];

function TabIcon({ d }: { d: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const TAB_ICONS = {
  Trip: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  Broken: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  Station: 'M7 3h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 11h14M8 21l2-3M16 21l-2-3',
  Safety: 'M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3z',
  Mine: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z',
  More: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;

export default function PhoneScreen() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#EFEDE6] text-[#111]">
      {/* Map */}
      <svg className="phone-widget absolute inset-x-0 top-0" viewBox="0 0 266 360" width="266" height="360" aria-hidden="true">
        <defs>
          <pattern id="lm-grid" width="18" height="18" patternUnits="userSpaceOnUse">
            <path d="M18 0H0V18" fill="none" stroke="#DDD9CE" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="266" height="360" fill="url(#lm-grid)" />
        <path d="M-10 250 C 40 210, 80 230, 120 165 S 190 90, 280 70" fill="none" stroke="#CFE0EE" strokeWidth="26" strokeLinecap="round" />
        <g fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 108 L56 146 L98 186 L140 212 L182 250 L214 276 L242 300 L236 360" stroke={LINE.red} />
          <path d="M150 92 L166 126 L200 136 L216 166 L204 214 L182 250 L172 280 L138 292 L100 302 L-5 318" stroke={LINE.green} />
          <path d="M200 136 L216 166 L230 222 L214 276 L200 310 L176 362" stroke={LINE.orange} />
          <path d="M176 194 L204 214 L230 222 L262 230 L280 214" stroke={LINE.blue} />
        </g>
        {STATIONS.map((st) => (
          <g key={`${st.x},${st.y}`}>
            <circle cx={st.x} cy={st.y} r="4.4" fill="#fff" stroke="#111" strokeWidth="2.2" />
            <Badge x={st.x + 6} y={st.y - 6} s={st.s} />
            {st.label && (
              <text x={st.x + (st.dx ?? 8)} y={st.y + (st.dy ?? 3)} fontSize="7.4" fontWeight="700" fill="#111" stroke="#EFEDE6" strokeWidth="2" paintOrder="stroke">
                {st.label}
              </text>
            )}
          </g>
        ))}
        {/* Out-of-service marker, as on the live map. */}
        <g transform="translate(150 258)">
          <rect x="-9" y="-9" width="18" height="18" rx="4" fill="#DC2626" />
          <path d="M-3.5-3.5l7 7M3.5-3.5l-7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>

      {/* Search bar */}
      <div className="phone-widget absolute left-3 right-3 top-10 flex items-center gap-1.5">
        <LogoMark size={26} />
        <div className="flex h-7 flex-1 items-center gap-1.5 rounded-full bg-white px-2.5 text-[10px] font-semibold text-slate-500 shadow-md">
          <TabIcon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3" />
          Where to?
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md">
          <TabIcon d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
        </div>
      </div>

      {/* Map key */}
      <div className="phone-widget absolute left-3 top-[76px] flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[8px] font-bold shadow">
        {(['yes', 'partial', 'no'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <svg width="10" height="10" viewBox="-6 -6 12 12" aria-hidden="true">
              <Badge x={0} y={0} s={s} />
            </svg>
            {s === 'yes' ? 'Step-free' : s === 'partial' ? 'Partly' : 'Not step-free'}
          </span>
        ))}
      </div>

      {/* Bottom sheet */}
      <div className="phone-widget absolute inset-x-0 bottom-0 top-[330px] rounded-t-[22px] bg-white px-4 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
        <div className="mx-auto mb-2.5 h-1 w-8 rounded-full bg-slate-300" />
        <p className="text-[17px] font-extrabold leading-[1.05] tracking-tight">
          Step-free trips,
          <br />
          no surprises.
        </p>
        <p className="mt-1 text-[9px] text-slate-500">We check every elevator on the way before you go.</p>
        <div className="mt-2.5 flex h-8 items-center gap-2 rounded-xl border-[1.5px] border-[#111] px-2.5 text-[11px] font-bold text-slate-400">
          <TabIcon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3" />
          Where to?
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[9px]">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-blue-200 bg-blue-700" />
          <span className="text-slate-500">From</span> <b>My location</b>
        </p>
        <p className="mt-2 text-[10px] font-bold">Mass General Hospital</p>
        <p className="text-[8px] text-slate-500">Fruit St · by Charles/MGH</p>
      </div>

      {/* Tab bar */}
      <div className="phone-widget absolute inset-x-2 bottom-4 flex justify-between rounded-full bg-slate-100 p-1">
        {Object.entries(TAB_ICONS).map(([name, d], i) => (
          <span
            key={name}
            className={`flex flex-col items-center gap-0.5 rounded-full px-1.5 py-1 text-[7px] font-semibold ${i === 0 ? 'bg-[#111] text-white' : 'text-slate-600'}`}
          >
            <TabIcon d={d} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
