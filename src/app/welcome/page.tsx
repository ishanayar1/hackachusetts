import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ProfileSchema } from '@/lib/profile';
import { auth } from '@/lib/server/auth';
import WelcomeForm from './WelcomeForm';

// Reads the session cookie on every request and redirects on the server, so this page blocks (no static shell).
export const instant = false;

export const metadata: Metadata = { title: 'Get started · LastMile' };

// First run after sign-up, and "Edit my profile" later (answers prefilled).
export default async function WelcomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const saved = ProfileSchema.safeParse(session.user.profile);
  return (
    <main className="mx-auto max-w-lg px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-extrabold tracking-tight">LastMile</h1>
      <WelcomeForm initial={saved.success ? saved.data : null} />
    </main>
  );
}
