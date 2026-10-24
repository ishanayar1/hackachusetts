import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, socialProviders } from '@/lib/server/auth';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · LastMile' };

export default async function LoginPage() {
  if (await auth.api.getSession({ headers: await headers() })) redirect('/');
  return (
    <main className="mx-auto max-w-sm px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-extrabold tracking-tight">LastMile</h1>
      <p className="mb-6 text-sm text-slate-700">Sign in to use LastMile. Your stations and places are kept on your account.</p>
      <LoginForm providers={socialProviders} />
    </main>
  );
}
