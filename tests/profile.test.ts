import { describe, expect, it } from 'vitest';
import { defaultTab, gateRedirect, ProfileSchema, startLayers, type Profile } from '@/lib/profile';

const ok: Profile = {
  service: 'drive',
  needs: ['wheelchair'],
  places: [{ kind: 'home', label: 'Home', address: '1 Beacon St', lat: 42.3585, lon: -71.0608 }],
};

describe('gateRedirect', () => {
  it('sends signed-out visitors to sign in', () => {
    expect(gateRedirect(null)).toBe('/login');
  });

  it('sends accounts without a valid profile to onboarding', () => {
    expect(gateRedirect({ user: {} })).toBe('/welcome');
    expect(gateRedirect({ user: { profile: null } })).toBe('/welcome');
    expect(gateRedirect({ user: { profile: { service: 'teleport' } } })).toBe('/welcome');
  });

  it('lets onboarded users in', () => {
    expect(gateRedirect({ user: { profile: ok } })).toBeNull();
  });
});

describe('ProfileSchema', () => {
  it('accepts a profile with no places and no needs', () => {
    expect(ProfileSchema.safeParse({ service: 'transit', needs: [], places: [] }).success).toBe(true);
  });

  it('rejects places outside Greater Boston', () => {
    expect(ProfileSchema.safeParse({ ...ok, places: [{ ...ok.places[0], lat: 40.7 }] }).success).toBe(false);
  });

  it('allows one home and one work only', () => {
    expect(ProfileSchema.safeParse({ ...ok, places: [ok.places[0], ok.places[0]] }).success).toBe(false);
    const other = { ...ok.places[0], kind: 'other' as const, label: 'Gym' };
    expect(ProfileSchema.safeParse({ ...ok, places: [ok.places[0], other, { ...other, label: 'Clinic' }] }).success).toBe(true);
  });

  it('trims labels and rejects empty or long ones', () => {
    const parsed = ProfileSchema.parse({ ...ok, places: [{ ...ok.places[0], label: '  Home  ' }] });
    expect(parsed.places[0].label).toBe('Home');
    expect(ProfileSchema.safeParse({ ...ok, places: [{ ...ok.places[0], label: '   ' }] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...ok, places: [{ ...ok.places[0], label: 'x'.repeat(41) }] }).success).toBe(false);
  });

  it('caps places at 10 and drops duplicate needs', () => {
    const other = { ...ok.places[0], kind: 'other' as const };
    expect(ProfileSchema.safeParse({ ...ok, places: Array(11).fill(other) }).success).toBe(false);
    expect(ProfileSchema.parse({ ...ok, needs: ['wheelchair', 'wheelchair', 'stroller'] }).needs).toEqual([
      'wheelchair',
      'stroller',
    ]);
  });
});

describe('profile drives the first screen', () => {
  it('opens the planner that matches the main service', () => {
    expect(defaultTab({ ...ok, service: 'transit' })).toBe('trip');
    expect(defaultTab({ ...ok, service: 'drive' })).toBe('drive');
    expect(defaultTab({ ...ok, service: 'park-ride' })).toBe('drive');
  });

  it('turns curb ramps on for wheelchair, scooter, cane or walker users', () => {
    expect(startLayers({ ...ok, needs: ['wheelchair'] })).toEqual({ ramps: true });
    expect(startLayers({ ...ok, needs: ['walker'] })).toEqual({ ramps: true });
    expect(startLayers({ ...ok, needs: ['stroller'] })).toEqual({});
  });
});
