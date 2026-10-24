'use client';
// WAI-ARIA tabs with automatic activation: Left/Right/Home/End move between tabs.
// Looks like a segmented pill nav (icon over a short label); the dark pill slides to the active tab.
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export type TabDef = { id: string; label: string; content: ReactNode };

/** Small 22px stroke icons for the known tab ids. */
function TabIcon({ id }: { id: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'shrink-0',
  };
  if (id === 'trip')
    return (
      <svg {...common}>
        <circle cx="6" cy="19" r="2.5" />
        <circle cx="18" cy="5" r="2.5" />
        <path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" />
      </svg>
    );
  if (id === 'broken')
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M12 3v18M8 9.5l-1.5 2h3zM16 14.5l1.5-2h-3z" />
      </svg>
    );
  if (id === 'drive')
    return (
      <svg {...common}>
        <path d="M5 17h14v-4.5l-2-5.5H7l-2 5.5z" />
        <path d="M5 12.5h14" />
        <circle cx="8" cy="17" r="1.8" />
        <circle cx="16" cy="17" r="1.8" />
      </svg>
    );
  if (id === 'crash')
    return (
      <svg {...common}>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17v.01" />
      </svg>
    );
  if (id === 'mine')
    return (
      <svg {...common}>
        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
      </svg>
    );
  if (id === 'more')
    return (
      <svg {...common}>
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export default function Tabs({
  tabs,
  active,
  onChange,
  label,
  page,
  navClassName = '',
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  /** Optional page shown instead of the tab panels (panels stay mounted, so their state is kept). */
  page?: ReactNode;
  /** Extra classes for the nav wrapper (the app shell pins it). */
  navClassName?: string;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIdx = tabs.findIndex((t) => t.id === active);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  const pillStyle: CSSProperties = {
    width: `calc((100% - 12px - ${(tabs.length - 1) * 4}px) / ${Math.max(tabs.length, 1)})`,
    transform: `translateX(calc(${Math.max(activeIdx, 0)} * (100% + 4px)))`,
    opacity: activeIdx < 0 ? 0 : 1,
  };

  return (
    <div>
      <div className={navClassName}>
        <div
          role="tablist"
          aria-label={label}
          className="relative flex gap-1 rounded-full border border-line bg-soft p-1.5"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1.5 left-1.5 top-1.5 rounded-full bg-ink shadow-sh1 transition-[transform,opacity] duration-500 ease-[var(--spring)]"
            style={pillStyle}
          />
          {tabs.map((t, i) => {
            const selected = t.id === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="tab"
                type="button"
                id={`${base}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`${base}-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(t.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`relative z-[1] flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1 text-[11px] font-bold leading-tight transition-colors duration-200 active:scale-[.97] ${
                  selected ? 'text-white' : 'text-ink-2 hover:text-ink'
                }`}
              >
                <TabIcon id={t.id} />
                <span className="max-w-full truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {page && (
        <div key="page" className="lm-in pt-3">
          {page}
        </div>
      )}
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={!!page || t.id !== active}
          tabIndex={0}
          className="lm-in pt-3 outline-offset-4"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
