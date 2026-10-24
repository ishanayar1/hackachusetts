import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, socialProviders } from '@/lib/server/auth';
import LoginForm from './LoginForm';

// Reads the session cookie on every request and redirects on the server, so this page blocks (no static shell).
export const instant = false;

export const metadata: Metadata = { title: 'Sign in · LastMile' };

export default async function LoginPage() {
  if (await auth.api.getSession({ headers: await headers() })) redirect('/');
  return (
    <main className="grid min-h-dvh place-items-center bg-soft px-4 py-8 text-ink">
      <div className="lm-in w-full max-w-md rounded-sheet border border-line bg-white p-6 shadow-sh3 sm:p-8">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M5 19V9a7 7 0 0 1 14 0v10" fill="none" stroke="#FFC72C" strokeWidth="3" strokeLinecap="round" />
              <circle cx="12" cy="9" r="2.6" fill="#fff" />
            </svg>
          </span>
          {/* Same classes as pageTitle / mutedText in components/ui (a client module, so not imported here). */}
          <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-ink">LastMile</h1>
        </div>
        <p className="mb-6 mt-3 text-[14px] font-medium text-muted">
          Sign in to use LastMile. Your stations and places are kept on your account.
        </p>
        <LoginForm providers={socialProviders} />
      </div>
    </main>
  );
}
