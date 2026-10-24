'use client';
// Plain-language alert text (/api/alert-summary). Shown above MBTA's own text, which stays available.
import { useMemo } from 'react';
import useSWR from 'swr';
import { fetchJson, type ApiEnvelope } from '@/lib/ui/api';
import { useT } from '@/lib/i18n';

export type PlainAlert = { id: string; text: string; source: 'claude' | 'mbta' };

export function useAlertSummary() {
  const { data } = useSWR<ApiEnvelope<{ items: PlainAlert[] }>>('/api/alert-summary', fetchJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: 5 * 60_000,
    refreshWhenHidden: false,
  });
  return useMemo(() => new Map((data?.data.items ?? []).map((i) => [i.id, i])), [data]);
}

/**
 * "Summary: ..." plus MBTA's original text. When the summary is just MBTA's header (no AI), shows the
 * original text once. `original` is MBTA's text for this alert.
 */
export function AlertText({ summary, original }: { summary: PlainAlert | undefined; original: string }) {
  const t = useT();
  const same = !summary || summary.text.trim() === original.trim();
  if (same) return <p className="mt-1 text-[14px] font-medium leading-snug text-ink-2">{original}</p>;
  const ai = summary.source === 'claude';
  return (
    <div className="mt-2 rounded-2xl border border-line bg-soft px-3 pt-2.5 text-[14px] font-medium leading-snug text-ink">
      <p className="flex items-start gap-2">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${ai ? 'text-t-blue' : 'text-muted'}`}
          fill={ai ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={ai ? 0 : 2}
          strokeLinecap="round"
        >
          {ai ? (
            <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
          ) : (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8v.5" />
            </>
          )}
        </svg>
        <span className="min-w-0">
          <strong className="font-bold">{t('Summary:')}</strong> {summary.text}
          {ai && <span className="ml-1 text-[13px] font-medium text-muted">{t("(written by AI from MBTA's alert)")}</span>}
        </span>
      </p>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center pl-6 text-[14px] font-bold text-t-blue underline decoration-t-blue/30 underline-offset-4 hover:decoration-t-blue">
          {t("MBTA's original text")}
        </summary>
        <p className="pb-2.5 pl-6 text-ink-2">{original}</p>
      </details>
    </div>
  );
}
