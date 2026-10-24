'use client';
// Who is signed in, a link to edit the onboarding answers, and sign-out (the app needs an account).
// Compact 44px avatar button in the floating top bar; the actions open in a small popover card.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { authClient } from '@/lib/ui/auth-client';
import { clearMyStations } from '@/lib/ui/myStations';
import { iconBtn, mutedText } from './ui';

const menuRow =
  'flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-bold text-ink transition duration-200 hover:bg-soft active:scale-[.98] [&_svg]:size-[18px]';

export default function Account() {
  const t = useT();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close on outside click or Escape (focus goes back to the button).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session) return null;
  const who = session.user.name || session.user.email;
  const initial = (who || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={`${iconBtn} text-[15px] font-extrabold`}
        aria-label={`${t('Account')}: ${who}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-ink text-[14px] text-white">
          {initial}
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          className="lm-pop absolute right-0 top-[calc(100%+8px)] z-50 w-64 max-w-[calc(100vw-24px)] rounded-card border border-line bg-white p-2 shadow-sh3"
        >
          <div className="border-b border-line px-3 pb-2.5 pt-1.5">
            <p className="truncate text-[15px] font-bold text-ink">{session.user.name || session.user.email}</p>
            {session.user.name && session.user.email && (
              <p className={`${mutedText} truncate`}>{session.user.email}</p>
            )}
          </div>
          <div className="pt-1.5">
            <Link href="/welcome" className={menuRow} onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t('Edit my profile')}
            </Link>
            <button
              type="button"
              className={`${menuRow} text-bad hover:bg-bad-bg`}
              onClick={async () => {
                await authClient.signOut();
                clearMyStations();
                router.replace('/login');
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('Sign out')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
