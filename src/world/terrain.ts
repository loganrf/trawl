// Terrain height and seabed material. The Puget Sound base map gives the large-scale
// shape. Seeded noise adds coastline detail, sand waves, pockmarks, rock outcrops,
// boulders, hills and the Olympic foothills.

import { H_SCALE, realToGameDepth } from '../config';
import type { BaseMap } from './bathymetry';
import { Simplex2, hash2, mulberry32, smoothstep } from './noise';

export const enum Mat {
  Mud = 0,
  Sand = 1,
  Gravel = 2,
  Rock = 3,
  Beach = 4,
  Grass = 5,
  Forest = 6,
  Cliff = 7,
  Mountain = 8,
  Snow = 9,
  Metal = 10,
  Wood = 11,
  Stone = 12,
  Organic = 13,
}

/** Relative acoustic backscatter strength per material. */
export const MAT_REFLECTIVITY: number[] = [
  0.22, // mud
  0.5, // sand
  0.78, // gravel
  0.95, // rock
  0.5,
  0.5,
  0.5,
  0.5,
  0.9,
  0.9,
  1.7, // metal
  0.85, // wood
  1.1, // stone
  0.6, // organic
];

/** Microtexture variance per material (grain of the record). */
export const MAT_GRAIN: number[] = [0.25, 0.35, 0.75, 0.6, 0.3, 0.3, 0.3, 0.3, 0.5, 0.2, 0.4, 0.45, 0.5, 0.4];

export interface TerrainSample {
  h: number;
  mat: Mat;
  /** Game water depth from the base map (0 on land). */
  depth: number;
  /** Tidal current strength 0..1. */
  current: number;
}

export interface SeabedObject {
  id: string;
  x: number;
  z: number;
  baseY: number;
  yaw: number;
  cos: number;
  sin: number;
  hw: number;
  hd: number;
  res: number;
  nx: number;
  nz: number;
  /** Top height above baseY per cell, row-major (z rows). NaN = empty. */
  heights: Float32Array;
  mode: 'add' | 'carve';
  mat: Mat;
}

interface CurrentZone {
  x: number;
  z: number;
  r2: number;
  fx: number;
  fz: number;
  strength: number;
}

const OBJ_CELL = 64;
const BOULDER_CELL = 24;
const POCK_CELL = 70;

export class Terrain {
  readonly map: BaseMap;
  readonly seed: number;
  private n1: Simplex2;
  private n2: Simplex2;
  private n3: Simplex2;
  private zones: CurrentZone[] = [];
  private objBuckets = new Map<number, SeabedObject[]>();
  readonly objects: SeabedObject[] = [];

  constructor(map: BaseMap, seed: number) {
    this.map = map;
    this.seed = seed;
    const rng = mulberry32(seed);
    this.n1 = new Simplex2(rng);
    this.n2 = new Simplex2(rng);
    this.n3 = new Simplex2(rng);

    // Tidal current zones in the narrow passages: [lat, lon, radius (game m), flow bearing deg, strength]
    const zones: [number, number, number, number, number][] = [
      [47.27, -122.553, 380, 175, 1.0], // Tacoma Narrows
      [47.33, -122.56, 300, 170, 0.5],
      [48.06, -122.63, 650, 150, 0.85], // Admiralty Inlet
      [48.12, -122.7, 420, 120, 0.7],
      [47.59, -122.545, 200, 100, 0.9], // Rich Passage
      [47.712, -122.572, 140, 140, 0.9], // Agate Pass
      [47.45, -122.525, 380, 170, 0.6], // Colvos Passage
      [47.37, -122.54, 300, 165, 0.5],
      [47.28, -122.885, 220, 30, 0.8], // Pickering Passage
      [47.165, -122.87, 200, 95, 0.8], // Dana Passage
      [47.13, -122.73, 320, 80, 0.5], // Nisqually Reach
      [47.2, -123.03, 160, 80, 0.7], // Hammersley Inlet
      [47.86, -122.64, 260, 20, 0.6], // Hood Canal Bridge
      [47.905, -122.37, 300, 150, 0.4], // Possession Point
    ];
    for (const [lat, lon, r, bearing, s] of zones) {
      const p = map.fromGeo(lat, lon);
      const b = (bearing * Math.PI) / 180;
      this.zones.push({ x: p.x, z: p.z, r2: r * r, fx: Math.sin(b), fz: -Math.cos(b), strength: s });
    }
  }

  // ---------------------------------------------------------------- natural terrain

  /** Natural terrain (no boulders, no placed objects). lod > 0 skips small detail. */
  sample(x: number, z: number, out: TerrainSample, lod = 0): TerrainSample {
    const s0 = this.map.signedAt(x, z);
    let s = s0;
    const cw = 1 - Math.min(1, Math.abs(s0) / 30);
    if (cw > 0) s += (this.n1.fbm(x / 70, z / 70, 3) * 5 + this.n2.noise(x / 22, z / 22) * 1.2) * cw;

    if (s > 0) {
      const d = realToGameDepth(s);
      out.depth = d;
      let h = -d;
      h += this.n2.fbm(x / 260, z / 260, 3) * (0.3 + d * 0.06);

      const rockN = this.n3.fbm(x / 420 + 100, z / 420, 3) + (d < 4 ? 0.1 : 0);
      const rock = smoothstep(0.28, 0.5, rockN);
      if (rock > 0) h += (this.n1.ridged(x / 28, z / 28, lod > 0 ? 2 : 3) - 0.3) * 1.8 * rock;

      // Tidal current: sand waves across the flow.
      let cur = 0;
      let fx = 0;
      let fz = 1;
      for (const zn of this.zones) {
        const dx = x - zn.x;
        const dz = z - zn.z;
        const w = Math.exp(-(dx * dx + dz * dz) / zn.r2) * zn.strength;
        if (w > cur) {
          cur = w;
          fx = zn.fx;
          fz = zn.fz;
        }
      }
      out.current = cur;
      if (cur > 0.03 && lod === 0) {
        const u = x * fx + z * fz;
        const t = (u / 15) * Math.PI * 2 + this.n2.noise(x / 70, z / 70) * 2.4;
        const amp = 0.55 * cur * smoothstep(1.5, 5, d) * (0.65 + 0.35 * this.n3.noise(x / 110, z / 110));
        h += Math.sin(t + 0.55 * Math.sin(t)) * amp;
      }

      if (d > 8 && lod === 0) h += this.pockmark(x, z) * smoothstep(8, 12, d);

      let mat: Mat;
      if (rock > 0.55) mat = Mat.Rock;
      else if (cur > 0.45) mat = Mat.Gravel;
      else if (cur > 0.15 || d < 2) mat = Mat.Sand;
      else {
        const sandy = smoothstep(10, 4, d) + this.n3.noise(x / 90, z / 90) * 0.4;
        mat = sandy > 0.5 ? Mat.Sand : Mat.Mud;
      }
      out.h = h;
      out.mat = mat;
      return out;
    }

    // ---- land
    out.depth = 0;
    out.current = 0;
    const dist = -s / this.map.landK / H_SCALE; // game metres inland
    const bluff = smoothstep(0.15, 0.45, this.n3.noise(x / 380 - 40, z / 380));
    const riseScale = 40 - 30 * bluff;
    const rise = 1 - Math.exp(-dist / riseScale);
    const hills = this.n2.fbm(x / 520, z / 520, 4);
    let h =
      rise * (8 + 5 * this.n3.noise(x / 300, z / 300) + 4 * bluff) +
      Math.max(0, hills) * 16 * smoothstep(20, 220, dist) +
      hills * 2.5 * smoothstep(0, 60, dist);
    if (lod === 0) h += this.n1.noise(x / 18, z / 18) * 0.35 * smoothstep(3, 20, dist);

    const mt = this.mountainMask(x, z);
    let mtH = 0;
    if (mt > 0) {
      mtH = mt * (30 + 120 * this.n1.ridged(x / 900, z / 900, lod > 0 ? 4 : 5)) * smoothstep(80, 700, dist);
      h += mtH;
    }

    let mat: Mat;
    if (h < 0.9 && dist < 18) mat = Mat.Beach;
    else if (bluff > 0.5 && dist < 25 && h > 1.5) mat = Mat.Cliff;
    else if (mtH > 120) mat = Mat.Snow;
    else if (mtH > 70) mat = Mat.Mountain;
    else mat = this.n1.noise(x / 160, z / 160) > -0.25 ? Mat.Forest : Mat.Grass;
    out.h = h;
    out.mat = mat;
    return out;
  }

  private tmp: TerrainSample = { h: 0, mat: Mat.Mud, depth: 0, current: 0 };

  naturalHeight(x: number, z: number, lod = 0): number {
    return this.sample(x, z, this.tmp, lod).h;
  }

  /** Olympic foothills: land west of Hood Canal, north of the Great Bend. */
  private mountainMask(x: number, z: number): number {
    const g = this.map.toGeo(x, z);
    const lonHC = -123.15 + ((g.lat - 47.45) / (47.9 - 47.45)) * 0.27;
    return (
      smoothstep(0, 0.05, lonHC - g.lon) * smoothstep(47.4, 47.5, g.lat) * (1 - smoothstep(47.88, 47.98, g.lat))
    );
  }

  private pockmark(x: number, z: number): number {
    const ix = Math.floor(x / POCK_CELL);
    const iz = Math.floor(z / POCK_CELL);
    const seed = this.seed ^ 0x51ed;
    if (hash2(ix, iz, seed) > 0.32) return 0;
    const r = 3 + 6 * hash2(ix, iz, seed + 1);
    const cx = ix * POCK_CELL + r + (POCK_CELL - 2 * r) * hash2(ix, iz, seed + 2);
    const cz = iz * POCK_CELL + r + (POCK_CELL - 2 * r) * hash2(ix, iz, seed + 3);
    const dd = ((x - cx) ** 2 + (z - cz) ** 2) / (r * r);
    if (dd >= 1) return 0;
    const depth = 0.4 + 0.9 * hash2(ix, iz, seed + 4);
    const k = 1 - dd;
    return -depth * k * k;
  }

  // ---------------------------------------------------------------- boulders

  /** Boulder in the cell that holds (x, z), or null. Boulders are only under water. */
  boulderInCell(ix: number, iz: number): { x: number; z: number; r: number; hgt: number } | null {
    const seed = this.seed ^ 0xb0d1;
    const cx0 = (ix + 0.5) * BOULDER_CELL;
    const cz0 = (iz + 0.5) * BOULDER_CELL;
    const dens = smoothstep(0.0, 0.5, this.n1.noise(cx0 / 350 + 50, cz0 / 350)) * 0.5 + 0.06;
    if (hash2(ix, iz, seed) > dens) return null;
    const r = 0.6 + 1.7 * Math.pow(hash2(ix, iz, seed + 1), 2);
    const x = ix * BOULDER_CELL + r + (BOULDER_CELL - 2 * r) * hash2(ix, iz, seed + 2);
    const z = iz * BOULDER_CELL + r + (BOULDER_CELL - 2 * r) * hash2(ix, iz, seed + 3);
    const s = this.map.signedBilinear(x, z);
    if (s < 6) return null;
    return { x, z, r, hgt: r * (0.55 + 0.3 * hash2(ix, iz, seed + 4)) };
  }

  /** Height of a boulder above the natural ground at (x, z); 0 if none. */
  boulderHeight(x: number, z: number): number {
    const b = this.boulderInCell(Math.floor(x / BOULDER_CELL), Math.floor(z / BOULDER_CELL));
    if (!b) return 0;
    const dd = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
    if (dd >= 1) return 0;
    return b.hgt * Math.sqrt(1 - dd) - 0.1 * b.r;
  }

  static readonly BOULDER_CELL = BOULDER_CELL;

  // ---------------------------------------------------------------- placed objects

  addObject(o: SeabedObject) {
    this.objects.push(o);
    const r = Math.hypot(o.hw, o.hd);
    const x0 = Math.floor((o.x - r) / OBJ_CELL);
    const x1 = Math.floor((o.x + r) / OBJ_CELL);
    const z0 = Math.floor((o.z - r) / OBJ_CELL);
    const z1 = Math.floor((o.z + r) / OBJ_CELL);
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const k = ix * 100003 + iz;
        let b = this.objBuckets.get(k);
        if (!b) this.objBuckets.set(k, (b = []));
        b.push(o);
      }
  }

  clearObjects() {
    this.objects.length = 0;
    this.objBuckets.clear();
  }

  /**
   * Full seabed sample as the sonar and the hull see it:
   * natural terrain + boulders + placed objects.
   */
  sampleFull(x: number, z: number, out: TerrainSample): TerrainSample {
    this.sample(x, z, out, 0);
    if (out.depth > 0) {
      const bh = this.boulderHeight(x, z);
      if (bh > 0) {
        out.h += bh;
        out.mat = Mat.Stone;
      }
    }
    const bucket = this.objBuckets.get(Math.floor(x / OBJ_CELL) * 100003 + Math.floor(z / OBJ_CELL));
    if (bucket) {
      for (const o of bucket) {
        const dx = x - o.x;
        const dz = z - o.z;
        const lx = dx * o.cos - dz * o.sin;
        const lz = dx * o.sin + dz * o.cos;
        if (lx < -o.hw || lx > o.hw || lz < -o.hd || lz > o.hd) continue;
        const v = sampleGrid(o, lx, lz);
        if (Number.isNaN(v)) continue;
        if (o.mode === 'add') {
          const top = o.baseY + v;
          if (top > out.h) {
            out.h = top;
            out.mat = o.mat;
          }
        } else {
          out.h += v;
          if (v < -0.05) out.mat = o.mat;
        }
      }
    }
    return out;
  }

  /** Natural terrain plus carved objects (pits, tracks). Used for the terrain meshes. */
  sampleCarved(x: number, z: number, out: TerrainSample, lod = 0): TerrainSample {
    this.sample(x, z, out, lod);
    const bucket = this.objBuckets.get(Math.floor(x / OBJ_CELL) * 100003 + Math.floor(z / OBJ_CELL));
    if (bucket) {
      for (const o of bucket) {
        if (o.mode !== 'carve') continue;
        const dx = x - o.x;
        const dz = z - o.z;
        const lx = dx * o.cos - dz * o.sin;
        const lz = dx * o.sin + dz * o.cos;
        if (lx < -o.hw || lx > o.hw || lz < -o.hd || lz > o.hd) continue;
        const v = sampleGrid(o, lx, lz);
        if (!Number.isNaN(v)) out.h += v;
      }
    }
    return out;
  }

  fullHeight(x: number, z: number): number {
    return this.sampleFull(x, z, this.tmp).h;
  }
}

function sampleGrid(o: SeabedObject, lx: number, lz: number): number {
  const gx = (lx + o.hw) / o.res - 0.5;
  const gz = (lz + o.hd) / o.res - 0.5;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = gx - ix;
  const tz = gz - iz;
  const at = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= o.nx || j >= o.nz) return NaN;
    return o.heights[j * o.nx + i];
  };
  const a = at(ix, iz);
  const b = at(ix + 1, iz);
  const c = at(ix, iz + 1);
  const d = at(ix + 1, iz + 1);
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) {
    // Nearest cell for edges and holes.
    return at(Math.round(gx), Math.round(gz));
  }
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
