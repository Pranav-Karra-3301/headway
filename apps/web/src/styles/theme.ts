// Palette-driven CSS variables (T3a): the HUD matches the renderer palette (render/palettes.ts, T2.1).
import { PALETTES } from '../render/palettes';
import type { LightMode, PaletteId } from '../render/types';

export interface ThemeVars { [name: `--${string}`]: string }

const FALLBACK = { bg: '#DDEFE5', duskBg: '#2F3A5E', ink: '#1F2A44', paper: '#FFFBF2', accent: '#2E5BDA', route: ['#1FA99A', '#F0A830', '#8A6BD8'] };

export function themeVars(palette: PaletteId, light: LightMode): ThemeVars {
  const p = (PALETTES as Record<string, Partial<typeof FALLBACK> | undefined>)[palette] ?? FALLBACK;
  const route = Array.isArray(p.route) && p.route.length >= 3 ? p.route : FALLBACK.route;
  const day = p.bg ?? FALLBACK.bg;
  return {
    '--bg': light === 'dusk' ? p.duskBg ?? FALLBACK.duskBg : day,
    '--bg-day': day,
    '--ink': p.ink ?? FALLBACK.ink,
    '--paper': p.paper ?? FALLBACK.paper,
    '--accent': p.accent ?? FALLBACK.accent,
    '--route-r1': route[0]!,
    '--route-r2': route[1]!,
    '--route-r3': route[2]!,
  };
}

/** Writes the palette variables on <html>; returns nothing (safe to call from an effect). */
export function applyTheme(palette: PaletteId, light: LightMode, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars(palette, light))) root.style.setProperty(k, v);
  root.dataset.palette = palette;
  root.dataset.light = light;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeVars(palette, light)['--bg']!);
}
