// GET /icons/192, /icons/512 -> rounded LastMile icon PNG (manifest purpose "any").
// GET /icons/maskable-192, /icons/maskable-512 -> full-bleed version (manifest purpose "maskable").
import { ImageResponse } from 'next/og';
import { connection } from 'next/server';
import { IconArt } from '../icon-art';

const SIZE_RE = /^(maskable-)?(192|512)$/;

export async function GET(_request: Request, ctx: { params: Promise<{ size: string }> }) {
  await connection();
  const { size: raw } = await ctx.params;
  const m = SIZE_RE.exec(raw);
  if (!m) {
    return Response.json({ error: 'size must be 192, 512, maskable-192 or maskable-512' }, { status: 404 });
  }
  const maskable = Boolean(m[1]);
  const px = Number(m[2]);
  return new ImageResponse(<IconArt size={px} rounded={!maskable} />, {
    width: px,
    height: px,
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}
