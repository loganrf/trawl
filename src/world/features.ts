// Survey targets on the seabed: natural features, wrecks and easter eggs. Positions are
// seeded per game. Each target has a 3D model and a baked heightmap so the sonar sees
// the same shape the player sees.

import * as THREE from 'three';
import type { Places } from './places';
import { Mat, Terrain, type SeabedObject } from './terrain';
import { hashString, mulberry32 } from './noise';
import * as M from './models';

export type Category = 'natural' | 'debris' | 'wreck' | 'oddity' | 'legend';

export interface FeatureDef {
  type: string;
  name: string;
  category: Category;
  points: number;
  count: number;
  depth: [number, number];
  mat: Mat;
  build: (seed: number) => THREE.Group;
  /** Analytic carve (negative offsets) instead of a baked "add" heightmap. */
  carve?: { fn: (lx: number, lz: number) => number; hw: number; hd: number };
  zones?: string[];
  zoneRadius?: number;
  /** Text shown on discovery. */
  blurb: string;
  /** Rumour shown in the survey log before discovery ("{place}" is replaced). */
  rumor?: string;
  /** Gas plume in the water column (seeps). */
  plume?: boolean;
}

export const CATALOG: FeatureDef[] = [
  {
    type: 'crabpots', name: 'Derelict Crab Pots', category: 'debris', points: 40, count: 4, depth: [3, 14], mat: Mat.Metal,
    build: M.buildCrabPots, zones: ['Shilshole Bay', 'Port Madison', 'Kingston', 'Gig Harbor'], zoneRadius: 220,
    blurb: 'Lost pots keep fishing for years. Logging them helps the removal crews find them.',
  },
  {
    type: 'sedan', name: 'Sunken Sedan', category: 'debris', points: 75, count: 4, depth: [3, 20], mat: Mat.Metal,
    build: (s) => M.buildSedan(s), zones: ['Shilshole Bay', 'Elliott Bay', 'Commencement Bay', 'Everett'], zoneRadius: 260,
    blurb: 'Insurance fraud, a slipped parking brake on a boat ramp, or a very bad day. The sound keeps a lot of these.',
  },
  {
    type: 'container', name: 'Lost Shipping Container', category: 'debris', points: 100, count: 4, depth: [6, 30], mat: Mat.Metal,
    build: M.buildContainer, zones: ['Elliott Bay', 'Commencement Bay', 'East Passage', 'Possession Sound'], zoneRadius: 500,
    blurb: 'A 40-foot box that went over the side in a winter blow. The doors are open. The cargo is long gone.',
  },
  {
    type: 'carts', name: 'Shopping Cart Reef', category: 'debris', points: 60, count: 2, depth: [3, 14], mat: Mat.Metal,
    build: M.buildShoppingCarts, zones: ['Everett', 'Budd Inlet'], zoneRadius: 300,
    blurb: 'Six carts, one red handle. The local rockfish seem to like them.',
  },
  {
    type: 'anchor', name: 'Admiralty Anchor', category: 'debris', points: 120, count: 2, depth: [5, 26], mat: Mat.Metal,
    build: M.buildAnchor,
    blurb: 'A stocked anchor and a long run of chain. The ship that lost it was likely in a hurry.',
  },
  {
    type: 'erratic', name: 'Glacial Erratic', category: 'natural', points: 60, count: 6, depth: [3, 28], mat: Mat.Stone,
    build: M.buildErratic,
    blurb: 'A boulder the Puget Lobe of the Cordilleran ice sheet carried down from Canada about 15,000 years ago.',
  },
  {
    type: 'seep', name: 'Methane Seep', category: 'natural', points: 90, count: 4, depth: [10, 32], mat: Mat.Gravel, plume: true,
    build: M.buildSeep, carve: { fn: M.seepCarve, hw: 11.5, hd: 11.5 },
    blurb: 'Gas bubbles from a vent in the mud. The carbonate crust around it returns more sound than the mud does. Pass close and the plume shows in the water column.',
  },
  {
    type: 'pinnacle', name: 'Rock Pinnacle', category: 'natural', points: 90, count: 3, depth: [8, 30], mat: Mat.Rock,
    build: M.buildPinnacle,
    blurb: 'A spire of bedrock that the glaciers did not scour away. Lingcod territory.',
  },
  {
    type: 'forest', name: 'Drowned Forest', category: 'natural', points: 150, count: 2, depth: [4, 18], mat: Mat.Wood,
    build: M.buildDrownedForest, zones: ['Alki Point', 'Bainbridge Island', 'Carr Inlet'], zoneRadius: 500,
    blurb: 'Stumps still rooted where they grew. A large earthquake dropped this ground into the sound centuries ago.',
    rumor: 'Divers off {place} talk about tree stumps standing on the bottom.',
  },
  {
    type: 'barge', name: 'Concrete Barge', category: 'wreck', points: 200, count: 1, depth: [5, 22], mat: Mat.Stone,
    build: M.buildConcreteBarge, zones: ['Everett', 'Mukilteo', 'Possession Sound'], zoneRadius: 600,
    blurb: 'Wartime steel was scarce, so some barges were cast in concrete. This one was scuttled after the war.',
    rumor: 'An old concrete barge was scuttled somewhere near {place}.',
  },
  {
    type: 'schooner', name: 'Lumber Schooner', category: 'wreck', points: 250, count: 2, depth: [6, 28], mat: Mat.Wood,
    build: M.buildSchooner, zones: ['Port Townsend', 'Point No Point', 'Possession Sound', 'Port Ludlow'], zoneRadius: 600,
    blurb: 'A three-masted lumber carrier from the 1890s. Its masts fell across the bottom when the deck gave way.',
    rumor: 'A sailing ship went down with a load of lumber near {place}.',
  },
  {
    type: 'ferry', name: 'Lost Car Ferry', category: 'wreck', points: 400, count: 1, depth: [12, 32], mat: Mat.Metal,
    build: M.buildFerry, zones: ['Elliott Bay', 'Bainbridge Island', 'Alki Point', 'Blake Island'], zoneRadius: 700,
    blurb: 'A double-ended car ferry, still carrying its last sailing. Nobody agrees on how it sank.',
    rumor: 'Old-timers say a whole ferry, cars and all, lies on the bottom off {place}.',
  },
  {
    type: 'floatplane', name: 'Floatplane', category: 'wreck', points: 300, count: 1, depth: [5, 24], mat: Mat.Metal,
    build: M.buildFloatplane, zones: ['Port Madison', 'Kingston', 'West Point'], zoneRadius: 500,
    blurb: 'A single-engine bush plane on floats. The pilot swam to shore. The plane did not.',
    rumor: 'A floatplane went in on a foggy morning near {place}.',
  },
  {
    type: 'minisub', name: 'Research Submersible', category: 'oddity', points: 350, count: 1, depth: [12, 32], mat: Mat.Metal,
    build: M.buildMiniSub, zones: ['Dabob Bay'], zoneRadius: 500,
    blurb: 'A yellow two-person sub with its ballast dropped and its hatch shut. There is a test-range tag on the sail.',
    rumor: 'The range people at {place} lost something yellow. They will not say what.',
  },
  {
    type: 'towfish', name: 'Lost Towfish', category: 'oddity', points: 150, count: 1, depth: [8, 30], mat: Mat.Metal,
    build: M.buildLostTowfish, zones: ['Tacoma Narrows', 'Commencement Bay', 'Colvos Passage'], zoneRadius: 500,
    blurb: 'Another crew cut their cable on a snag. The reward tag on the nose is still readable. Every survey crew loses one eventually.',
    rumor: 'A survey crew lost their towfish near {place}. There is a reward.',
  },
  {
    type: 'piano', name: 'Grand Piano', category: 'oddity', points: 175, count: 1, depth: [4, 18], mat: Mat.Wood,
    build: M.buildPiano, zones: ['Budd Inlet', 'Gig Harbor', 'Quartermaster Harbor'], zoneRadius: 500,
    blurb: 'A full-size grand, lid open. Somebody had a very interesting party.',
    rumor: 'A barge party near {place} ended with a piano over the side.',
  },
  {
    type: 'chest', name: 'Treasure Chest', category: 'legend', points: 400, count: 1, depth: [4, 24], mat: Mat.Metal,
    build: M.buildTreasureChest, zones: ['Port Townsend', 'Admiralty Inlet', 'Marrowstone Island'], zoneRadius: 600,
    blurb: 'A banded chest and a spill of coins. Probably a prop from a film shoot. Probably.',
    rumor: 'Smugglers ran the inlet near {place}. One cargo never arrived.',
  },
  {
    type: 'octopus', name: "Giant Pacific Octopus Den", category: 'natural', points: 200, count: 2, depth: [6, 24], mat: Mat.Rock,
    build: M.buildOctopusDen, zones: ['Tacoma Narrows', 'Alki Point', 'Fox Island'], zoneRadius: 400,
    blurb: 'A rock pile with a resident. Giant Pacific octopuses in the sound can span more than four metres.',
    rumor: 'Divers off {place} report a very large octopus.',
  },
  {
    type: 'mug', name: "World's Largest Latte", category: 'oddity', points: 250, count: 1, depth: [5, 22], mat: Mat.Stone,
    build: M.buildGiantMug, zones: ['Elliott Bay', 'Alki Point', 'Shilshole Bay'], zoneRadius: 600,
    blurb: 'A promotional stunt in 1998 went badly. The mug was never recovered. The latte is cold.',
    rumor: 'A giant coffee mug fell off a parade barge near {place}.',
  },
  {
    type: 'sos', name: 'SOS in Stones', category: 'oddity', points: 300, count: 1, depth: [4, 20], mat: Mat.Stone,
    build: M.buildSOS, zones: ['Colvos Passage', 'Vashon Island', 'Quartermaster Harbor'], zoneRadius: 600,
    blurb: 'Somebody spelled SOS in boulders on the bottom. On the sonar record it reads clearly. Who was it for?',
    rumor: 'Fishermen near {place} say the sonar spells out a word.',
  },
  {
    type: 'footprints', name: 'Sasquatch Tracks', category: 'legend', points: 350, count: 1, depth: [3, 16], mat: Mat.Mud,
    build: M.buildFootprints, carve: { fn: M.footprintCarve, hw: 20, hd: 6 },
    zones: ['Carr Inlet', 'Case Inlet', 'Totten Inlet', 'Eld Inlet'], zoneRadius: 500,
    blurb: 'Twelve prints, each over two metres long, walking straight into deep water. Good luck explaining this one.',
    rumor: 'Something big walked into the water near {place}. The tracks are still down there.',
  },
  {
    type: 'serpent', name: 'Sea Serpent Skeleton', category: 'legend', points: 500, count: 1, depth: [8, 32], mat: Mat.Stone,
    build: M.buildSerpent, zones: ['Hood Canal', 'Great Bend', 'Hoodsport', 'Lynch Cove'], zoneRadius: 700,
    blurb: 'Forty metres of vertebrae and a long-jawed skull. Cadborosaurus sightings go back a century in these waters.',
    rumor: 'Hood Canal locals swear something long lives in the deep water near {place}.',
  },
  {
    type: 'saucer', name: 'Flying Saucer', category: 'legend', points: 500, count: 1, depth: [8, 32], mat: Mat.Metal,
    build: M.buildSaucer, zones: ['Saratoga Passage', 'Port Susan', 'Holmes Harbor'], zoneRadius: 700,
    blurb: 'A 14-metre disc, lights still on. The 1947 Maury Island incident was just the start.',
    rumor: 'Lights went into the water near {place} one summer night.',
  },
];

export interface Target {
  id: string;
  def: FeatureDef;
  x: number;
  z: number;
  baseY: number;
  yaw: number;
  radius: number;
  object: THREE.Group;
  zoneName?: string;
  discovered: boolean;
  buoy?: THREE.Group;
}

export interface Plume {
  x: number;
  z: number;
  y0: number;
}

export class Features {
  readonly root = new THREE.Group();
  readonly targets: Target[] = [];
  readonly plumes: Plume[] = [];
  private bubbles: THREE.Points | null = null;
  private bubbleData: Float32Array | null = null;

  constructor(private terrain: Terrain, private places: Places, private spawn: { x: number; z: number }) {}

  generate(): void {
    const seed = this.terrain.seed;
    const rng = mulberry32(seed ^ 0xfea7);
    const map = this.terrain.map;
    for (const def of CATALOG) {
      for (let i = 0; i < def.count; i++) {
        const id = `${def.type}-${i}`;
        const zone = def.zones ? def.zones[i % def.zones.length] : undefined;
        const zp = zone ? this.places.byName(zone) : undefined;
        let placed = false;
        for (let attempt = 0; attempt < 600 && !placed; attempt++) {
          let x: number;
          let z: number;
          const widen = attempt > 300 ? 2 : 1;
          if (zp) {
            const a = rng() * Math.PI * 2;
            const r = Math.sqrt(rng()) * (def.zoneRadius ?? 500) * widen;
            x = zp.x + Math.cos(a) * r;
            z = zp.z + Math.sin(a) * r;
          } else {
            x = 200 + rng() * (map.width - 400);
            z = 200 + rng() * (map.height - 400);
          }
          if (!map.inBounds(x, z, 100)) continue;
          if (!this.siteOk(x, z, def)) continue;
          this.place(def, id, x, z, rng() * Math.PI * 2, zone);
          placed = true;
        }
      }
    }
  }

  private siteOk(x: number, z: number, def: FeatureDef): boolean {
    const h = this.terrain.naturalHeight(x, z);
    const d = -h;
    if (d < def.depth[0] || d > def.depth[1]) return false;
    const r = 10;
    for (const [dx, dz] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      const hh = this.terrain.naturalHeight(x + dx, z + dz);
      if (Math.abs(hh - h) > 2.2 || hh > -2) return false;
    }
    const sd = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    if (sd < 140) return false;
    for (const t of this.targets) if (Math.hypot(t.x - x, t.z - z) < 150) return false;
    return true;
  }

  private place(def: FeatureDef, id: string, x: number, z: number, yaw: number, zone?: string) {
    const objSeed = hashString(id) ^ this.terrain.seed;
    const group = def.build(objSeed);
    // Seat slightly into the seabed: lowest of a few samples around the centre.
    let baseY = this.terrain.naturalHeight(x, z);
    for (const [dx, dz] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ])
      baseY = Math.min(baseY, this.terrain.naturalHeight(x + dx, z + dz));
    baseY -= 0.15;

    let obj: SeabedObject;
    if (def.carve) {
      obj = bakeAnalytic(id, def.carve.fn, def.carve.hw, def.carve.hd, def.mat);
    } else {
      obj = bakeHeightmap(id, group, def.mat);
    }
    obj.x = x;
    obj.z = z;
    obj.baseY = baseY;
    obj.yaw = yaw;
    obj.cos = Math.cos(yaw);
    obj.sin = Math.sin(yaw);
    this.terrain.addObject(obj);

    group.position.set(x, def.carve ? this.terrain.naturalHeight(x, z) : baseY, z);
    group.rotation.y = yaw;
    group.updateMatrixWorld(true);
    group.name = id;
    if (def.carve) group.visible = true;
    this.root.add(group);

    const t: Target = {
      id,
      def,
      x,
      z,
      baseY,
      yaw,
      radius: Math.hypot(obj.hw, obj.hd) * 0.75,
      object: group,
      zoneName: zone,
      discovered: false,
    };
    this.targets.push(t);
    if (def.plume) this.plumes.push({ x, z, y0: baseY - 0.8 });
  }

  /** Bubble particles for seep plumes. */
  buildBubbles() {
    const per = 40;
    const n = this.plumes.length * per;
    if (!n) return;
    const pos = new Float32Array(n * 3);
    this.bubbleData = new Float32Array(n * 2);
    const rng = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const p = this.plumes[Math.floor(i / per)];
      this.bubbleData[i * 2] = rng();
      this.bubbleData[i * 2 + 1] = rng();
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y0;
      pos[i * 3 + 2] = p.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xe8fbff, size: 0.35, transparent: true, opacity: 0.75, depthWrite: false });
    this.bubbles = new THREE.Points(geo, mat);
    this.bubbles.frustumCulled = false;
    this.root.add(this.bubbles);
  }

  update(time: number) {
    if (!this.bubbles || !this.bubbleData) return;
    const per = 40;
    const pos = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const p = this.plumes[Math.floor(i / per)];
      const ph = this.bubbleData[i * 2];
      const r = this.bubbleData[i * 2 + 1];
      const h = -p.y0;
      const t = (time * (0.08 + r * 0.05) + ph) % 1;
      const y = p.y0 + t * h;
      pos.setXYZ(i, p.x + Math.sin(time * 2 + ph * 20) * 0.4 * t + (r - 0.5) * 1.2, Math.min(y, -0.1), p.z + Math.cos(time * 1.7 + r * 20) * 0.4 * t);
    }
    pos.needsUpdate = true;
    for (const t of this.targets) if (t.buoy) t.buoy.position.y = Math.sin(time * 1.3 + t.x) * 0.12;
  }

  markDiscovered(t: Target) {
    t.discovered = true;
    if (!t.buoy) {
      const b = M.buildBuoy();
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);
      g.add(b);
      t.buoy = b;
      this.root.add(g);
    }
  }

  totalPoints(): number {
    return this.targets.reduce((s, t) => s + t.def.points, 0);
  }
}

// ----------------------------------------------------------------- heightmap baking

const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

function bakeHeightmap(id: string, group: THREE.Group, mat: Mat): SeabedObject {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const hw = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) + 0.3;
  const hd = Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) + 0.3;
  const ext = Math.max(hw, hd) * 2;
  const res = Math.min(0.6, Math.max(0.15, ext / 90));
  const nx = Math.ceil((hw * 2) / res);
  const nz = Math.ceil((hd * 2) / res);
  const heights = new Float32Array(nx * nz);
  const top = box.max.y + 1;
  const meshes: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  const origin = new THREE.Vector3();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      origin.set(-hw + (i + 0.5) * res, top, -hd + (j + 0.5) * res);
      ray.set(origin, down);
      ray.far = top - box.min.y + 2;
      const hit = ray.intersectObjects(meshes, false);
      heights[j * nx + i] = hit.length ? Math.max(0, hit[0].point.y) : NaN;
    }
  }
  return { id, x: 0, z: 0, baseY: 0, yaw: 0, cos: 1, sin: 0, hw, hd, res, nx, nz, heights, mode: 'add', mat };
}

function bakeAnalytic(id: string, fn: (lx: number, lz: number) => number, hw: number, hd: number, mat: Mat): SeabedObject {
  const res = 0.25;
  const nx = Math.ceil((hw * 2) / res);
  const nz = Math.ceil((hd * 2) / res);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) heights[j * nx + i] = fn(-hw + (i + 0.5) * res, -hd + (j + 0.5) * res);
  return { id, x: 0, z: 0, baseY: 0, yaw: 0, cos: 1, sin: 0, hw, hd, res, nx, nz, heights, mode: 'carve', mat };
}
