// Low-poly models built from primitives. Local frame: origin on the seabed at the
// object centre, +y up. Each builder returns a Group sized in metres.

import * as THREE from 'three';
import { applyUnderwater } from './materials';
import { mulberry32 } from './noise';

const matCache = new Map<string, THREE.MeshLambertMaterial>();

export function lambert(hex: number, opts: { caustics?: boolean; emissive?: number } = {}): THREE.MeshLambertMaterial {
  const key = `${hex}-${opts.caustics === false ? 0 : 1}-${opts.emissive ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
    applyUnderwater(m, { noCaustics: opts.caustics === false });
    matCache.set(key, m);
  }
  return m;
}

type V3 = [number, number, number];

class Builder {
  readonly g = new THREE.Group();
  add(geo: THREE.BufferGeometry, hex: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], parent?: THREE.Object3D) {
    const m = new THREE.Mesh(geo, lambert(hex));
    m.position.set(p[0], p[1], p[2]);
    m.rotation.set(r[0], r[1], r[2]);
    (parent ?? this.g).add(m);
    return m;
  }
  box(w: number, h: number, d: number, hex: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], parent?: THREE.Object3D) {
    return this.add(new THREE.BoxGeometry(w, h, d), hex, p, r, parent);
  }
  cyl(rt: number, rb: number, h: number, hex: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], seg = 8, parent?: THREE.Object3D) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), hex, p, r, parent);
  }
  sphere(rad: number, hex: number, p: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], parent?: THREE.Object3D, detail = 0) {
    const m = this.add(new THREE.IcosahedronGeometry(rad, detail), hex, p, [0, 0, 0], parent);
    m.scale.set(scale[0], scale[1], scale[2]);
    return m;
  }
  group(p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], parent?: THREE.Object3D) {
    const g = new THREE.Group();
    g.position.set(p[0], p[1], p[2]);
    g.rotation.set(r[0], r[1], r[2]);
    (parent ?? this.g).add(g);
    return g;
  }
}

/**
 * Hull shell from stations. Length along x (bow at +x), beam along z, keel at y=0,
 * sheer (deck edge) at y=depth. Open top.
 */
export function hullGeometry(length: number, beam: number, depth: number, opts: { transom?: number; bowRake?: number } = {}) {
  const stations = 14;
  const ring = 9; // points from port sheer through keel to starboard sheer
  const transom = opts.transom ?? 0.75;
  const pos: number[] = [];
  for (let s = 0; s <= stations; s++) {
    const t = s / stations; // 0 = stern, 1 = bow
    const x = (t - 0.5) * length;
    // Half-beam: full at stern (transom), widest near 40%, fine at bow.
    const hb =
      0.5 * beam * (t < 0.45 ? transom + (1 - transom) * Math.sin((t / 0.45) * Math.PI * 0.5) : Math.cos(((t - 0.45) / 0.55) * Math.PI * 0.5) ** 0.8);
    const keelY = t > 0.75 ? ((t - 0.75) / 0.25) ** 2 * depth * (opts.bowRake ?? 0.55) : 0;
    const sheerY = depth + (t > 0.7 ? ((t - 0.7) / 0.3) ** 2 * depth * 0.25 : 0);
    for (let k = 0; k < ring; k++) {
      const a = (k / (ring - 1)) * Math.PI; // 0..pi
      const zz = -Math.cos(a) * Math.max(hb, 0.02);
      const bilge = Math.sin(a);
      const y = sheerY - (sheerY - keelY) * Math.pow(bilge, 0.55);
      pos.push(x, y, zz);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < stations; s++) {
    for (let k = 0; k < ring - 1; k++) {
      const a = s * ring + k;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Transom plate.
  const base = pos.length / 3;
  pos.push(-length / 2, depth, 0);
  for (let k = 0; k < ring - 1; k++) idx.push(base, k + 1, k, base, k, k + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ----------------------------------------------------------------- wrecks

export function buildSchooner(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const ship = b.group([0, -0.6, 0], [0.32, 0, 0.05]);
  const hull = b.add(hullGeometry(22, 6, 3.2, { transom: 0.55 }), 0x5b4330, [0, 0, 0], [0, 0, 0], ship);
  hull.scale.set(1, 1, 1);
  // Broken deck beams and exposed ribs.
  for (let i = 0; i < 9; i++) {
    const x = -8 + i * 2;
    if (rng() < 0.3) continue;
    b.box(0.3, 0.25, 5.2 - Math.abs(x) * 0.12, 0x6e5238, [x, 3.0, 0], [0, 0, (rng() - 0.5) * 0.2], ship);
  }
  for (let i = 0; i < 6; i++) b.box(0.25, 2.8, 0.25, 0x4a3727, [-10 + i * 0.9, 1.6, 2.9 - i * 0.05], [0.25, 0, 0], ship);
  // Fallen masts.
  b.cyl(0.25, 0.32, 17, 0x6b5136, [3, 0.4, -6], [0, 0.2, Math.PI / 2 + 0.05]);
  b.cyl(0.2, 0.26, 12, 0x6b5136, [-6, 0.3, 5.5], [0, -0.4, Math.PI / 2]);
  // Barrels.
  for (let i = 0; i < 5; i++)
    b.cyl(0.45, 0.45, 1.1, 0x6a4b2c, [(rng() - 0.5) * 14, 0.45, 5 + rng() * 4], [Math.PI / 2, rng() * 3, 0], 7);
  return b.g;
}

export function buildFerry(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const ship = b.group([0, 0, 0], [0.08, 0, -0.04]);
  // Double-ended hull: two half hulls back to back.
  const L = 36;
  const hullA = hullGeometry(L, 10, 3.2, { transom: 1.0, bowRake: 0.3 });
  b.add(hullA, 0x2c3e3a, [0, 0, 0], [0, 0, 0], ship);
  b.box(L * 0.86, 0.4, 9.6, 0x3f524c, [0, 3.2, 0], [0, 0, 0], ship); // car deck
  b.box(L * 0.7, 2.6, 0.3, 0xd8d4c4, [0, 4.6, 4.6], [0, 0, 0], ship);
  b.box(L * 0.7, 2.6, 0.3, 0xd8d4c4, [0, 4.6, -4.6], [0, 0, 0], ship);
  b.box(L * 0.62, 2.4, 9.4, 0xcfcab6, [0, 7.0, 0], [0, 0, 0], ship); // passenger deck
  b.box(3, 2.0, 4, 0xe0dccc, [L * 0.28, 9.2, 0], [0, 0, 0], ship); // pilothouses
  b.box(3, 2.0, 4, 0xe0dccc, [-L * 0.28, 9.2, 0], [0, 0, 0], ship);
  b.cyl(0.9, 1.1, 3.4, 0x2c5b46, [0, 9.9, 0], [0, 0, 0], 10, ship); // funnel
  // Cars still on deck, one tipped.
  for (let i = 0; i < 4; i++) {
    const car = buildSedan(seed + i, rng() < 0.5 ? 0x8a2f2f : 0x2f4f8a);
    car.position.set(-10 + i * 6, 3.4, (i % 2 ? 2.2 : -2.2));
    car.rotation.set(0, rng() * 0.3, i === 2 ? 1.2 : 0);
    car.scale.setScalar(0.95);
    ship.add(car);
  }
  return b.g;
}

export function buildSedan(seed: number, color?: number) {
  const rng = mulberry32(seed);
  const hex = color ?? [0x8a2f2f, 0x2f4f8a, 0xcfcfc8, 0x2e2e2e, 0x5c7a4a][Math.floor(rng() * 5)];
  const b = new Builder();
  b.box(4.6, 0.8, 1.8, hex, [0, 0.75, 0]);
  b.box(2.4, 0.65, 1.6, hex, [-0.2, 1.45, 0]);
  b.box(2.2, 0.5, 1.62, 0x1d2a30, [-0.2, 1.45, 0]);
  for (const [x, z] of [
    [1.4, 0.85],
    [1.4, -0.85],
    [-1.5, 0.85],
    [-1.5, -0.85],
  ])
    b.cyl(0.38, 0.38, 0.28, 0x1a1a1a, [x, 0.38, z], [Math.PI / 2, 0, 0], 8);
  return b.g;
}

export function buildContainer(seed: number) {
  const rng = mulberry32(seed);
  const hex = [0xa33a2a, 0x2a5aa3, 0x3a7d44, 0xc77a2a, 0x7a7a7a][Math.floor(rng() * 5)];
  const b = new Builder();
  const c = b.group([0, 1.2, 0], [0, 0, rng() < 0.4 ? 0.25 : 0]);
  b.box(12.2, 2.6, 2.45, hex, [0, 0, 0], [0, 0, 0], c);
  for (let i = 0; i < 18; i++) b.box(0.12, 2.5, 2.55, hex, [-5.8 + i * 0.68, 0, 0], [0, 0, 0], c);
  // Door end open.
  b.box(0.1, 2.5, 1.2, hex, [6.3, 0, 1.6], [0, 0.9, 0], c);
  return b.g;
}

export function buildConcreteBarge(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const g = b.group([0, 0, 0], [0.03, 0, 0.06]);
  b.box(30, 4, 0.8, 0x8e8c84, [0, 2, 4.4], [0, 0, 0], g);
  b.box(30, 4, 0.8, 0x8e8c84, [0, 2, -4.4], [0, 0, 0], g);
  b.box(30, 0.8, 9.6, 0x86847c, [0, 0.4, 0], [0, 0, 0], g);
  b.box(0.8, 4, 9.6, 0x8e8c84, [14.6, 2, 0], [0, 0, 0], g);
  b.box(0.8, 3, 9.6, 0x8e8c84, [-14.6, 1.5, 0], [0, 0, 0.3], g);
  for (let i = 0; i < 5; i++) b.box(0.6, 3.4, 8.8, 0x8a887f, [-10 + i * 5, 1.9, 0], [0, 0, 0], g);
  for (let i = 0; i < 6; i++) b.sphere(0.8 + rng(), 0x8e8c84, [(rng() - 0.5) * 30, 0.4, (rng() - 0.5) * 16], [1, 0.6, 1.2]);
  return b.g;
}

export function buildFloatplane(seed: number) {
  void seed;
  const b = new Builder();
  const p = b.group([0, 0.3, 0], [0.05, 0.3, -0.12]);
  b.cyl(0.75, 0.45, 9.5, 0xd8d2bf, [0, 2.2, 0], [0, 0, Math.PI / 2], 8, p); // fuselage
  b.cyl(0.78, 0.78, 0.4, 0xb8372c, [3.0, 2.2, 0], [0, 0, Math.PI / 2], 8, p);
  b.box(1.6, 0.25, 14.5, 0xd8d2bf, [1.3, 3.0, 0], [0, 0, 0], p); // wing
  b.box(1.0, 0.25, 0.6, 0xb8372c, [1.3, 3.0, 7.0], [0, 0, 0], p);
  b.box(1.0, 0.25, 0.6, 0xb8372c, [1.3, 3.0, -7.0], [0, 0, 0], p);
  b.box(1.0, 1.6, 0.15, 0xd8d2bf, [-4.6, 3.0, 0], [0, 0, 0], p); // fin
  b.box(0.9, 0.12, 3.6, 0xd8d2bf, [-4.5, 2.4, 0], [0, 0, 0], p);
  b.box(0.2, 2.2, 0.2, 0x2a2a2a, [4.95, 2.2, 0], [0.8, 0, 0], p); // prop
  // Floats and struts.
  for (const z of [1.5, -1.5]) {
    const f = b.cyl(0.35, 0.35, 7.0, 0xc9c3b0, [0.5, 0.35, z], [0, 0, Math.PI / 2], 8, p);
    f.scale.set(1, 1, 1.15);
    b.box(0.12, 1.5, 0.12, 0x8a8a8a, [1.8, 1.2, z * 0.7], [z > 0 ? -0.35 : 0.35, 0, 0], p);
    b.box(0.12, 1.5, 0.12, 0x8a8a8a, [-0.8, 1.2, z * 0.7], [z > 0 ? -0.35 : 0.35, 0, 0], p);
  }
  return b.g;
}

export function buildMiniSub(seed: number) {
  void seed;
  const b = new Builder();
  const s = b.group([0, 0.4, 0], [0, 0, 0.18]);
  b.sphere(1.0, 0xe8c31f, [0, 1.3, 0], [3.0, 1.15, 1.15], s, 1);
  b.box(1.6, 1.2, 0.5, 0xe8c31f, [0.4, 2.6, 0], [0, 0, 0], s);
  b.sphere(0.65, 0x23404a, [2.75, 1.3, 0], [1, 1, 1], s, 1);
  b.box(0.2, 1.2, 1.4, 0xe8c31f, [-3.2, 1.3, 0], [0, 0, 0], s);
  b.cyl(0.35, 0.35, 0.35, 0x444444, [-3.4, 1.3, 0], [0, 0, Math.PI / 2], 8, s);
  for (const z of [0.9, -0.9]) b.box(5.0, 0.15, 0.15, 0x777777, [0, 0.1, z], [0, 0, 0], s);
  b.box(0.8, 0.5, 0.5, 0xcc5522, [-1.2, 0.55, 0.5], [0, 0, 0], s);
  return b.g;
}

export function buildLostTowfish(seed: number) {
  void seed;
  const b = new Builder();
  const f = b.group([0, 0.3, 0], [0, 0, 0.12]);
  b.cyl(0.14, 0.14, 1.5, 0xf2c21b, [0, 0, 0], [0, 0, Math.PI / 2], 10, f);
  b.add(new THREE.ConeGeometry(0.14, 0.35, 10), 0xf2c21b, [0.92, 0, 0], [0, 0, -Math.PI / 2], f);
  for (let i = 0; i < 4; i++) b.box(0.25, 0.02, 0.5, 0xd9a816, [-0.6, 0, 0], [(i * Math.PI) / 2, 0, 0], f);
  // Coil of cable.
  const coil = new THREE.TorusGeometry(0.9, 0.05, 4, 18);
  for (let i = 0; i < 3; i++) b.add(coil, 0x222222, [-1.6, 0.05 + i * 0.08, 0.6], [Math.PI / 2, 0, i * 0.4]);
  return b.g;
}

export function buildAnchor(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const a = b.group([0, 0.5, 0], [Math.PI / 2 - 0.15, 0, 0.1]);
  b.cyl(0.18, 0.18, 4.2, 0x3a3631, [0, 0, 0], [0, 0, 0], 6, a); // shank
  b.cyl(0.12, 0.12, 3.6, 0x3a3631, [0, 1.9, 0], [0, 0, Math.PI / 2], 6, a); // stock
  const arm = new THREE.TorusGeometry(1.5, 0.16, 5, 10, Math.PI);
  b.add(arm, 0x3a3631, [0, -0.6, 0], [0, 0, Math.PI], a);
  b.add(new THREE.ConeGeometry(0.35, 0.7, 4), 0x3a3631, [1.5, -0.4, 0], [0, 0, -0.4], a);
  b.add(new THREE.ConeGeometry(0.35, 0.7, 4), 0x3a3631, [-1.5, -0.4, 0], [0, 0, 0.4], a);
  // Chain across the bottom.
  const link = new THREE.TorusGeometry(0.28, 0.08, 4, 8);
  let x = 0;
  let z = -2.6;
  let ang = 0;
  for (let i = 0; i < 40; i++) {
    ang += (rng() - 0.5) * 0.35;
    x += Math.sin(ang) * 0.42;
    z -= Math.cos(ang) * 0.42;
    b.add(link, 0x413a33, [x, 0.12, z], [i % 2 ? Math.PI / 2 : 0, ang, 0]);
  }
  return b.g;
}

export function buildCrabPots(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  for (let i = 0; i < 5; i++) {
    const x = (rng() - 0.5) * 9;
    const z = (rng() - 0.5) * 9;
    const pot = b.group([x, 0, z], [0, rng() * 3, rng() < 0.3 ? 0.4 : 0]);
    b.cyl(0.6, 0.6, 0.45, 0x5a6066, [0, 0.25, 0], [0, 0, 0], 8, pot);
    b.cyl(0.62, 0.62, 0.05, 0x8a2a20, [0, 0.48, 0], [0, 0, 0], 8, pot);
  }
  return b.g;
}

export function buildShoppingCarts(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  for (let i = 0; i < 6; i++) {
    const c = b.group([(rng() - 0.5) * 7, 0, (rng() - 0.5) * 7], [rng() < 0.5 ? Math.PI / 2 : 0, rng() * 6, 0]);
    c.position.y = c.rotation.x ? 0.45 : 0;
    b.box(0.9, 0.05, 0.55, 0x9aa0a4, [0, 0.55, 0], [0, 0, 0], c);
    b.box(0.9, 0.55, 0.04, 0x9aa0a4, [0, 0.82, 0.27], [0, 0, 0], c);
    b.box(0.9, 0.55, 0.04, 0x9aa0a4, [0, 0.82, -0.27], [0, 0, 0], c);
    b.box(0.04, 0.55, 0.55, 0x9aa0a4, [0.45, 0.82, 0], [0, 0, 0], c);
    b.box(0.04, 0.7, 0.55, 0xb03030, [-0.5, 0.95, 0], [0, 0, 0.2], c);
    for (const [x, z] of [
      [0.4, 0.22],
      [0.4, -0.22],
      [-0.4, 0.22],
      [-0.4, -0.22],
    ])
      b.cyl(0.07, 0.07, 0.05, 0x222222, [x, 0.07, z], [Math.PI / 2, 0, 0], 6, c);
  }
  return b.g;
}

// ----------------------------------------------------------------- legends and oddities

export function buildSerpent(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    pts.push(new THREE.Vector3(-19 + t * 38, 0.4, Math.sin(t * Math.PI * 2.2) * 4.5 * (0.3 + t)));
  }
  const bone = 0xe6dcc2;
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const p = pts[i];
    const r = 0.55 * (1 - t * 0.75);
    b.sphere(r, bone, [p.x, p.y + r * 0.4, p.z], [1.2, 0.8, 1]);
    // Ribs on the front half.
    if (i > 4 && i < 30 && i % 2 === 0) {
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const ang = Math.atan2(next.z - p.z, next.x - p.x);
      for (const side of [1, -1]) {
        const len = 2.4 * (1 - Math.abs(i - 14) / 22);
        const rib = b.cyl(0.08, 0.12, len, bone, [p.x, p.y + 0.3, p.z], [0, 0, 0], 5);
        rib.rotation.set(0, -ang, 0);
        rib.rotateX(side * (Math.PI / 2 - 0.5));
        rib.translateY(len / 2);
      }
    }
  }
  // Skull at the head end (front = -x end).
  const h = pts[0];
  const skull = b.group([h.x - 1.6, 0.6, h.z], [0, 0, 0.1]);
  b.sphere(1.1, bone, [0, 0.2, 0], [1.6, 0.8, 1], skull, 0);
  b.box(2.6, 0.35, 0.9, bone, [-1.8, 0.0, 0], [0, 0, 0.1], skull);
  b.box(2.4, 0.3, 0.85, bone, [-1.7, -0.45, 0.1], [0, 0.1, -0.15], skull);
  for (let i = 0; i < 6; i++) b.add(new THREE.ConeGeometry(0.08, 0.35, 4), 0xfff7e0, [-0.7 - i * 0.4, -0.2, 0.35], [Math.PI, 0, 0], skull);
  for (const z of [0.45, -0.45]) b.sphere(0.22, 0x1c1c1c, [0.2, 0.45, z], [1, 1, 1], skull);
  void rng;
  return b.g;
}

export function buildSaucer(seed: number) {
  void seed;
  const b = new Builder();
  const s = b.group([0, 0.8, 0], [0.22, 0, 0.08]);
  const prof = [
    new THREE.Vector2(0.01, -0.9),
    new THREE.Vector2(3.0, -0.7),
    new THREE.Vector2(7.0, 0),
    new THREE.Vector2(3.2, 0.6),
    new THREE.Vector2(0.01, 0.7),
  ];
  b.add(new THREE.LatheGeometry(prof, 20), 0xb8c0c6, [0, 0, 0], [0, 0, 0], s);
  b.sphere(2.2, 0x5ad1c4, [0, 1.0, 0], [1, 0.65, 1], s, 1);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), lambert(0x9effa0, { emissive: 0x3aff5a, caustics: false }));
    m.position.set(Math.cos(a) * 5.4, 0.05, Math.sin(a) * 5.4);
    s.add(m);
  }
  return b.g;
}

export function buildFootprints(seed: number) {
  void seed;
  const b = new Builder();
  const prints = footprintLayout();
  const mat = lambert(0x2b2a22, { caustics: false });
  for (const fp of prints) {
    const g = new THREE.Group();
    g.position.set(fp.x, 0.04, fp.z);
    g.rotation.y = fp.yaw;
    const sole = new THREE.Mesh(new THREE.CircleGeometry(1, 12), mat);
    sole.rotation.x = -Math.PI / 2;
    sole.scale.set(1.25, 0.55, 1);
    g.add(sole);
    for (let t = 0; t < 5; t++) {
      const toe = new THREE.Mesh(new THREE.CircleGeometry(0.2 - t * 0.015, 8), mat);
      toe.rotation.x = -Math.PI / 2;
      toe.position.set(1.45, 0, -0.45 + t * 0.22 * (fp.left ? 1 : -1) + (fp.left ? 0 : 0.9));
      g.add(toe);
    }
    b.g.add(g);
  }
  return b.g;
}

export function footprintLayout() {
  const out: { x: number; z: number; yaw: number; left: boolean }[] = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const x = -18 + t * 36;
    const z = Math.sin(t * 2.4) * 3 + (i % 2 ? 1.1 : -1.1);
    out.push({ x, z, yaw: -Math.cos(t * 2.4) * 0.25, left: i % 2 === 0 });
  }
  return out;
}

export function footprintCarve(lx: number, lz: number): number {
  for (const fp of footprintLayout()) {
    const dx = lx - fp.x;
    const dz = lz - fp.z;
    const c = Math.cos(fp.yaw);
    const s = Math.sin(fp.yaw);
    const u = dx * c - dz * s;
    const v = dx * s + dz * c;
    const e = (u / 1.35) ** 2 + (v / 0.62) ** 2;
    if (e < 1) return -0.45 * (1 - e * e);
    // Toes
    if (u > 1.2 && u < 1.75 && Math.abs(v) < 0.65) return -0.3;
  }
  return NaN;
}

export function buildTreasureChest(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const c = b.group([0, 0, 0], [0, 0, 0.08]);
  b.box(1.4, 0.8, 0.9, 0x6b4423, [0, 0.4, 0], [0, 0, 0], c);
  b.box(1.45, 0.1, 0.95, 0xb8962e, [0, 0.4, 0], [0, 0, 0], c);
  const lid = b.add(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 8, 1, false, 0, Math.PI), 0x6b4423, [0, 0.8, -0.45], [0, 0, 0], c);
  lid.rotation.set(-1.1, 0, Math.PI / 2);
  for (let i = 0; i < 30; i++)
    b.cyl(0.08, 0.08, 0.02, 0xf2c94c, [(rng() - 0.3) * 2.6, 0.02, (rng() - 0.5) * 2.4], [rng() * 0.3, 0, 0], 6);
  b.box(0.6, 0.6, 0.6, 0x7a7a7a, [1.6, 0.3, 0.8], [0.3, 0.5, 0]);
  return b.g;
}

export function buildPiano(seed: number) {
  void seed;
  const b = new Builder();
  const p = b.group([0, 0, 0], [0, 0, -0.12]);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1.5, 0);
  shape.bezierCurveTo(1.5, 1.2, 0.6, 1.4, 0.7, 2.6);
  shape.lineTo(0, 2.6);
  shape.lineTo(0, 0);
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
  body.rotateX(Math.PI / 2);
  body.translate(-0.75, 1.0, -1.3);
  b.add(body, 0x151515, [0, 0, 0], [0, 0, 0], p);
  const lid = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  lid.rotateX(Math.PI / 2);
  lid.translate(-0.75, 0, -1.3);
  b.add(lid, 0x1b1b1b, [0, 1.05, 0], [0.7, 0, 0], p).position.set(0, 1.05, 0);
  b.box(1.5, 0.12, 0.35, 0xf0ece0, [0, 0.72, -1.45], [0, 0, 0], p);
  for (const [x, z] of [
    [-0.6, -1.1],
    [0.6, -1.1],
    [0.0, 1.1],
  ])
    b.cyl(0.07, 0.05, 0.7, 0x151515, [x, 0.35, z], [0, 0, 0], 6, p);
  return b.g;
}

export function buildGiantMug(seed: number) {
  void seed;
  const b = new Builder();
  const m = b.group([0, 2.6, 0], [0, 0, Math.PI / 2 - 0.05]);
  b.cyl(2.6, 2.3, 6.2, 0xf3efe6, [0, 0, 0], [0, 0, 0], 16, m);
  b.cyl(2.35, 2.35, 0.1, 0x8a5a36, [0, 2.6, 0], [0, 0, 0], 16, m); // latte
  b.add(new THREE.TorusGeometry(1.6, 0.45, 6, 12, Math.PI), 0xf3efe6, [2.4, 0, 0], [0, 0, -Math.PI / 2], m);
  b.cyl(2.62, 2.62, 0.9, 0x1e6b4a, [0, 0.4, 0], [0, 0, 0], 16, m); // band
  return b.g;
}

export function buildOctopusDen(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  for (let i = 0; i < 9; i++)
    b.sphere(1.2 + rng() * 1.4, 0x6e6a66, [(rng() - 0.5) * 7, 0.6, (rng() - 0.5) * 7], [1, 0.7 + rng() * 0.4, 1], undefined, 0);
  const o = b.group([1.8, 1.6, 1.0], [0, rng() * 6, 0]);
  b.sphere(1.0, 0xc4502e, [0, 0.6, 0], [1, 1.25, 1], o, 1);
  for (const z of [0.45, -0.45]) b.sphere(0.15, 0x1a1a1a, [0.75, 0.6, z], [1, 1, 1], o);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 6; k++) {
      const r = 0.5 + k * 0.6;
      pts.push(new THREE.Vector3(Math.cos(a + k * 0.25) * r, -0.3 - k * 0.12 + Math.sin(k + i) * 0.2, Math.sin(a + k * 0.25) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    b.add(new THREE.TubeGeometry(curve, 10, 0.16, 5), 0xc4502e, [0, 0, 0], [0, 0, 0], o);
  }
  return b.g;
}

export function buildSOS(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const pts = sosPoints();
  for (const [x, z] of pts) b.sphere(0.75 + rng() * 0.35, 0x7d7870, [x, 0.4, z], [1, 0.75, 1]);
  return b.g;
}

/** Stone positions spelling SOS. Letters 8 m tall, read with +x as "up". */
export function sosPoints(): [number, number][] {
  const out: [number, number][] = [];
  const add = (cx: number, segs: [number, number, number, number][]) => {
    for (const [x0, z0, x1, z1] of segs) {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.5));
      for (let i = 0; i <= n; i++) out.push([cx + x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
    }
  };
  // Letter frame: z = 0..8 is "down the page", x across. Use 5 m wide letters.
  const S: [number, number, number, number][] = [
    [5, 0, 0, 0],
    [0, 0, 0, 4],
    [0, 4, 5, 4],
    [5, 4, 5, 8],
    [5, 8, 0, 8],
  ];
  const O: [number, number, number, number][] = [
    [0, 0, 5, 0],
    [5, 0, 5, 8],
    [5, 8, 0, 8],
    [0, 8, 0, 0],
  ];
  add(-11, S);
  add(-2.5, O);
  add(6, S);
  return out.map(([x, z]) => [x, z - 4]);
}

// ----------------------------------------------------------------- natural features

export function buildErratic(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.8 + rng() * 0.4;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const r = 3.5 + rng() * 2.5;
  const m = b.add(geo, 0x8b8178, [0, r * 0.45, 0], [rng(), rng(), rng()]);
  m.scale.set(r, r * 0.8, r * 1.15);
  for (let i = 0; i < 4; i++) b.sphere(0.5 + rng() * 0.8, 0x7d756c, [(rng() - 0.5) * r * 3, 0.3, (rng() - 0.5) * r * 3]);
  return b.g;
}

export function buildPinnacle(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const h = 7 + rng() * 5;
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const r = (1 - t) * 3.2 + 0.6;
    b.sphere(r, 0x6d6a6a, [(rng() - 0.5) * 1.2, t * h + r * 0.4, (rng() - 0.5) * 1.2], [1, 1.1, 1]);
  }
  for (let i = 0; i < 5; i++) b.sphere(0.8 + rng(), 0x77736f, [(rng() - 0.5) * 9, 0.4, (rng() - 0.5) * 9], [1, 0.7, 1]);
  return b.g;
}

export function buildDrownedForest(seed: number) {
  const rng = mulberry32(seed);
  const b = new Builder();
  for (let i = 0; i < 11; i++) {
    const r = 0.5 + rng() * 0.6;
    const h = 1.2 + rng() * 4.5;
    b.cyl(r * 0.8, r, h, 0x4b3b2b, [(rng() - 0.5) * 22, h / 2, (rng() - 0.5) * 22], [(rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25], 7);
  }
  for (let i = 0; i < 4; i++)
    b.cyl(0.4, 0.55, 8 + rng() * 6, 0x4f3f2e, [(rng() - 0.5) * 18, 0.5, (rng() - 0.5) * 18], [0, rng() * 3, Math.PI / 2], 7);
  return b.g;
}

export function buildSeep(seed: number) {
  void seed;
  // The depression itself is carved into the seabed; the model adds the white
  // bacterial mat at the vent.
  const b = new Builder();
  const mat = new THREE.Mesh(new THREE.CircleGeometry(2.2, 10), lambert(0xe8e6da));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = -1.6;
  b.g.add(mat);
  return b.g;
}

export function seepCarve(lx: number, lz: number): number {
  const d2 = (lx * lx + lz * lz) / (11 * 11);
  if (d2 >= 1) return NaN;
  const k = 1 - d2;
  return -1.9 * k * k + 0.45 * Math.exp(-((Math.sqrt(d2) - 0.85) ** 2) / 0.012);
}

// ----------------------------------------------------------------- discovery buoy

export function buildBuoy(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.MeshLambertMaterial({ color: 0xf2b134, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0xc23b22, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.0, 8), top);
  body.position.y = 0.3;
  g.add(body);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), red);
  pole.position.y = 1.8;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.03), red);
  flag.position.set(0.4, 2.6, 0);
  g.add(flag);
  return g;
}
