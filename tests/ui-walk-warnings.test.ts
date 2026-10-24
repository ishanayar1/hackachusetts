import { describe, expect, it } from 'vitest';
import { DEMO_DESTINATIONS, formatYmd, warningLines } from '@/lib/ui/walk';

// Shapes and values copied from a real /api/walk response (Park Street -> Roxbury Crossing, 2026-10-24).
const base = { crashAreas: [], hazards: [], poorRamps: [] };

describe('warningLines: Vision Zero fields', () => {
  it('lists fatal crashes with year and mode, plus "and N more"', () => {
    const lines = warningLines({
      ...base,
      fatalCrashes: [{ date: '2025-01-18', mode: 'pedestrian', label: 'Washington St near Northampton St' }],
      fatalTotal: 3,
    });
    expect(lines).toContain('Fatal crash recorded here in 2025 (pedestrian): Washington St near Northampton St');
    expect(lines).toContain('And 2 more recorded fatal crashes along this walk');
  });

  it('lists resident reports with a Boston-day date, plus "and N more"', () => {
    const lines = warningLines({
      ...base,
      safetyConcerns: [{ concern: 'drivers do not yield when turning', date: '2023-11-27' }],
      safetyConcernTotal: 2,
    });
    expect(lines).toContain('Residents reported drivers do not yield when turning here (Nov 27, 2023)');
    expect(lines).toContain('And 1 more resident report along this walk');
  });

  it('works without the new optional fields (older servers)', () => {
    expect(warningLines(base)).toEqual([]);
  });

  it('never says "safe"', () => {
    const lines = warningLines({
      ...base,
      fatalCrashes: [{ date: '2019-03-20', mode: 'motor vehicle', label: 'Melnea Cass Blvd & Washington St' }],
      safetyConcerns: [{ concern: 'other safety concern', date: '2026-09-12' }],
      safetyConcernTotal: 7,
      fatalTotal: 9,
    });
    // "safety concern" is the resident report category name, not a claim that a place is safe.
    for (const l of lines) expect(l.replace(/safety concern/g, '')).not.toMatch(/\bsafe\b/i);
  });
});

describe('formatYmd', () => {
  it('does not shift a date to the previous day', () => {
    expect(formatYmd('2026-07-09')).toBe('Jul 9, 2026');
  });
  it('passes through unparseable text', () => {
    expect(formatYmd('unknown')).toBe('unknown');
  });
});

describe('DEMO_DESTINATIONS', () => {
  it('are inside the Boston area', () => {
    for (const p of DEMO_DESTINATIONS) {
      expect(p.lat).toBeGreaterThan(42.2);
      expect(p.lat).toBeLessThan(42.5);
      expect(p.lon).toBeGreaterThan(-71.3);
      expect(p.lon).toBeLessThan(-70.9);
    }
  });
});
