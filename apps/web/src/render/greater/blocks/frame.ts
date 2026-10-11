// Owner: G2. Block-local frames + small pure helpers for the outer-neighbourhood planner (no three.js).
//
// A Frame maps strip-local (u, v) to world (x, z): u runs ALONG the street frontage (0..L), v runs from the street
// edge INTO the block (0..D). `rot` turns an asset (front faces +z at rot 0) to face the street.
import type { Vec2 } from '@headway/sim';
import { CATALOG_BY_KIND } from '../../assets/catalog';
import type { Dir, Rect } from '../grid';

export interface Frame {
  side: Dir;
  /** Length along the frontage and depth into the block (u). */
  L: number;
  D: number;
  /** Yaw that makes an asset face the street. */
  rot: number;
  at(u: number, v: number): Vec2;
  /** World rect of the local box [u0, u1] × [v0, v1]. */
  rect(u0: number, u1: number, v0: number, v1: number): Rect;
}

export function frameOf(r: Rect, side: Dir): Frame {
  const W = r.maxX - r.minX, H = r.maxZ - r.minZ;
  let at: (u: number, v: number) => Vec2, L: number, D: number, rot: number;
  switch (side) {
    case 'n': at = (u, v) => ({ x: r.minX + u, z: r.minZ + v }); L = W; D = H; rot = Math.PI; break;
    case 's': at = (u, v) => ({ x: r.maxX - u, z: r.maxZ - v }); L = W; D = H; rot = 0; break;
    case 'w': at = (u, v) => ({ x: r.minX + v, z: r.maxZ - u }); L = H; D = W; rot = -Math.PI / 2; break;
    case 'e': at = (u, v) => ({ x: r.maxX - v, z: r.minZ + u }); L = H; D = W; rot = Math.PI / 2; break;
  }
  return {
    side, L, D, rot, at,
    rect(u0, u1, v0, v1) {
      const a = at(u0, v0), b = at(u1, v1);
      return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
    },
  };
}

/** Catalog footprint (w along local x, d along local z / facing) and height; 1 × 1 × 1 for unknown kinds. */
export function sizeOf(kind: string): { w: number; d: number; h: number } {
  const c = CATALOG_BY_KIND.get(kind);
  return { w: c?.w ?? 1, d: c?.d ?? 1, h: c?.h ?? 1 };
}

/** World AABB of a footprint w × d centred at (x, z), turned by rot (any angle; exact for multiples of π/2). */
export function footprintRect(x: number, z: number, w: number, d: number, rot: number): Rect {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const hx = (w * c + d * s) / 2, hz = (w * s + d * c) / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.minX < b.maxX - pad && b.minX < a.maxX - pad && a.minZ < b.maxZ - pad && b.minZ < a.maxZ - pad;
}

export function rectInside(inner: Rect, outer: Rect, tol = 0): boolean {
  return inner.minX >= outer.minX - tol && inner.maxX <= outer.maxX + tol && inner.minZ >= outer.minZ - tol && inner.maxZ <= outer.maxZ + tol;
}

export function inset(r: Rect, d: number): Rect {
  return { minX: r.minX + d, maxX: r.maxX - d, minZ: r.minZ + d, maxZ: r.maxZ - d };
}

/** mulberry32: deterministic 0..1 stream. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!;
