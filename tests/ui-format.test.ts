// UI wording helpers (src/lib/ui): dates, alerts, partial step-free, next trains, walk warnings, crash names.
import { describe, expect, it } from 'vitest';
import type { NormalizedAlert, Prediction, Station } from '@/lib/ui/api';
import {
  alertActive,
  alertDatesKnown,
  crashSpotsFromGeojson,
  formatTime,
  legRoutesText,
  nextTrainGroups,
  partialLines,
  stepFreeState,
} from '@/lib/ui/format';
import { newlyBlocked } from '@/lib/ui/myStations';
import { warningLines, type WalkWarnings } from '@/lib/ui/walk';

const NOW = new Date('2026-10-24T17:30:00Z');

describe('formatTime', () => {
  it('omits the year this year and adds it otherwise', () => {
    expect(formatTime('2026-10-24T10:32:00-04:00', NOW)).not.toMatch(/2026/);
    expect(formatTime('2022-03-15T10:13:00-04:00', NOW)).toMatch(/Mar 15, 2022/);
  });
});

function alert(p: Partial<NormalizedAlert>): NormalizedAlert {
  return {
    id: '1',
    effect: 'ELEVATOR_CLOSURE',
    header: 'h',
    shortHeader: 'h',
    description: null,
    url: null,
    severity: 3,
    lifecycle: 'NEW',
    activePeriods: [],
    activeNow: false,
    stationIds: [],
    routeIds: [],
    facilityIds: [],
    activities: [],
    updatedAt: '',
    ...p,
  };
}

describe('alerts with placeholder dates', () => {
  const epoch = [{ start: '1969-12-31T19:00:00-05:00', end: '1969-12-31T19:00:00-05:00' }];
  it('detects epoch periods even without the server flag, and counts NEW as active', () => {
    const a = alert({ activePeriods: epoch });
    expect(alertDatesKnown(a)).toBe(false);
    expect(alertActive(a)).toBe(true);
    expect(alertActive(alert({ activePeriods: epoch, lifecycle: 'UPCOMING' }))).toBe(false);
  });
  it('follows the server flag when present', () => {
    expect(alertDatesKnown(alert({ datesKnown: false, activePeriods: [{ start: '2026-10-24T10:00:00Z', end: null }] }))).toBe(false);
    expect(alertDatesKnown(alert({ activePeriods: [{ start: '2026-10-24T10:00:00Z', end: null }] }))).toBe(true);
  });
});

const station: Station = {
  id: 'place-rbmnl',
  name: 'Revere Beach',
  lat: 42.4,
  lon: -71,
  wheelchair: 1,
  routes: ['Blue'],
  platformIds: [],
  entranceIds: [],
  facilityIds: [],
};

describe('partial step-free', () => {
  it('is a distinct state from the server flag or from blockedBy on a step-free station', () => {
    expect(stepFreeState(station, { stepFree: true, approximate: false, blockedBy: [], partial: true })).toBe('partial');
    expect(stepFreeState(station, { stepFree: true, approximate: false, blockedBy: ['885'] })).toBe('partial');
    expect(stepFreeState(station, { stepFree: true, approximate: false, blockedBy: [] })).toBe('yes');
    expect(stepFreeState(station, { stepFree: false, approximate: false, blockedBy: ['885'] })).toBe('no');
  });
  it('names the platform and the facility', () => {
    const lines = partialLines(
      [{ platformId: '70058', name: 'Wonderland', facilityIds: ['885'] }],
      ['885'],
      (id) => `Revere Beach Elevator ${id}`,
    );
    expect(lines).toEqual(['Partly step-free: Wonderland platform blocked by Revere Beach Elevator 885']);
  });
  it('banner fires when a saved station goes from step-free to partial', () => {
    const prev = new Map<string, boolean | 'partial'>([['a', true], ['b', 'partial']]);
    const now = new Map<string, boolean | 'partial'>([['a', 'partial'], ['b', 'partial']]);
    expect(newlyBlocked(['a', 'b'], prev, now)).toEqual(['a']);
  });
});

function pred(routeId: string, directionId: 0 | 1, minutesAway: number, headsign: string): Prediction {
  return { routeId, directionId, minutesAway, headsign, platformId: 'p', stationId: 's', time: `t${minutesAway}`, approximate: false };
}

describe('nextTrainGroups', () => {
  it('keeps every route+direction with its next 2 and drops non-subway routes', () => {
    const preds = [
      pred('Green-B', 0, 1, 'Boston College'),
      pred('Green-B', 0, 3, 'Boston College'),
      pred('Green-B', 0, 5, 'Boston College'),
      pred('Red', 0, 2, 'Ashmont'),
      pred('Red', 1, 4, 'Alewife'),
      pred('Green-E', 1, 12, 'Medford/Tufts'),
      pred('741', 1, 0, 'South Station'),
    ];
    const g = nextTrainGroups(preds);
    expect(g.map((x) => x.key)).toEqual(['Green-B|0', 'Red|0', 'Red|1', 'Green-E|1']);
    expect(g[0].trains.map((t) => t.minutesAway)).toEqual([1, 3]);
  });
});

describe('legRoutesText', () => {
  it('lists Green branches that serve the leg', () => {
    expect(legRoutesText('Green-D', ['Green-B', 'Green-C'])).toBe('any Green Line B, C or D train');
    expect(legRoutesText('Red', undefined)).toBe('the Red Line');
  });
});

describe('warningLines', () => {
  const base: WalkWarnings = { crashAreas: [], hazards: [], poorRamps: [] };
  it('splits poor ramps from lip-only ramps and uses uncapped totals', () => {
    const lines = warningLines({ ...base, poorRampTotal: 1, lipOnlyRampTotal: 9, rampTotal: 10 });
    expect(lines).toEqual(['1 curb ramp in poor condition, 9 with a lip at the edge near your route']);
    const lipOnly = warningLines({
      ...base,
      poorRamps: [{ id: '4062', condition: 'lip at edge', lat: 0, lon: 0 }],
    });
    expect(lipOnly).toEqual(['1 curb ramp with a lip at the edge near your route']);
  });
  it('adds "and N more" for hazards and drops 0-crash areas', () => {
    const lines = warningLines({
      ...base,
      crashAreas: [{ site: 'H', label: 'Dominic J. Bianculli Boulevard', pedBike: 0 }],
      hazards: [{ id: '1', type: 'sidewalk', label: 'Sidewalk repair on X St', openedAt: '2026-10-01', lat: 0, lon: 0 }],
      hazardTotal: 36,
    });
    expect(lines[0]).toMatch(/^Sidewalk repair on X St/);
    expect(lines[1]).toBe('And 35 more open 311 reports along this walk');
    expect(lines).toHaveLength(2);
  });
});

describe('crash intersections (local fallback search)', () => {
  const props = {
    site: 'BOYLSTON ST & MASSACHUSETTS AVE',
    label: 'Boylston St & Massachusetts Ave',
    neighborhood: 'Back Bay',
    ped: 80,
    bike: 15,
  };
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: null }] } as unknown as GeoJSON.FeatureCollection;
  it('matches the intersection name and the neighborhood', () => {
    expect(crashSpotsFromGeojson(fc, 'boylston', 'recorded')).toHaveLength(1);
    expect(crashSpotsFromGeojson(fc, 'back bay', 'recorded')).toHaveLength(1);
    expect(crashSpotsFromGeojson(fc, 'dudley', 'recorded')).toHaveLength(0);
  });
  it('keeps the recorded pedestrian + bike count', () => {
    expect(crashSpotsFromGeojson(fc, '', 'recorded')[0]).toMatchObject({ site: props.site, pedBike: 95 });
  });
});
