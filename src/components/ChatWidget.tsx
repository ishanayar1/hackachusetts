'use client';
// Floating safe-route assistant. A button bottom-right opens a chat panel where
// you ask for the lowest-crash-risk route between two Boston places. Calls
// /api/chat and (optionally) draws the returned route on the map.
import { useEffect, useRef, useState } from 'react';
import { btnPrimary, input as inputCls, mutedText, sectionTitle } from './ui';

type Msg = { role: 'user' | 'bot'; text: string };
type ChatRoute = { coords: [number, number][]; from: { lat: number; lng: number }; to: { lat: number; lng: number } };

type Props = {
  /** Draw the returned walking route on the map (optional). */
  onRoute?: (route: ChatRoute | null) => void;
};

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="size-[18px] shrink-0">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M8.5 8.5h7M8.5 11.5h4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="size-[18px] shrink-0">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="size-5">
      <path
        d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M8.8 12.2l2.2 2.2 4.4-4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ChatWidget({ onRoute }: Props) {
  const [open, setOpen] = useState(false);
  // The "Ask LastMile" button on the More page opens this panel.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('lastmile:open-chat', show);
    return () => window.removeEventListener('lastmile:open-chat', show);
  }, []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'bot',
      text: "Hi! Ask me for the safest way across Boston and I'll avoid high-crash areas. Try: “from Fenway Park to Boston Common”.",
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollDown = () => requestAnimationFrame(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    scrollDown();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = (await res.json()) as { reply: string; route?: ChatRoute | null };
      setMsgs((m) => [...m, { role: 'bot', text: data.reply }]);
      if (data.route && onRoute) onRoute(data.route);
    } catch {
      setMsgs((m) => [...m, { role: 'bot', text: 'Something went wrong reaching the planner. Try again.' }]);
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  return (
    <>
      {/* Launcher button: phone floats above the bottom sheet, desktop sits bottom-right. */}
      <button
        type="button"
        aria-label={open ? 'Close safe-route assistant' : 'Open safe-route assistant'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-[calc(var(--sheet-h,38dvh)_+_12px)] right-3 z-50 inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[15px] font-bold text-white shadow-sh3 transition duration-200 hover:-translate-y-px hover:bg-[#2a2e37] active:scale-[.97] md:bottom-4 md:right-4"
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && <span className="hidden sm:inline">Safe-route assistant</span>}
      </button>

      {/* Chat panel */}
      {open && (
        <section
          aria-label="Safe-route assistant"
          className="lm-pop fixed inset-x-3 bottom-[calc(var(--sheet-h,38dvh)_+_72px)] z-50 flex h-[28rem] max-h-[max(16rem,calc(100dvh_-_var(--sheet-h,38dvh)_-_156px))] flex-col overflow-hidden rounded-sheet border border-line bg-white shadow-sh3 [transform-origin:bottom_right] md:inset-x-auto md:bottom-[76px] md:right-4 md:max-h-[calc(100dvh_-_108px)] md:w-[22rem]"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-ok-bg text-ok">
              <ShieldIcon />
            </span>
            <div className="min-w-0">
              <h2 className={sectionTitle}>Safe-route assistant</h2>
              <p className={mutedText}>Lowest crash-risk route across Boston</p>
            </div>
          </header>

          <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-[18px] rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] font-medium text-white'
                    : 'mr-auto max-w-[90%] rounded-[18px] rounded-bl-md bg-soft px-3.5 py-2.5 text-[14px] font-medium text-ink'
                }
              >
                {m.text}
              </div>
            ))}
            {busy && (
              <p className="lm-shimmer mr-auto rounded-[18px] rounded-bl-md px-3.5 py-2.5 text-[13px] font-semibold text-muted">
                planning a safe route…
              </p>
            )}
          </div>

          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <label htmlFor="chat-input" className="sr-only">
              Ask for a route
            </label>
            <input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="from A to B…"
              autoComplete="off"
              className={`${inputCls} min-w-0 flex-1`}
            />
            <button type="submit" disabled={busy || !input.trim()} className={`${btnPrimary} min-h-12 shrink-0`}>
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
