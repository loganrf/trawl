// Landmarks for navigation: generic city blocks, lighthouses on the real points and a
// suspension bridge across Tacoma Narrows. Bridge piers are also seabed objects, so the
// hull can hit them and the sonar sees them.

import * as THREE from 'three';
import { Mat, Terrain } from './terrain';
import { applyUnderwater } from './materials';
import { mulberry32 } from './noise';

const CITIES: [string, number, number, number, number][] = [
  // name, lat, lon, radius (game m), building count
  ['Seattle', 47.607, -122.336, 75, 140],
  ['Tacoma', 47.252, -122.438, 55, 60],
  ['Everett', 47.982, -122.205, 45, 40],
  ['Bremerton', 47.567, -122.628, 35, 30],
  ['Olympia', 47.043, -122.9, 35, 30],
  ['Port Townsend', 48.116, -122.758, 25, 22],
  ['Edmonds', 47.811, -122.379, 22, 16],
];

const LIGHTS: [string, number, number][] = [
  ['West Point', 47.662, -122.435],
  ['Alki Point', 47.576, -122.42],
  ['Point No Point', 47.912, -122.527],
  ['Point Robinson', 47.388, -122.374],
  ['Browns Point', 47.306, -122.444],
  ['Point Wilson', 48.144, -122.755],
  ['Mukilteo', 47.949, -122.306],
  ['Marrowstone Point', 48.102, -122.687],
];

/** City centres and radii in game coordinates (no forest inside). */
export function cityZones(map: { fromGeo(lat: number, lon: number): { x: number; z: number } }) {
  return CITIES.map(([, lat, lon, radius]) => ({ ...map.fromGeo(lat, lon), r: radius }));
}

export class Landmarks {
  readonly root = new THREE.Group();

  constructor(private terrain: Terrain) {
    this.buildCities();
    this.buildLighthouses();
    this.buildNarrowsBridge();
  }

  private buildCities() {
    const map = this.terrain.map;
    const rng = mulberry32(this.terrain.seed ^ 0xc17e);
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const palette = [0xc9c2b4, 0xb3ada2, 0x8aa1b4, 0x9e7462, 0xd8d2c4, 0x6f8494];
    for (const [, lat, lon, radius, count] of CITIES) {
      const c = map.fromGeo(lat, lon);
      let placed = 0;
      for (let tries = 0; tries < count * 12 && placed < count; tries++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const h = this.terrain.naturalHeight(x, z);
        if (h < 1.0) continue;
        const w = 3 + rng() * 5;
        const d = 3 + rng() * 5;
        const hx = this.terrain.naturalHeight(x + w, z);
        const hz = this.terrain.naturalHeight(x, z + d);
        if (hx < 0.8 || hz < 0.8 || Math.abs(hx - h) > 3 || Math.abs(hz - h) > 3) continue;
        const core = Math.exp(-r / (radius * 0.35));
        const ht = 3 + rng() * 6 + core * (radius / 2.2) * (0.4 + rng());
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, Math.min(h, hx, hz) - 1, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35),
          new THREE.Vector3(w, ht + 1, d),
        );
        mats.push(m);
        cols.push(new THREE.Color(palette[Math.floor(rng() * palette.length)]));
        placed++;
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => {
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, cols[i]);
    });
    inst.computeBoundingSphere();
    inst.frustumCulled = false;
    this.root.add(inst);
  }

  private buildLighthouses() {
    const map = this.terrain.map;
    const white = new THREE.MeshLambertMaterial({ color: 0xf4f1e8, flatShading: true });
    const red = new THREE.MeshLambertMaterial({ color: 0xb8322a, flatShading: true });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
    for (const [, lat, lon] of LIGHTS) {
      const p = map.fromGeo(lat, lon);
      const site = this.findShore(p.x, p.z);
      if (!site) continue;
      const g = new THREE.Group();
      g.position.set(site.x, site.h - 0.2, site.z);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 5.5, 8), white);
      tower.position.y = 2.75;
      const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 8), red);
      gallery.position.y = 5.6;
      const light = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.8, 8), lamp);
      light.position.y = 6.1;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.9, 8), red);
      cap.position.y = 6.95;
      const house = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 2.2), white);
      house.position.set(2.2, 0.9, 0);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 2.5), red);
      roof.position.set(2.2, 1.95, 0);
      g.add(tower, gallery, light, cap, house, roof);
      this.root.add(g);
    }
  }

  /** Nearest low land point near (x, z). */
  private findShore(x0: number, z0: number): { x: number; z: number; h: number } | null {
    for (let r = 0; r < 400; r += 3) {
      const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 3));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r;
        const z = z0 + Math.sin(a) * r;
        const h = this.terrain.naturalHeight(x, z);
        if (h > 0.6 && h < 4 && this.terrain.naturalHeight(x + 4, z) > 0.3 && this.terrain.naturalHeight(x - 4, z) > 0.3)
          return { x, z, h };
      }
    }
    return null;
  }

  private buildNarrowsBridge() {
    const map = this.terrain.map;
    const c = map.fromGeo(47.2688, -122.5513);
    const z = c.z;
    // Find the shores east and west of the centre.
    let xw = c.x;
    let xe = c.x;
    while (xw > c.x - 600 && this.terrain.naturalHeight(xw, z) < 1.5) xw -= 2;
    while (xe < c.x + 600 && this.terrain.naturalHeight(xe, z) < 1.5) xe += 2;
    if (xe - xw < 40) return;
    const span = xe - xw;
    const deckY = 7;
    const towerH = 17;
    const green = new THREE.MeshLambertMaterial({ color: 0x5f7f6a, flatShading: true });
    const concrete = applyUnderwater(new THREE.MeshLambertMaterial({ color: 0x9a978f, flatShading: true }));
    const g = new THREE.Group();

    const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 60, 0.9, 4.2), green);
    deck.position.set((xw + xe) / 2, deckY, z);
    g.add(deck);
    const road = new THREE.Mesh(new THREE.BoxGeometry(span + 60, 0.1, 3.6), new THREE.MeshLambertMaterial({ color: 0x3b3b3b }));
    road.position.set((xw + xe) / 2, deckY + 0.5, z);
    g.add(road);

    const towersX = [xw + span * 0.2, xe - span * 0.2];
    for (const tx of towersX) {
      const seabed = this.terrain.naturalHeight(tx, z);
      for (const dz of [-2.1, 2.1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, towerH, 0.8), green);
        leg.position.set(tx, towerH / 2, z + dz);
        g.add(leg);
      }
      for (const y of [deckY - 1, 11, towerH - 0.5]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 5), green);
        beam.position.set(tx, y, z);
        g.add(beam);
      }
      // Pier from the seabed to just above the water.
      const pierH = -seabed + 1.2;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3, pierH, 7), concrete);
      pier.position.set(tx, seabed + pierH / 2, z);
      g.add(pier);
      const nx = 6;
      const nz = 14;
      this.terrain.addObject({
        id: `bridge-pier-${tx.toFixed(0)}`,
        x: tx,
        z,
        baseY: seabed,
        yaw: 0,
        cos: 1,
        sin: 0,
        hw: 1.5,
        hd: 3.5,
        res: 0.5,
        nx,
        nz,
        heights: new Float32Array(nx * nz).fill(pierH),
        mode: 'add',
        mat: Mat.Stone,
      });
    }

    // Main cables: anchor on land, up to the tower tops, sag between them.
    const cablePts = (dz: number) => {
      const pts: THREE.Vector3[] = [];
      const a0 = xw - 30;
      const a1 = xe + 30;
      const [t0, t1] = towersX;
      const sagY = deckY + 1.2;
      for (let i = 0; i <= 80; i++) {
        const x = a0 + ((a1 - a0) * i) / 80;
        let y: number;
        if (x < t0) y = deckY + ((towerH - deckY) * (x - a0)) / (t0 - a0);
        else if (x > t1) y = towerH - ((towerH - deckY) * (x - t1)) / (a1 - t1);
        else {
          const u = (x - t0) / (t1 - t0);
          y = towerH - (towerH - sagY) * (1 - (2 * u - 1) ** 2);
        }
        pts.push(new THREE.Vector3(x, y, z + dz));
      }
      return pts;
    };
    const cableMat = new THREE.LineBasicMaterial({ color: 0x3e5547 });
    for (const dz of [-2.1, 2.1]) {
      const pts = cablePts(dz);
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
      const sus: THREE.Vector3[] = [];
      for (const p of pts) if (p.y > deckY + 1) sus.push(p.clone(), new THREE.Vector3(p.x, deckY + 0.4, p.z));
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(sus), cableMat));
    }
    this.root.add(g);
  }
}
