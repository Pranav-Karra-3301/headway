// Owner: Task P. Built-in policies (spec §6): g0 (baseline, the evolution root), ref (queue-responsive, hand-written,
// shown as a reference line and never used as a parent) and the complete spec example g3.
// Treat these as read-only; structuredClone before editing.
import type { Policy, Rule } from '../contracts';

const evenHeadway = (): Rule => ({
  id: 'even-headway', on: 'bus_at_terminal', priority: 10,
  when: [{ f: 'headway_ratio', op: '<', v: 1 }],
  do: { type: 'hold', until: 'target_headway' },
  say: 'Waiting {seconds}s at the terminal to keep a {target_headway_s}s headway',
});

const defaults = (): Policy['defaults'] => ({
  bus_at_stop: { type: 'continue' },
  bus_at_terminal: { type: 'dispatch' },
  train_at_station: { type: 'setTrainDeparture', dwellS: 45 },
});

export const G0: Policy = {
  meta: {
    id: 'g0', parent: null, generation: 0, author: 'human', emphasis: 'baseline',
    summary: 'Baseline: 2/2/2 buses; hold at the terminal until the target headway; otherwise continue, dispatch and a 45 s train dwell.',
  },
  params: { allocation: { r1: 2, r2: 2, r3: 2 }, maxHoldS: 60, trainDefaultDwellS: 45 },
  rules: [evenHeadway()],
  defaults: defaults(),
};

export const REF: Policy = {
  meta: {
    id: 'ref', parent: null, generation: 0, author: 'human', emphasis: 'reference',
    summary: 'Queue-responsive reference: Campus Loop spare on Stadium (1/2/3); dispatch at 40+ waiting, move a spare bus to the busiest route, space out bunched buses.',
  },
  // 1/2/3 (sim tuning): the quiet Campus Loop's second bus starts on the Stadium route (a standing pre-stage). Terminal
  // rules cannot tell r1 from r2 or the closing from a class change, and r2 carries the train transfers at Central, so
  // an allocation is the robust way to pre-stage; move-to-busiest still rebalances (it is what wins class_change).
  params: { allocation: { r1: 1, r2: 2, r3: 3 }, maxHoldS: 60, trainDefaultDwellS: 45 },
  rules: [
    {
      id: 'dispatch-big-queue', on: 'bus_at_terminal', priority: 30,
      when: [{ f: 'route_queue', op: '>=', v: 40 }],
      do: { type: 'dispatch' },
      say: 'Leaving now: {route_queue} people are waiting for this route',
    },
    {
      id: 'move-to-busiest', on: 'bus_at_terminal', priority: 20,
      when: [
        { f: 'queue_ratio_other', op: '>=', v: 2 },
        { f: 'max_other_route_queue', op: '>=', v: 30 },
        { f: 'buses_on_route', op: '>=', v: 2 },
      ],
      do: { type: 'reassign', to: 'busiest' },
      say: 'Moving to the busiest route ({to}): {max_other_route_queue} waiting there, {route_queue} here',
    },
    evenHeadway(),
    {
      id: 'anti-bunch', on: 'bus_at_stop', priority: 10,
      when: [
        { f: 'headway_ratio', op: '<', v: 0.4 },
        { f: 'downstream_queue', op: '<', v: 30 },
      ],
      do: { type: 'hold', until: 'target_headway' },
      say: 'Spacing out: only {headway_ahead_s}s behind the bus ahead',
    },
  ],
  defaults: defaults(),
};

/** The complete example policy from spec §6, verbatim. */
export const EXAMPLE_G3: Policy = {
  meta: {
    id: 'g3', parent: 'g2', generation: 3, author: 'deepseek-v4.1-flash@luminal', emphasis: 'transfers',
    summary: 'Hold at Central for an arriving train only with 8+ transfers and the next bus 3+ min away; pre-stage r3 before closing.',
  },
  params: { allocation: { r1: 2, r2: 2, r3: 2 }, maxHoldS: 60, trainDefaultDwellS: 45 },
  rules: [
    {
      id: 'prestage-stadium', on: 'bus_at_terminal', priority: 30,
      when: [
        { f: 'event_in_s', op: '<=', v: 300 }, { f: 'event_in_s', op: '>=', v: -600 },
        { f: 'buses_on_route', op: '>=', v: 2 }, { f: 'route_queue', op: '<', v: 25 },
      ],
      do: { type: 'reassign', to: 'r3' },
      say: 'Moving to Stadium: closing in {event_in_s}s, only {route_queue} waiting here',
    },
    {
      id: 'hold-for-connection', on: 'bus_at_stop', priority: 20,
      when: [
        { f: 'train_eta_s', op: '<=', v: 45 }, { f: 'expected_transfers', op: '>=', v: 8 },
        { f: 'onboard', op: '<=', v: 25 }, { f: 'headway_behind_s', op: '>=', v: 180 },
      ],
      do: { type: 'hold', seconds: 45 },
      say: 'Holding {seconds}s for the train ({train_eta_s}s away, {expected_transfers} transfers)',
    },
    {
      id: 'anti-bunch', on: 'bus_at_stop', priority: 10,
      when: [{ f: 'headway_ratio', op: '<', v: 0.5 }, { f: 'downstream_queue', op: '<', v: 40 }],
      do: { type: 'hold', until: 'target_headway' },
      say: 'Spacing out: only {headway_ahead_s}s behind the bus ahead',
    },
    {
      id: 'even-headway', on: 'bus_at_terminal', priority: 10,
      when: [{ f: 'headway_ratio', op: '<', v: 1 }],
      do: { type: 'hold', until: 'target_headway' },
      say: 'Waiting {seconds}s at the terminal to keep a {target_headway_s}s headway',
    },
    {
      id: 'train-meets-bus', on: 'train_at_station', priority: 10,
      when: [{ f: 'next_bus_eta_s', op: '<=', v: 40 }, { f: 'platform_queue', op: '<', v: 30 }],
      do: { type: 'setTrainDeparture', dwellS: 75 },
      say: 'Train waits {dwellS}s: a bus arrives in {next_bus_eta_s}s',
    },
  ],
  defaults: {
    bus_at_stop: { type: 'continue' }, bus_at_terminal: { type: 'dispatch' },
    train_at_station: { type: 'setTrainDeparture', dwellS: 45 },
  },
};
