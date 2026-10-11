import { describe, expect, it } from 'vitest';
import { friendlyEvolveError } from '../evolve';

describe('friendlyEvolveError', () => {
  it('explains the offline path, a rejected token and a busy lock', () => {
    expect(friendlyEvolveError('Admin token rejected')).toBe('The admin token was rejected.');
    expect(friendlyEvolveError('HTTP 404')).toMatch(/run offline/);
    expect(friendlyEvolveError('not implemented yet')).toMatch(/run offline/);
    expect(friendlyEvolveError('Evolution is offline')).toMatch(/run offline/);
    expect(friendlyEvolveError('Live evolution is not available on this deployment')).toMatch(/run offline/);
    expect(friendlyEvolveError('Evolution is offline: the server could not be reached')).toMatch(/run offline/);
    expect(friendlyEvolveError('Live evolution needs the Headway API, which this server does not provide')).toMatch(/run offline/);
    expect(friendlyEvolveError('a round is already running')).toMatch(/already running/);
    expect(friendlyEvolveError('something else')).toBe('something else');
  });
});
