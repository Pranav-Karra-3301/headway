import { describe, expect, it } from 'vitest';
import * as contracts from '../src/contracts';
import type { Action, RouteId, StopId } from '../src/index';

describe('contracts', () => {
  it('loads and the contract types compose', () => {
    expect(contracts).toBeTypeOf('object');
    const routes: RouteId[] = ['r1', 'r2', 'r3'];
    const stop: StopId = 'stop_central_stn';
    const hold: Action = { type: 'hold', until: 'target_headway' };
    expect(routes).toHaveLength(3);
    expect(stop).toBe('stop_central_stn');
    expect(hold.type).toBe('hold');
  });
});
