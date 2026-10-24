'use client';
// Header sign-in link, or who is signed in with a sign-out button.
import Link from 'next/link';
import { authClient } from '@/lib/ui/auth-client';
import { clearMyStations } from '@/lib/ui/myStations';
import { btn } from './ui';

export default function Account() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!session) {
    return (
      <Link href="/login" className={btn}>
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="hidden text-slate-700 sm:inline">{session.user.name || session.user.email}</span>
      <button
        type="button"
        className={btn}
        onClick={async () => {
          await authClient.signOut();
          clearMyStations();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
