// Shared Claude client (official Anthropic SDK). Server-side in practice, but free of 'server-only' so tests can
// import it. The key comes from ANTHROPIC_API_KEY, or "anthropic" in .env; without a key every Claude feature
// stays off and callers fall back to plain MBTA / English text.
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-opus-5-5';

export function claudeApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.anthropic || undefined;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClaudeOptions {
  apiKey?: string; // defaults to claudeApiKey()
  fetch?: FetchLike; // test hook
  timeoutMs?: number;
}

/** A client, or null when no key is configured. No retries: callers fall back instead of waiting. */
export function claudeClient(opts: ClaudeOptions = {}): Anthropic | null {
  const apiKey = opts.apiKey ?? claudeApiKey();
  if (!apiKey) return null;
  return new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: opts.timeoutMs ?? 20_000,
    ...(opts.fetch ? { fetch: opts.fetch as unknown as typeof fetch } : {}),
  });
}

/** The reply's text, or null on a refusal or an empty reply. */
export function replyText(msg: Anthropic.Message): string | null {
  if (msg.stop_reason === 'refusal' || !Array.isArray(msg.content)) return null;
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
  return text || null;
}
