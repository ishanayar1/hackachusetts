import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import LastMileApp from '@/components/LastMileApp';
import Landing from '@/components/landing/Landing';
import { gateRedirect, ProfileSchema } from '@/lib/profile';
import { auth } from '@/lib/server/auth';

// Reads the session cookie on every request and redirects on the server, so this page blocks (no static shell).
export const instant = false;

// Signed-out visitors get the landing page; signed-in users without a finished profile go to /welcome.
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <Landing />;
  const to = gateRedirect(session);
  if (to) redirect(to);
  return <LastMileApp profile={ProfileSchema.parse(session!.user.profile)} />;
}
