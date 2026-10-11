import { describe, expect, it } from 'vitest';
import { viewFromQuery } from '../boot';
import { themeVars } from '../../styles/theme';

describe('URL view overrides', () => {
  it('accepts known values only', () => {
    expect(viewFromQuery('?palette=b&light=dusk&detail=min&quality=low&speed=16&controller=ref')).toEqual({
      palette: 'b', light: 'dusk', detail: 'min', quality: 'low', speed: 16, watchController: 'ref',
    });
    expect(viewFromQuery('?palette=z&light=noon&speed=3&controller=g9')).toEqual({});
    expect(viewFromQuery('')).toEqual({});
  });
});

describe('theme variables', () => {
  it('follow the renderer palette and switch the background at dusk', () => {
    const day = themeVars('a', 'day');
    const dusk = themeVars('a', 'dusk');
    expect(day['--route-r1']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(day['--bg']).toBe(day['--bg-day']);
    expect(dusk['--bg']).not.toBe(day['--bg']);
    expect(themeVars('c', 'day')['--route-r1']).not.toBe(day['--route-r1']);
  });
});
