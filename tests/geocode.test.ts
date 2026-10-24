import { describe, expect, it } from 'vitest';
import { geocode, NOMINATIM_URL } from '@/lib/geocode';

const reply = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

describe('geocode', () => {
  it('returns Boston hits with short labels and rounded coordinates', async () => {
    const fetch = reply([
      { display_name: 'One Beacon Street, 1, Beacon Street, Government Center, Boston, MA', lat: '42.3584577', lon: '-71.0608383' },
      { display_name: 'Somewhere, New York, NY', lat: '40.7', lon: '-74.0' },
    ]);
    expect(await geocode('1 Beacon St', { fetch, noCache: true })).toEqual([
      { label: 'One Beacon Street, 1, Beacon Street', lat: 42.35846, lon: -71.06084 },
    ]);
  });

  it('asks Nominatim for Greater Boston only', async () => {
    let url = '';
    const fetch = async (u: string) => {
      url = u;
      return { ok: true, status: 200, json: async () => [] };
    };
    await geocode('fenway park', { fetch, noCache: true });
    expect(url.startsWith(NOMINATIM_URL)).toBe(true);
    expect(url).toContain('bounded=1');
    expect(url).toContain('q=fenway%20park');
  });

  it('returns [] when the upstream fails or sends junk', async () => {
    const down = async () => {
      throw new Error('down');
    };
    expect(await geocode('anything', { fetch: down, noCache: true })).toEqual([]);
    expect(await geocode('anything', { fetch: reply({ error: 'x' }), noCache: true })).toEqual([]);
    expect(await geocode('anything', { fetch: reply([{ display_name: 'x', lat: 'nope', lon: '1' }]), noCache: true })).toEqual([]);
  });
});
