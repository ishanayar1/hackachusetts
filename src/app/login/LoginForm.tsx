'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { btn, btnPrimary, input as inputCls, Notice } from '@/components/ui';
import { authClient } from '@/lib/ui/auth-client';

const LABEL = { google: 'Google', github: 'GitHub' } as const;
const input = `${inputCls} mt-1.5 block`;
const label = 'block text-[14px] font-bold text-ink';

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
      <form onSubmit={onSubmit} className="space-y-3.5">
        {mode === 'up' && (
          <label className={label}>
            Name
            <input name="name" required autoComplete="name" className={input} />
          </label>
        )}
        <label className={label}>
          Email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className={label}>
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
        <button type="submit" disabled={busy} className={`${btnPrimary} min-h-12 w-full`}>
          {mode === 'up' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button
        type="button"
        className="mx-auto flex min-h-11 items-center rounded-full px-3 text-[14px] font-bold text-t-blue underline decoration-2 underline-offset-4 transition duration-200 hover:bg-soft active:scale-[.97]"
        onClick={() => {
          setMode(mode === 'in' ? 'up' : 'in');
          setError(null);
        }}
      >
        {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>

      {providers.length > 0 && (
        <div className="space-y-2.5 border-t border-line pt-4">
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
