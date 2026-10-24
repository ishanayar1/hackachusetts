'use client';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { auth } from '@/lib/server/auth';

// Same origin, so no baseURL: works on localhost and on any Vercel URL.
export const authClient = createAuthClient({ plugins: [inferAdditionalFields<typeof auth>()] });
