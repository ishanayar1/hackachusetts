import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LastMile: step-free MBTA trips',
  description:
    'Step-free MBTA subway trips for wheelchair users, parents with strollers and older riders. Reroutes around broken elevators and shows recorded crash history.',
  applicationName: 'LastMile',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1e3a8a',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
