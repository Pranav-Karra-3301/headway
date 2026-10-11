// Owner: T2.4. Where the town FX attach, from the same scenery the composer renders: base SCENERY (Task M, kit
// models) minus items inside the region of any district that has items, plus every DISTRICTS item (asset families).
//   clock faces  — base 'clockTower' (kit CLOCK_TOWER.faces), base 'station' (kit STATION_CLOCK),
//                  district 'lm.clockTower' (A4 CLOCK_TOWER_FACES; skipped when params.hands === true)
//   stadiums     — base 'stadium' (kit STADIUM masts) / district 'lm.stadium' (A4 STADIUM_FLOODLIGHTS)
//   lamps        — district 'st.lamp' heads (A6 LAMP_HEAD)
//   lawns        — base 'lawn' rectangles + district areas of kind 'lawn' / 'sports'
import type { TownMap, Vec2 } from '@headway/sim';
import { CLOCK_TOWER_FACES, STADIUM_FLOODLIGHTS } from '../assets/families/landmarks';
import { LAMP_HEAD } from '../assets/families/street';
import type { PlacedAsset } from '../assets/types';
import { DISTRICTS } from '../districts';
import type { DistrictScenery } from '../districts/types';
import { CLOCK_TOWER, STADIUM, STATION_CLOCK } from '../kit';
import { SCENERY, type SceneryItem } from '../scenery';

export interface Vec3 { x: number; y: number; z: number }
/** A clock face in world space; the dial looks along its rotated +z (yaw `rotY`). */
export interface ClockFaceAnchor { x: number; y: number; z: number; rotY: number; r: number }
export interface FloodAnchor { head: Vec3; target: Vec3 }
export interface StadiumAnchor {
  x: number; z: number; rot: number; scale: number;
  /** Half extents (local x, z) of the lit pitch, and its height. */
  pitch: { a: number; b: number; y: number };
  floods: FloodAnchor[];
}
export interface LampAnchor { x: number; z: number; headY: number }
export interface LawnPatch { polygon: Vec2[]; kind: 'lawn' | 'sports' }
export interface FxAnchors { clockFaces: ClockFaceAnchor[]; stadiums: StadiumAnchor[]; lamps: LampAnchor[]; lawns: LawnPatch[] }
export interface FxSources { scenery: readonly SceneryItem[]; districts: readonly DistrictScenery[] }

export function insideRegion(r: DistrictScenery['region'], p: Vec2): boolean {
  if ('polygon' in r) {
    const poly = r.polygon;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  return Math.hypot(p.x - r.center.x, p.z - r.center.z) <= r.radius;
}

/** True when a district with items owns this point (the composer drops base scenery there). */
export function districtOwns(districts: readonly DistrictScenery[], p: Vec2): boolean {
  return districts.some((d) => d.items.length > 0 && insideRegion(d.region, p));
}

/** Base scenery the composer keeps: everything not inside the region of a district that has items. */
export function keptScenery(scenery: readonly SceneryItem[], districts: readonly DistrictScenery[]): SceneryItem[] {
  return scenery.filter((it) => !districtOwns(districts, it));
}

/** Local (model) → world for a placement (x, z, rot about y, uniform scale). Matches Object3D rotation.y. */
function toWorld(pl: { x: number; z: number; rot?: number; scale?: number }, l: Vec3): Vec3 {
  const r = pl.rot ?? 0, s = pl.scale ?? 1, c = Math.cos(r), n = Math.sin(r);
  return { x: pl.x + (c * l.x + n * l.z) * s, y: l.y * s, z: pl.z + (-n * l.x + c * l.z) * s };
}

function faces(pl: { x: number; z: number; rot?: number; scale?: number }, list: ReadonlyArray<{ x: number; y: number; z: number; rotY: number; r?: number }>, r: number): ClockFaceAnchor[] {
  return list.map((f) => ({ ...toWorld(pl, f), rotY: (pl.rot ?? 0) + f.rotY, r: (f.r ?? r) * (pl.scale ?? 1) }));
}

/** Floodlight cones aim from the lamp head down onto the far half of the pitch. */
function floods(pl: { x: number; z: number; rot?: number; scale?: number }, heads: Vec3[]): FloodAnchor[] {
  return heads.map((h) => ({ head: toWorld(pl, h), target: toWorld(pl, { x: -0.3 * h.x, y: 0.05, z: -0.3 * h.z }) }));
}

const KIT_HEADS: Vec3[] = STADIUM.masts.map((a) => ({ x: Math.cos(a) * 5.0, y: 3.95, z: Math.sin(a) * 3.85 }));
const A4_HEADS: Vec3[] = STADIUM_FLOODLIGHTS.map((f) => ({ x: f.x, y: f.y, z: f.z }));

function stadiumAt(pl: { x: number; z: number; rot?: number; scale?: number }, kind: 'kit' | 'a4'): StadiumAnchor {
  const s = pl.scale ?? 1;
  const pitch = kind === 'kit' ? { a: 3.7 * s, b: 2.6 * s, y: 0.1 * s } : { a: 3.5 * s, b: 1.95 * s, y: 0.06 * s };
  return { x: pl.x, z: pl.z, rot: pl.rot ?? 0, scale: s, pitch, floods: floods(pl, kind === 'kit' ? KIT_HEADS : A4_HEADS) };
}

const rect = (x: number, z: number, w: number, d: number): Vec2[] =>
  [{ x: x - w / 2, z: z - d / 2 }, { x: x + w / 2, z: z - d / 2 }, { x: x + w / 2, z: z + d / 2 }, { x: x - w / 2, z: z + d / 2 }];

export function fxAnchors(map: TownMap, src: FxSources = { scenery: SCENERY, districts: DISTRICTS }): FxAnchors {
  void map;
  const out: FxAnchors = { clockFaces: [], stadiums: [], lamps: [], lawns: [] };
  for (const it of keptScenery(src.scenery, src.districts)) {
    if (it.kind === 'clockTower') out.clockFaces.push(...faces({ ...it, scale: it.scale }, CLOCK_TOWER.faces, CLOCK_TOWER.faceR));
    else if (it.kind === 'station') out.clockFaces.push(...faces(it, [STATION_CLOCK], STATION_CLOCK.r));
    else if (it.kind === 'stadium') out.stadiums.push(stadiumAt(it, 'kit'));
    else if (it.kind === 'lawn') out.lawns.push({ polygon: rect(it.x, it.z, it.w ?? 2, it.d ?? 2), kind: 'lawn' });
  }
  for (const d of src.districts) {
    for (const it of d.items as PlacedAsset[]) {
      if (it.kind === 'lm.clockTower' && it.params?.hands !== true) out.clockFaces.push(...faces(it, CLOCK_TOWER_FACES, 0.6));
      else if (it.kind === 'lm.stadium') out.stadiums.push(stadiumAt(it, 'a4'));
      else if (it.kind === 'st.lamp') out.lamps.push({ x: it.x, z: it.z, headY: LAMP_HEAD.y * (it.scale ?? 1) });
    }
    for (const a of d.areas) if (a.kind === 'lawn' || a.kind === 'sports') out.lawns.push({ polygon: a.polygon, kind: a.kind });
  }
  return out;
}
