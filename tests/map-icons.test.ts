import { describe, expect, it } from 'vitest';
import { accessIcon, crashIcon, MAP_ICON_NAMES, STATION_ICON, warnIconName } from '@/lib/ui/map-icons';
import { MODEL_BINS, RECORDED_BINS } from '@/lib/ui/format';

const names = (expr: unknown): string[] =>
  Array.isArray(expr) ? expr.flatMap(names) : typeof expr === 'string' && expr.startsWith('lm-') ? [expr] : [];

describe('map icons', () => {
  it('names warning signs by fill color', () => {
    expect(warnIconName('#FACC15')).toBe('lm-warn-facc15');
  });

  it('crash zones use warning signs that are all drawn', () => {
    for (const mode of ['model', 'recorded'] as const) {
      const used = names(crashIcon(mode));
      expect(used.length).toBeGreaterThan(0);
      for (const n of used) expect(MAP_ICON_NAMES).toContain(n);
    }
    expect(names(crashIcon('model'))).toEqual(MODEL_BINS.map((b) => warnIconName(b.color)));
    expect(names(crashIcon('recorded'))).toEqual(RECORDED_BINS.map((b) => warnIconName(b.color)));
  });

  it('shown model bins read as traffic colors: yellow, orange, red', () => {
    expect(MODEL_BINS.slice(1).map((b) => b.color)).toEqual(['#facc15', '#f97316', '#dc2626']);
  });

  it('every station state and point layer has a drawn icon', () => {
    expect(new Set(Object.values(STATION_ICON)).size).toBe(4);
    for (const n of [...Object.values(STATION_ICON), 'lm-fatal', 'lm-danger', 'lm-ramp-poor', 'lm-ramp-lip', 'lm-ramp-both', 'lm-parking'])
      expect(MAP_ICON_NAMES).toContain(n);
  });

  it('every accessibility point has a drawn icon, with a red out-of-service twin', () => {
    const used = names(accessIcon(['901']));
    for (const n of used) expect(MAP_ICON_NAMES).toContain(n);
    for (const kind of ['elevator', 'escalator', 'portable_boarding_lift', 'ramp', 'elevated_subplatform']) {
      expect(used).toContain(`lm-${kind}`);
      expect(used).toContain(`lm-${kind}-out`);
    }
    expect(used).toEqual(expect.arrayContaining(['lm-entrance', 'lm-entrance-no']));
  });

  it('marks only the closed ids as out of service', () => {
    expect(JSON.stringify(accessIcon(['901', '902']))).toContain('["literal",["901","902"]]');
  });
});
