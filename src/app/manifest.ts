import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LastMile',
    short_name: 'LastMile',
    description: 'Step-free MBTA subway trips. Reroutes around broken elevators.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#1e3a8a',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
    ],
  };
}
