import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import LastMileApp from '@/components/LastMileApp';
import { gateRedirect } from '@/lib/profile';
import { auth } from '@/lib/server/auth';

// Reads the session cookie on every request and redirects on the server, so this page blocks (no static shell).
export const instant = false;

// Signed-in users with a finished profile only: everyone else goes to /login, then /welcome.
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  const to = gateRedirect(session);
  if (to) redirect(to);
  return <LastMileApp />;
}
