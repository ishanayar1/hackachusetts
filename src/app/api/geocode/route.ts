// GET /api/geocode?q=<address> -> { data: GeoHit[] }  (Greater Boston only, signed-in users only)
// Signed-in only so the shared Nominatim quota is not open to the whole internet.
import { headers } from 'next/headers';
import { geocode } from '@/lib/geocode';
import { auth } from '@/lib/server/auth';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  if (!(await auth.api.getSession({ headers: await headers() }))) {
    return Response.json({ error: 'Sign in to search addresses.' }, { status: 401, headers: NO_STORE });
  }
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 3 || q.length > 200) {
    return Response.json({ error: 'q must be 3 to 200 characters' }, { status: 400, headers: NO_STORE });
  }
  return Response.json({ data: await geocode(q) }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
