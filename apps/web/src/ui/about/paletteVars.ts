// Owner: T7. Palette → scoped CSS custom properties, so the title card and About panel match the renderer palette.
import type { CSSProperties } from 'react';
import { PALETTES } from '../../render/palettes';
import type { PaletteId } from '../../render/types';

export function paletteVars(id: PaletteId, prefix: string): CSSProperties {
  const p = PALETTES[id] ?? PALETTES.a;
  return {
    [`--${prefix}-ink`]: p.ink, [`--${prefix}-paper`]: p.paper, [`--${prefix}-bg`]: p.bg, [`--${prefix}-dusk`]: p.duskBg,
    [`--${prefix}-accent`]: p.accent, [`--${prefix}-lip`]: p.platform,
    [`--${prefix}-r1`]: p.route[0], [`--${prefix}-r2`]: p.route[1], [`--${prefix}-r3`]: p.route[2],
  } as CSSProperties;
}

export const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
