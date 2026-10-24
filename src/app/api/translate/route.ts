// GET: is interface translation available (an Anthropic key is set)?
// POST { lang, strings }: translate English interface strings with Claude -> { translations }.
import { connection } from 'next/server';
import { claudeApiKey, claudeClient } from '@/lib/claude';
import { isTranslateLang, MAX_LEN, MAX_STRINGS, translateStrings } from '@/lib/translate';

export async function GET() {
  await connection();
  return Response.json({ enabled: Boolean(claudeApiKey()) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  await connection();
  const client = claudeClient();
  if (!client) return Response.json({ error: 'Translation is off: no Anthropic key is set.' }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Send JSON: { lang, strings }.' }, { status: 400 });
  }
  const { lang, strings } = (body ?? {}) as { lang?: unknown; strings?: unknown };
  const valid =
    isTranslateLang(lang) &&
    Array.isArray(strings) &&
    strings.length > 0 &&
    strings.length <= MAX_STRINGS &&
    strings.every((s) => typeof s === 'string' && s.trim() !== '' && s.length <= MAX_LEN);
  if (!valid) {
    return Response.json(
      { error: `lang must be one of es, pt, ht, zh-Hans, vi; strings must be 1-${MAX_STRINGS} non-empty strings of at most ${MAX_LEN} characters.` },
      { status: 400 },
    );
  }

  try {
    const translations = await translateStrings(client, lang, strings as string[]);
    return Response.json({ translations });
  } catch {
    return Response.json({ error: 'Translation failed. The interface stays in English.' }, { status: 502 });
  }
}
