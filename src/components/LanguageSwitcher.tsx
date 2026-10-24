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
    <div className="flex shrink-0 items-center gap-1.5 text-sm text-slate-900">
      <label htmlFor={id} className="font-semibold">
        <span aria-hidden="true">🌐 </span>
        {t('Language')}
        {t.lang !== 'en' && <span className="sr-only"> (Language)</span>}
      </label>
      <select
        id={id}
        value={t.lang}
        onChange={(e) => {
          if (isLang(e.target.value)) setLang(e.target.value);
        }}
        className="min-h-11 rounded-md border border-slate-600 bg-white px-1 text-sm text-slate-900"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
