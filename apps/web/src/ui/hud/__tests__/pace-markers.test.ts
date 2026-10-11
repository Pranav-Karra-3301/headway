import { describe, expect, it } from 'vitest';
import type { TownMap } from '@headway/sim';
import { jAt, paceModel } from '../pace';
import { markerPlaces, markerText, placeKey } from '../markers';
import { declutter } from '../QueueMarkers';

const samples = [
  { t: 0, you: 0, champion: 0, baseline: 0 },
  { t: 30, you: Number.NaN, champion: 300, baseline: 400 },
  { t: 60, you: Number.NaN, champion: 900, baseline: 1200 },
];

describe('pace', () => {
  it('interpolates sampled J between 30 s samples and clamps at the ends', () => {
    expect(jAt(samples, 'champion', 45)).toBeCloseTo(600);
    expect(jAt(samples, 'baseline', 30)).toBeCloseTo(400);
    expect(jAt(samples, 'champion', 500)).toBeCloseTo(900);
    expect(jAt(samples, 'champion', -5)).toBeCloseTo(0);
    expect(jAt([], 'champion', 10)).toBeNull();
  });
  it('is positive (ahead) when the player has accumulated less J than the AI; ignores NaN `you` samples', () => {
    const m = paceModel(samples, 45, 600 - 3600 * 2)!;
    expect(m.vsAiPaxH).toBeCloseTo(2);
    expect(m.ahead).toBe(true);
    expect(m.tone).toBe('ahead');
    const behind = paceModel(samples, 60, 900 + 1800)!;
    expect(behind.vsAiPaxH).toBeCloseTo(-0.5);
    expect(behind.tone).toBe('behind');
    expect(behind.vsBaselinePaxH).toBeCloseTo((1200 - 2700) / 3600);
  });
  it('reads as even within 0.05 pax-h, and needs samples', () => {
    expect(paceModel(samples, 30, 300 + 100)!.tone).toBe('even');
    expect(paceModel([], 100, 5)).toBeNull();
  });
});

describe('queue markers', () => {
  const map = {
    stops: [
      { id: 'stop_downtown', name: 'Downtown', p: { x: 4, z: -2 }, queueDir: { x: 1, z: 0 } },
      { id: 'stop_central_stn', name: 'Central Station', p: { x: -10, z: 6 }, queueDir: { x: 0, z: 1 } },
    ],
    rail: { stations: [{ id: 'stn_central', name: 'Central', platform: { x: -12, z: 8 }, queueDir: { x: 1, z: 0 }, stopId: 'stop_central_stn', dist: 0 }] },
  } as unknown as TownMap;

  it('anchors one marker per stop and platform above the queue head', () => {
    const places = markerPlaces(map);
    expect(places.map((p) => p.key)).toEqual(['stop:stop_downtown', 'stop:stop_central_stn', 'platform:stn_central']);
    const dt = places[0]!;
    expect([dt.x, dt.z]).toEqual([4, -2]);
    expect(dt.y).toBeGreaterThan(1.5);
    expect(dt.stopId).toBe('stop_downtown');
    const plat = places[2]!;
    expect([plat.x, plat.z]).toEqual([-12, 8]);
    expect(plat.y).toBeGreaterThan(dt.y);
    expect(plat.stopId).toBe('stop_central_stn');
    expect(plat.name).toBe('Central platform');
  });
  it('is empty while the town map is not loaded', () => {
    expect(markerPlaces(null)).toEqual([]);
    expect(markerPlaces({} as TownMap)).toEqual([]);
  });
  it('keys places and formats marker text compactly', () => {
    expect(placeKey({ kind: 'platform', id: 'stn_stadium' })).toBe('platform:stn_stadium');
    expect(markerText({ count: 12, longestWaitS: 200 })).toEqual({ count: '12', wait: '3m' });
    expect(markerText({ count: 3, longestWaitS: 42 })).toEqual({ count: '3', wait: '42s' });
  });
});

describe('declutter', () => {
  it('pushes a marker that overlaps an earlier one upward and leaves separate ones alone', () => {
    const a = { x: 100, y: 200, w: 80 };
    const b = { x: 120, y: 205, w: 80 };
    const c = { x: 400, y: 200, w: 80 };
    declutter([a, b, c]);
    expect(a.y).toBe(200);
    expect(b.y).toBeLessThanOrEqual(200 - 30);
    expect(c.y).toBe(200);
  });
  it('stacks a third overlapping marker above the second', () => {
    const items = [{ x: 0, y: 100, w: 80 }, { x: 5, y: 100, w: 80 }, { x: 10, y: 100, w: 80 }];
    declutter(items);
    expect(items[1]!.y).toBeLessThan(items[0]!.y);
    expect(items[2]!.y).toBeLessThan(items[1]!.y);
  });
});
