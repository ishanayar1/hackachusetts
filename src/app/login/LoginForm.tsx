'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { btn, btnPrimary, Notice } from '@/components/ui';
import { authClient } from '@/lib/ui/auth-client';

const LABEL = { google: 'Google', github: 'GitHub' } as const;
const input = 'mt-1 block min-h-11 w-full rounded-md border border-slate-500 px-3 text-base';

export default function LoginForm({ providers }: { providers: (keyof typeof LABEL)[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email'));
    const password = String(f.get('password'));
    setBusy(true);
    setError(null);
    const { error } =
      mode === 'up'
        ? await authClient.signUp.email({ email, password, name: String(f.get('name')) })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) setError(error.message ?? 'Something went wrong. Try again.');
    else router.push('/');
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3">
        {mode === 'up' && (
          <label className="block text-sm font-semibold">
            Name
            <input name="name" required autoComplete="name" className={input} />
          </label>
        )}
        <label className="block text-sm font-semibold">
          Email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className="block text-sm font-semibold">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            className={input}
          />
        </label>
        <div role="alert">{error && <Notice tone="error">{error}</Notice>}</div>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {mode === 'up' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button
        type="button"
        className="min-h-11 text-sm font-semibold text-blue-800 underline"
        onClick={() => {
          setMode(mode === 'in' ? 'up' : 'in');
          setError(null);
        }}
      >
        {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>

      {providers.length > 0 && (
        <div className="space-y-2 border-t border-slate-300 pt-4">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              className={`${btn} w-full`}
              onClick={() => authClient.signIn.social({ provider: p, callbackURL: '/' })}
            >
              Continue with {LABEL[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
