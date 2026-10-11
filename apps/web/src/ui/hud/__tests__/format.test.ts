import { describe, expect, it } from 'vitest';
import type { TownMap } from '@headway/sim';
import { PALETTES } from '../../../render/palettes';
import {
  actionLabel, humanize, localClock, mmss, paxH, placeName, routeColor, routeName, severityOf, signed, stationName,
  stopName, waitShort,
} from '../format';

describe('severityOf (spec §10: ok < 180 s ≤ warn < 420 s ≤ bad)', () => {
  it('uses the spec thresholds', () => {
    expect(severityOf(0)).toBe('ok');
    expect(severityOf(179)).toBe('ok');
    expect(severityOf(180)).toBe('warn');
    expect(severityOf(419)).toBe('warn');
    expect(severityOf(420)).toBe('bad');
    expect(severityOf(5000)).toBe('bad');
  });
});

describe('time formatting', () => {
  it('mmss pads seconds and clamps negatives', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(5)).toBe('0:05');
    expect(mmss(125)).toBe('2:05');
    expect(mmss(125.9)).toBe('2:05');
    expect(mmss(-4)).toBe('0:00');
    expect(mmss(3725)).toBe('62:05');
  });
  it('waitShort is compact: seconds under a minute, else whole minutes', () => {
    expect(waitShort(0)).toBe('0s');
    expect(waitShort(45)).toBe('45s');
    expect(waitShort(60)).toBe('1m');
    expect(waitShort(200)).toBe('3m');
    expect(waitShort(719)).toBe('11m');
  });
  it('localClock adds whole minutes to the scenario clock and wraps midnight', () => {
    expect(localClock('21:30', 0)).toBe('21:30');
    expect(localClock('21:30', 59)).toBe('21:30');
    expect(localClock('21:30', 60)).toBe('21:31');
    expect(localClock('21:30', 2700)).toBe('22:15');
    expect(localClock('23:50', 1200)).toBe('00:10');
    expect(localClock('9:05', 300)).toBe('09:10');
  });
  it('paxH and signed format passenger-hours with a true minus sign', () => {
    expect(paxH(3600)).toBe('1.0');
    expect(paxH(22320)).toBe('6.2');
    expect(signed(6.24)).toBe('+6.2');
    expect(signed(-3.06)).toBe('−3.1');
    expect(signed(0)).toBe('±0.0');
  });
});

describe('names', () => {
  it('falls back to readable names for stops, stations and routes when no map is loaded', () => {
    expect(stopName('stop_apts_south', null)).toBe('Apartments South');
    expect(stopName('stop_central_stn', null)).toBe('Central Station');
    expect(stationName('stn_university', null)).toBe('University');
    expect(routeName('r1', null)).toBe('Campus Loop');
    expect(routeName('r3', null)).toBe('Stadium');
    expect(placeName({ kind: 'stop', id: 'stop_old_main' }, null)).toBe('Old Main');
    expect(placeName({ kind: 'platform', id: 'stn_central' }, null)).toBe('Central platform');
  });
  it('prefers names from the town map', () => {
    const map = {
      stops: [{ id: 'stop_downtown', name: 'Allen St' }],
      routes: [{ id: 'r2', name: 'Blue Loop' }],
      rail: { stations: [{ id: 'stn_central', name: 'Central Sq' }] },
    } as unknown as TownMap;
    expect(stopName('stop_downtown', map)).toBe('Allen St');
    expect(stopName('stop_old_main', map)).toBe('Old Main');
    expect(routeName('r2', map)).toBe('Blue Loop');
    expect(stationName('stn_central', map)).toBe('Central Sq');
  });
  it('humanizes unknown ids', () => {
    expect(humanize('zone_east_hall')).toBe('East Hall');
    expect(humanize('stop_apts_north')).toBe('Apts North');
  });
  it('route colours follow the renderer palette', () => {
    expect(routeColor('r1', 'a')).toBe(PALETTES.a.route[0]);
    expect(routeColor('r3', 'c')).toBe(PALETTES.c.route[2]);
  });
});

describe('actionLabel', () => {
  it('describes every action type briefly', () => {
    expect(actionLabel({ type: 'continue' })).toBe('Continue');
    expect(actionLabel({ type: 'dispatch' })).toBe('Dispatch');
    expect(actionLabel({ type: 'hold', seconds: 45 })).toBe('Hold 45 s');
    expect(actionLabel({ type: 'hold', until: 'target_headway' })).toBe('Hold to headway');
    expect(actionLabel({ type: 'reassign', to: 'r3' })).toBe('Reassign to r3');
    expect(actionLabel({ type: 'reassign', to: 'busiest' })).toBe('Reassign to busiest');
    expect(actionLabel({ type: 'setTrainDeparture', dwellS: 60 })).toBe('Train dwell 60 s');
  });
});
