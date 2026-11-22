// Terrain meshes: a low-resolution "far" mesh for the whole sound, and detailed chunks
// near the boat in two levels of detail. Chunks also carry trees and seabed boulders.

import * as THREE from 'three';
import { CHUNK_SIZE, LOD0_RADIUS, LOD0_RES, LOD1_RADIUS, LOD1_RES } from '../config';
import { applyUnderwater } from './materials';
import { hash2, Simplex2, mulberry32 } from './noise';
import { Mat, Terrain, type TerrainSample } from './terrain';
import { cityZones } from './landmarks';

const MAT_COLORS: number[] = [
  0x6a6348, // mud
  0xeadfbb, // sand
  0xa49a86, // gravel
  0x777370, // rock
  0xe6d7ab, // beach
  0x86a04f, // grass
  0x44613a, // forest floor
  0xcfae80, // cliff (glacial bluff)
  0x86837b, // mountain
  0xf1f4f6, // snow
  0x777777,
  0x7a5a3a,
  0x888888,
  0x556644,
];

const matLinear = MAT_COLORS.map((h) => new THREE.Color().setHex(h));

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  lod: number;
  group: THREE.Group;
}

export class TerrainRenderer {
  readonly root = new THREE.Group();
  private terrain: Terrain;
  private chunks = new Map<string, Chunk>();
  private nearMat: THREE.MeshLambertMaterial;
  private farMat: THREE.MeshLambertMaterial;
  private rockMat: THREE.MeshLambertMaterial;
  private treeMat: THREE.MeshLambertMaterial;
  private treeGeo: THREE.BufferGeometry;
  private rockGeo: THREE.BufferGeometry;
  private discardRect = { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) };
  private colorNoise: Simplex2;
  private sample: TerrainSample = { h: 0, mat: Mat.Mud, depth: 0, current: 0 };
  private pending: { key: string; cx: number; cz: number; lod: number }[] = [];
  private desired = new Map<string, number>();
  private desiredRect = new THREE.Vector4();
  private centerKey = '';
  private cities: { x: number; z: number; r: number }[];

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.cities = cityZones(terrain.map);
    this.colorNoise = new Simplex2(mulberry32(terrain.seed ^ 0xc010));
    this.nearMat = applyUnderwater(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), {
      shore: true,
    });
    this.farMat = applyUnderwater(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), {
      shore: true,
      discardRect: this.discardRect,
    });
    this.rockMat = applyUnderwater(new THREE.MeshLambertMaterial({ color: 0x8a857c, flatShading: true }));
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.treeGeo = makeTreeGeometry();
    this.rockGeo = new THREE.IcosahedronGeometry(1, 0);
  }

  // ------------------------------------------------------------------ far mesh

  buildFarMesh(): THREE.Mesh {
    const map = this.terrain.map;
    const res = 25;
    const margin = 2500;
    const x0 = -margin;
    const z0 = -margin;
    const nx = Math.ceil((map.width + 2 * margin) / res) + 1;
    const nz = Math.ceil((map.height + 2 * margin) / res) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * res;
        const z = z0 + j * res;
        const s = this.terrain.sample(x, z, this.sample, 2);
        const k = (j * nx + i) * 3;
        pos[k] = x;
        pos[k + 1] = s.h;
        pos[k + 2] = z;
        this.colorFor(s, x, z, c);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(gridIndex(nx, nz));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.farMat);
    mesh.frustumCulled = false;
    mesh.name = 'far-terrain';
    this.root.add(mesh);
    return mesh;
  }

  private colorFor(s: TerrainSample, x: number, z: number, out: THREE.Color) {
    out.copy(matLinear[s.mat]);
    const n = this.colorNoise.noise(x / 40, z / 40) * 0.07 + this.colorNoise.noise(x / 7, z / 7) * 0.04;
    let k = 1 + n;
    if (s.mat === Mat.Sand || s.mat === Mat.Mud) {
      // Blend sand into mud with depth so the change is gradual.
      const t = Math.min(1, Math.max(0, (s.depth - 6) / 10));
      if (s.mat === Mat.Sand) out.lerp(matLinear[Mat.Mud], t * 0.35);
    }
    if (s.mat === Mat.Forest || s.mat === Mat.Grass) k *= 1 + this.colorNoise.noise(x / 120, z / 120) * 0.12;
    out.multiplyScalar(k);
  }

  // ------------------------------------------------------------------ near chunks

  /** Update the set of near chunks around a point. Spends at most budgetMs building. */
  update(x: number, z: number, budgetMs = 6): void {
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    const ck = `${pcx},${pcz}`;
    if (ck !== this.centerKey) {
      this.centerKey = ck;
      this.desired.clear();
      this.pending.length = 0;
      for (let dz = -LOD1_RADIUS; dz <= LOD1_RADIUS; dz++) {
        for (let dx = -LOD1_RADIUS; dx <= LOD1_RADIUS; dx++) {
          const cx = pcx + dx;
          const cz = pcz + dz;
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          const lod = d <= LOD0_RADIUS ? 0 : 1;
          const key = `${cx},${cz}`;
          this.desired.set(key, lod);
          const ex = this.chunks.get(key);
          if (!ex || ex.lod !== lod) this.pending.push({ key, cx, cz, lod });
        }
      }
      // Nearest first.
      this.pending.sort(
        (a, b) =>
          Math.max(Math.abs(a.cx - pcx), Math.abs(a.cz - pcz)) - Math.max(Math.abs(b.cx - pcx), Math.abs(b.cz - pcz)),
      );
      this.desiredRect.set(
        (pcx - LOD1_RADIUS) * CHUNK_SIZE,
        (pcz - LOD1_RADIUS) * CHUNK_SIZE,
        (pcx + LOD1_RADIUS + 1) * CHUNK_SIZE,
        (pcz + LOD1_RADIUS + 1) * CHUNK_SIZE,
      );
    }

    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const p = this.pending.shift()!;
      const old = this.chunks.get(p.key);
      const chunk = this.buildChunk(p.cx, p.cz, p.lod);
      if (old) this.disposeChunk(old);
      this.chunks.set(p.key, chunk);
      this.root.add(chunk.group);
    }

    if (this.pending.length === 0 && this.chunks.size > this.desired.size) {
      for (const [key, ch] of this.chunks) {
        if (!this.desired.has(key)) {
          this.disposeChunk(ch);
          this.chunks.delete(key);
        }
      }
    }
    if (this.pending.length === 0) this.discardRect.value.copy(this.desiredRect);
  }

  get busy(): boolean {
    return this.pending.length > 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private disposeChunk(ch: Chunk) {
    this.root.remove(ch.group);
    ch.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== this.treeGeo && o.geometry !== this.rockGeo) o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  }

  private buildChunk(cx: number, cz: number, lod: number): Chunk {
    const res = lod === 0 ? LOD0_RES : LOD1_RES;
    const n = CHUNK_SIZE / res + 1;
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const vcount = n * n + 4 * n;
    const pos = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * res;
        const z = z0 + j * res;
        const s = this.terrain.sampleCarved(x, z, this.sample, lod);
        const k = (j * n + i) * 3;
        pos[k] = x;
        pos[k + 1] = s.h;
        pos[k + 2] = z;
        this.colorFor(s, x, z, c);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    const idx = gridIndex(n, n);
    // Skirts hide cracks between levels of detail.
    const skirt = lod === 0 ? 4 : 8;
    const edges: number[][] = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      edges[0].push(i); // north row
      edges[1].push((n - 1) * n + i); // south row
      edges[2].push(i * n); // west column
      edges[3].push(i * n + n - 1); // east column
    }
    let v = n * n;
    for (let e = 0; e < 4; e++) {
      const base = v;
      for (const src of edges[e]) {
        pos[v * 3] = pos[src * 3];
        pos[v * 3 + 1] = pos[src * 3 + 1] - skirt;
        pos[v * 3 + 2] = pos[src * 3 + 2];
        col[v * 3] = col[src * 3] * 0.8;
        col[v * 3 + 1] = col[src * 3 + 1] * 0.8;
        col[v * 3 + 2] = col[src * 3 + 2] * 0.8;
        v++;
      }
      for (let i = 0; i < n - 1; i++) {
        const a = edges[e][i];
        const b = edges[e][i + 1];
        const a2 = base + i;
        const b2 = base + i + 1;
        idx.push(a, a2, b, b, a2, b2);
        idx.push(a, b, a2, b, b2, a2); // both windings: cheap double-sided
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, this.nearMat));

    const trees = this.buildTrees(cx, cz);
    if (trees) group.add(trees);
    if (lod === 0) {
      const rocks = this.buildRocks(cx, cz);
      if (rocks) group.add(rocks);
    }
    return { key: `${cx},${cz}`, cx, cz, lod, group };
  }

  private buildTrees(cx: number, cz: number): THREE.InstancedMesh | null {
    const spacing = 9;
    const per = CHUNK_SIZE / spacing;
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const seed = this.terrain.seed ^ 0x7e3e;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < per; j++) {
      for (let i = 0; i < per; i++) {
        const gi = cx * 1000 + i;
        const gj = cz * 1000 + j;
        const r0 = hash2(gi, gj, seed);
        const x = cx * CHUNK_SIZE + (i + hash2(gi, gj, seed + 1)) * spacing;
        const z = cz * CHUNK_SIZE + (j + hash2(gi, gj, seed + 2)) * spacing;
        const s = this.terrain.sample(x, z, this.sample, 1);
        if (s.h < 1.4) continue;
        let p = 0;
        if (s.mat === Mat.Forest) p = 0.8;
        else if (s.mat === Mat.Grass) p = 0.1;
        else if (s.mat === Mat.Mountain) p = 0.35;
        else if (s.mat === Mat.Cliff) p = 0.05;
        if (r0 > p) continue;
        if (this.cities.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < c.r * c.r)) continue;
        const h = s.h;
        const hx = this.terrain.naturalHeight(x + 3, z, 1);
        const hz = this.terrain.naturalHeight(x, z + 3, 1);
        if (Math.abs(hx - h) > 2.4 || Math.abs(hz - h) > 2.4) continue;
        const sc = 0.75 + 0.6 * hash2(gi, gj, seed + 3);
        q.setFromAxisAngle(up, hash2(gi, gj, seed + 4) * Math.PI * 2);
        m.compose(new THREE.Vector3(x, h - 0.3, z), q, new THREE.Vector3(sc, sc * (0.85 + 0.4 * hash2(gi, gj, seed + 5)), sc));
        mats.push(m.clone());
        const t = hash2(gi, gj, seed + 6);
        cols.push(new THREE.Color(0.78 + 0.4 * t, 0.85 + 0.3 * t, 0.8 + 0.2 * t));
      }
    }
    if (!mats.length) return null;
    const inst = new THREE.InstancedMesh(this.treeGeo, this.treeMat, mats.length);
    for (let k = 0; k < mats.length; k++) {
      inst.setMatrixAt(k, mats[k]);
      inst.setColorAt(k, cols[k]);
    }
    inst.computeBoundingSphere();
    return inst;
  }

  private buildRocks(cx: number, cz: number): THREE.InstancedMesh | null {
    const bc = Terrain.BOULDER_CELL;
    const i0 = Math.floor((cx * CHUNK_SIZE) / bc);
    const i1 = Math.floor(((cx + 1) * CHUNK_SIZE - 0.001) / bc);
    const j0 = Math.floor((cz * CHUNK_SIZE) / bc);
    const j1 = Math.floor(((cz + 1) * CHUNK_SIZE - 0.001) / bc);
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const b = this.terrain.boulderInCell(i, j);
        if (!b) continue;
        // Only the chunk that holds the centre draws it.
        if (Math.floor(b.x / CHUNK_SIZE) !== cx || Math.floor(b.z / CHUNK_SIZE) !== cz) continue;
        const h = this.terrain.naturalHeight(b.x, b.z);
        q.setFromEuler(new THREE.Euler(hash2(i, j, 1) * 0.6, hash2(i, j, 2) * 6.28, hash2(i, j, 3) * 0.6));
        mats.push(
          new THREE.Matrix4().compose(new THREE.Vector3(b.x, h - 0.15 * b.r, b.z), q, new THREE.Vector3(b.r, b.hgt, b.r)),
        );
      }
    }
    if (!mats.length) return null;
    const inst = new THREE.InstancedMesh(this.rockGeo, this.rockMat, mats.length);
    mats.forEach((m, k) => inst.setMatrixAt(k, m));
    inst.computeBoundingSphere();
    return inst;
  }
}

function gridIndex(nx: number, nz: number): number[] {
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Alternate the diagonal for a less regular faceted look.
      if ((i + j) & 1) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  return idx;
}

function makeTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5);
  trunk.translate(0, 1.2, 0);
  paint(trunk, 0x4a3524);
  parts.push(trunk);
  const tiers: [number, number, number, number][] = [
    [2.2, 3.4, 1.6, 0x2f5a36],
    [1.7, 2.9, 3.6, 0x356640],
    [1.1, 2.4, 5.4, 0x3d7048],
  ];
  for (const [r, h, y, color] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 6);
    cone.translate(0, y + h / 2, 0);
    paint(cone, color);
    parts.push(cone);
  }
  return mergeGeometries(parts);
}

function paint(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color().setHex(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Minimal merge for non-indexed or indexed geometries with position + color (+normal). */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  for (let g of geos) {
    if (g.index) g = g.toNonIndexed();
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    const nn = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i));
      else col.push(1, 1, 1);
      if (nn) nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      else nor.push(0, 1, 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
