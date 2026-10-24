'use client';
// Interface language picker for the header. MBTA alert text stays in English (MBTA publishes it in English).
import { useEffect, useId, useState } from 'react';
import { isLang, LANGUAGES, setLang, useT } from '@/lib/i18n';

export default function LanguageSwitcher() {
  const t = useT();
  const id = useId();
  // GET /api/translate says whether the server can translate (needs an Anthropic key). Without it the picker is
  // hidden, unless a non-English choice is already saved, so the user can still switch back to English.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/translate')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { enabled?: unknown } | null) => {
        if (live) setEnabled(j?.enabled === true);
      })
      .catch(() => {
        if (live) setEnabled(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = t.lang;
  }, [t.lang]);
  if (enabled !== true && t.lang === 'en') return null;
  return (
    <div className="relative flex shrink-0 items-center text-ink">
      {/* Globe sits inside the pill; clicks pass through to the select. */}
      <label htmlFor={id} className="pointer-events-none absolute left-3 inline-flex items-center">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="size-[18px]">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sr-only">
          {t('Language')}
          {t.lang !== 'en' && <span> (Language)</span>}
        </span>
      </label>
      <select
        id={id}
        value={t.lang}
        onChange={(e) => {
          if (isLang(e.target.value)) setLang(e.target.value);
        }}
        className="min-h-11 max-w-[11rem] cursor-pointer appearance-none truncate rounded-full border border-line bg-white pl-9 pr-8 text-[14px] font-bold text-ink shadow-sh2 outline-none transition duration-200 hover:shadow-sh3 focus:border-t-blue focus:ring-4 focus:ring-t-blue/15"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 size-3.5 text-muted"
      >
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
