// Onboarding answers saved on the account (Better Auth user field "profile"): main way of travel,
// access needs and saved places. Relative imports only: the auth CLI loads this file outside Next.
import { z } from 'zod';
import { BOSTON_BBOX } from './walk';

export const SERVICES = ['transit', 'drive', 'park-ride'] as const;
export type Service = (typeof SERVICES)[number];

export const NEEDS = ['wheelchair', 'stroller', 'walker', 'low-vision', 'hearing', 'none'] as const;
export type Need = (typeof NEEDS)[number];

const PlaceSchema = z.object({
  kind: z.enum(['home', 'work', 'other']),
  label: z.string().trim().min(1).max(40),
  address: z.string().trim().max(200),
  lat: z.number().min(BOSTON_BBOX.minLat).max(BOSTON_BBOX.maxLat),
  lon: z.number().min(BOSTON_BBOX.minLon).max(BOSTON_BBOX.maxLon),
});
export type SavedPlace = z.infer<typeof PlaceSchema>;

export const ProfileSchema = z.object({
  service: z.enum(SERVICES),
  needs: z
    .array(z.enum(NEEDS))
    .max(12)
    .transform((n) => [...new Set(n)]),
  places: z
    .array(PlaceSchema)
    .max(10)
    .refine((p) => p.filter((x) => x.kind === 'home').length <= 1, 'Only one home place.')
    .refine((p) => p.filter((x) => x.kind === 'work').length <= 1, 'Only one work place.'),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Where a page request must go first: sign in, then onboarding. null = let it through. */
export function gateRedirect(session: { user: { profile?: unknown } } | null): '/login' | '/welcome' | null {
  if (!session) return '/login';
  return ProfileSchema.safeParse(session.user.profile).success ? null : '/welcome';
}

