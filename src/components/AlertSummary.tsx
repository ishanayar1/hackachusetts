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
  if (same) return <p className="mt-1 text-sm text-slate-800">{original}</p>;
  return (
    <div className="mt-1 text-sm text-slate-800">
      <p>
        <strong>{t('Summary:')}</strong> {summary.text}
        {summary.source === 'claude' && (
          <span className="ml-1 text-xs text-slate-700">{t("(written by AI from MBTA's alert)")}</span>
        )}
      </p>
      <details className="mt-1">
        <summary className="min-h-11 cursor-pointer py-2 text-blue-800 underline">{t("MBTA's original text")}</summary>
        <p>{original}</p>
      </details>
    </div>
  );
}
