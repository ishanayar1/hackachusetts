'use client';
// Who is signed in, a link to edit the onboarding answers, and sign-out (the app needs an account).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { authClient } from '@/lib/ui/auth-client';
import { clearMyStations } from '@/lib/ui/myStations';
import { btn } from './ui';

export default function Account() {
  const t = useT();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  if (!session) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="hidden text-slate-700 sm:inline">{session.user.name || session.user.email}</span>
      <Link href="/welcome" className={btn}>
        {t('Edit my profile')}
      </Link>
      <button
        type="button"
        className={btn}
        onClick={async () => {
          await authClient.signOut();
          clearMyStations();
          router.replace('/login');
        }}
      >
        {t('Sign out')}
      </button>
    </div>
  );
}
