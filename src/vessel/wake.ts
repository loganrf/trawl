// Foam wake: a ribbon of recent stern positions that widens and fades with age.

import * as THREE from 'three';

interface WakePoint {
  x: number;
  z: number;
  px: number; // perpendicular unit vector
  pz: number;
  t: number;
  strength: number;
}

const MAX = 90;

export class Wake {
  readonly mesh: THREE.Mesh;
  private pts: WakePoint[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private uv: Float32Array;
  private lastX = NaN;
  private lastZ = NaN;
  private dist = 0;

  constructor() {
    this.pos = new Float32Array(MAX * 2 * 3);
    this.col = new Float32Array(MAX * 2 * 4);
    this.uv = new Float32Array(MAX * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      map: foamTexture(),
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }

  update(time: number, sternX: number, sternZ: number, heading: number, speed: number) {
    if (Number.isNaN(this.lastX)) {
      this.lastX = sternX;
      this.lastZ = sternZ;
    }
    const step = Math.hypot(sternX - this.lastX, sternZ - this.lastZ);
    this.dist += step;
    this.lastX = sternX;
    this.lastZ = sternZ;
    if (this.pts.length === 0 || this.dist > 1.2) {
      this.dist = 0;
      this.pts.unshift({
        x: sternX,
        z: sternZ,
        px: Math.cos(heading),
        pz: Math.sin(heading),
        t: time,
        strength: Math.min(1, Math.abs(speed) / 3),
      });
      if (this.pts.length > MAX) this.pts.pop();
    } else {
      // Head of the ribbon follows the stern.
      const p = this.pts[0];
      p.x = sternX;
      p.z = sternZ;
      p.px = Math.cos(heading);
      p.pz = Math.sin(heading);
    }
    const life = 14;
    let v = 0;
    for (let i = 0; i < MAX; i++) {
      const p = this.pts[Math.min(i, this.pts.length - 1)];
      const age = p ? time - p.t : life;
      const w = 1.2 + age * 0.55;
      const a = p && i < this.pts.length ? Math.max(0, 1 - age / life) * p.strength * 0.85 : 0;
      const k = i * 2;
      const y = 0.05;
      this.pos.set([p.x + p.px * w, y, p.z + p.pz * w, p.x - p.px * w, y, p.z - p.pz * w], k * 3);
      this.col.set([1, 1, 1, a, 1, 1, 1, a], k * 4);
      if (i > 0 && this.pts[i] && this.pts[i - 1]) v += Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].z - this.pts[i - 1].z) * 0.08;
      this.uv.set([0, v, 1, v], k * 2);
    }
    const geo = this.mesh.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
    geo.getAttribute('uv').needsUpdate = true;
  }
}

function foamTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 256);
  // Centre turbulence and two edge lines.
  for (let i = 0; i < 500; i++) {
    const x = 32 + (Math.random() - 0.5) * 40 * Math.random();
    const y = Math.random() * 256;
    const r = 1 + Math.random() * 3;
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (const x of [3, 61]) {
    for (let y = 0; y < 256; y += 2) {
      g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.4})`;
      g.fillRect(x - 2 + Math.random() * 2, y, 2.5, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
