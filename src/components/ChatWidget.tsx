'use client';
// Floating safe-route assistant. A button bottom-right opens a chat panel where
// you ask for the lowest-crash-risk route between two Boston places. Calls
// /api/chat and (optionally) draws the returned route on the map.
import { useRef, useState } from 'react';

type Msg = { role: 'user' | 'bot'; text: string };
type ChatRoute = { coords: [number, number][]; from: { lat: number; lng: number }; to: { lat: number; lng: number } };

type Props = {
  /** Draw the returned walking route on the map (optional). */
  onRoute?: (route: ChatRoute | null) => void;
};

export default function ChatWidget({ onRoute }: Props) {
  const [open, setOpen] = useState(false);
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
      {/* Launcher button */}
      <button
        type="button"
        aria-label={open ? 'Close safe-route assistant' : 'Open safe-route assistant'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-800 text-2xl text-white shadow-lg hover:bg-blue-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
      >
        {open ? '✕' : '🛡️'}
      </button>

      {/* Chat panel */}
      {open && (
        <section
          aria-label="Safe-route assistant"
          className="fixed bottom-20 right-4 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <span aria-hidden className="text-lg">🛡️</span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Safe-route assistant</h2>
              <p className="text-xs text-slate-600">Lowest crash-risk route across Boston</p>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-lg bg-blue-800 px-3 py-2 text-sm text-white'
                    : 'mr-auto max-w-[90%] rounded-lg bg-slate-100 px-3 py-2 text-sm italic text-slate-900'
                }
              >
                {m.text}
              </div>
            ))}
            {busy && <p className="mr-auto px-1 text-sm italic text-slate-500">planning a safe route…</p>}
          </div>

          <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-2">
            <label htmlFor="chat-input" className="sr-only">
              Ask for a route
            </label>
            <input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="from A to B…"
              autoComplete="off"
              className="min-h-11 flex-1 rounded-md border border-slate-400 px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="min-h-11 rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
