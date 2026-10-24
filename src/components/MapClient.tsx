'use client';
// Client wrapper so the map (which needs window) is never server-rendered.
import dynamic from 'next/dynamic';

const MapClient = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-mapbg text-[13px] font-medium text-muted">
      <p className="rounded-full bg-white px-3.5 py-1.5 shadow-sh1">Loading map…</p>
    </div>
  ),
});

export default MapClient;
