// Better Auth: email + password, plus Google / GitHub when their keys are set. Users live in Postgres (Neon).
// No 'server-only' import: the migrate script loads this file outside Next.
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { Pool } from 'pg';
import { z } from 'zod';
import { STOP_ID_RE } from '../mbta/live'; // relative: the auth CLI does not resolve @/ paths
import { ProfileSchema } from '../profile';

const env = process.env;

function social<K extends string>(id: K, clientId?: string, clientSecret?: string) {
  return clientId && clientSecret ? { [id]: { clientId, clientSecret } } : {};
}

export const auth = betterAuth({
  database: new Pool({ connectionString: env.DATABASE_URL }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    ...social('google', env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    ...social('github', env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
  },
  user: {
    additionalFields: {
      // Starred station ids ("My stations"), synced from the device when signed in.
      myStations: {
        type: 'string[]',
        required: false,
        defaultValue: [],
        validator: { input: z.array(z.string().regex(STOP_ID_RE)).max(200) },
      },
      // Onboarding answers (src/lib/profile.ts). Null until the user finishes /welcome.
      profile: {
        type: 'json',
        required: false,
        validator: { input: ProfileSchema },
      },
    },
  },
  plugins: [nextCookies()],
});

/** Which social buttons to show. Only names, never keys. */
export const socialProviders = (['google', 'github'] as const).filter(
  (p) => env[`${p.toUpperCase()}_CLIENT_ID`] && env[`${p.toUpperCase()}_CLIENT_SECRET`],
);
