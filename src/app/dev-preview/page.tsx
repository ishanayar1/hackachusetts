import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import LastMileApp from '@/components/LastMileApp';

// Local design check only: renders the app without sign-in. 404 everywhere except `next dev`.
export const instant = false;

export default async function DevPreview() {
  await connection();
  if (process.env.NODE_ENV !== 'development') notFound();
  return <LastMileApp profile={{ service: 'transit', needs: ['wheelchair'], places: [] }} />;
}
