import type { Metadata } from 'next';
import { socialProviders } from '@/lib/server/auth';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · LastMile' };

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-extrabold tracking-tight">LastMile</h1>
      <p className="mb-6 text-sm text-slate-700">Sign in to keep My stations on every device.</p>
      <LoginForm providers={socialProviders} />
    </main>
  );
}
