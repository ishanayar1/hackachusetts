'use client';
// Client wrapper so the map (which needs window) is never server-rendered.
import dynamic from 'next/dynamic';

const MapClient = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-100 text-slate-700">
      <p>Loading map…</p>
    </div>
  ),
});

export default MapClient;
