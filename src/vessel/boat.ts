// Survey launch: model, handling and grounding.
// Heading psi is clockwise from north (-z). Forward = (sin psi, 0, -cos psi).

import * as THREE from 'three';
import { BOAT_DRAFT, BOAT_MAX_SPEED } from '../config';
import type { Terrain } from '../world/terrain';
import { hullGeometry } from '../world/models';
import { applyUnderwater } from '../world/materials';
import { waveHeight } from '../world/water';
import type { Input } from '../ui/input';

export interface BoatEvents {
  onGround?: (impact: number) => void;
  onBoundary?: () => void;
}

export class Boat {
  readonly group = new THREE.Group();
  private model = new THREE.Group();
  x: number;
  z: number;
  heading: number;
  /** Speed through the water, m/s (negative = astern). */
  speed = 0;
  yawRate = 0;
  throttle = 0;
  rudder = 0;
  hull = 100;
  /** World position of the towing block at the top of the A-frame. */
  readonly towPoint = new THREE.Vector3();
  private groundCooldown = 0;
  private roll = 0;
  private pitch = 0;

  constructor(private terrain: Terrain, x: number, z: number, heading: number, private events: BoatEvents = {}) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.buildModel();
    this.group.add(this.model);
    this.updateTransform(0);
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  private buildModel() {
    const m = this.model;
    const mat = (hex: number) => applyUnderwater(new THREE.MeshLambertMaterial({ color: hex, flatShading: true }), { noCaustics: true });
    const hullGeo = hullGeometry(9, 3.2, 1.55, { transom: 0.85, bowRake: 0.6 });
    // Antifouling red below the boot stripe, white above.
    const pos = hullGeo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const red = new THREE.Color(0x9b2f22);
    const white = new THREE.Color(0xf0ece2);
    const stripe = new THREE.Color(0x1f3a56);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) - 0.78;
      const c = y < 0.02 ? red : y < 0.22 ? stripe : white;
      col.set([c.r, c.g, c.b], i * 3);
    }
    hullGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const hullMat = applyUnderwater(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { noCaustics: true });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.rotation.y = Math.PI / 2; // bow to -z
    hull.position.y = -0.78;
    m.add(hull);

    const add = (geo: THREE.BufferGeometry, hex: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, mat(hex));
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      m.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(2.9, 0.12, 7.8), 0x8f9496, 0, 0.62, 0.3); // deck
    add(new THREE.BoxGeometry(2.3, 1.55, 3.0), 0xf3f1ea, 0, 1.45, -0.9); // cabin
    add(new THREE.BoxGeometry(2.36, 0.55, 3.06), 0x1d2d36, 0, 1.78, -0.9); // window band
    add(new THREE.BoxGeometry(2.6, 0.14, 3.5), 0xe2772d, 0, 2.3, -0.8); // roof
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 5), 0xdddddd, 0, 3.1, -0.6); // mast
    add(new THREE.BoxGeometry(1.4, 0.12, 0.2), 0xdddddd, 0, 3.4, -0.6); // radar bar
    add(new THREE.SphereGeometry(0.16, 8, 6), 0xffffff, 0.55, 3.55, -0.6); // GNSS
    add(new THREE.SphereGeometry(0.16, 8, 6), 0xffffff, -0.55, 3.55, -0.6);
    add(new THREE.BoxGeometry(0.9, 0.12, 0.18), 0x333333, 0, 3.92, -0.6); // radar
    add(new THREE.TorusGeometry(0.32, 0.08, 5, 10), 0xe2772d, 1.19, 1.4, -0.4, 0, Math.PI / 2, 0); // life ring
    // A-frame at the stern.
    add(new THREE.BoxGeometry(0.16, 2.5, 0.16), 0xe2772d, 1.25, 1.85, 3.95, 0, 0, 0.1);
    add(new THREE.BoxGeometry(0.16, 2.5, 0.16), 0xe2772d, -1.25, 1.85, 3.95, 0, 0, -0.1);
    add(new THREE.BoxGeometry(2.7, 0.16, 0.16), 0xe2772d, 0, 3.08, 3.95);
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), 0x333333, 0, 2.9, 4.05, Math.PI / 2, 0, 0); // block
    // Winch.
    add(new THREE.CylinderGeometry(0.38, 0.38, 1.0, 10), 0x3d5a6c, 0, 0.98, 2.4, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(1.3, 0.25, 0.7), 0x2d3a42, 0, 0.75, 2.4);
    // Rails.
    for (const s of [1, -1]) {
      add(new THREE.BoxGeometry(0.05, 0.05, 6.4), 0xcccccc, s * 1.45, 1.25, 0.6);
      for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.04, 0.6, 0.04), 0xcccccc, s * 1.45, 0.95, -2.2 + k * 1.5);
    }
    // Bow light and stern lights.
    add(new THREE.BoxGeometry(0.15, 0.15, 0.15), 0xff5544, -1.2, 2.4, -2.4);
    add(new THREE.BoxGeometry(0.15, 0.15, 0.15), 0x44ff77, 1.2, 2.4, -2.4);
  }

  update(dt: number, input: Input, time: number) {
    // Controls.
    const up = input.down('KeyW') || input.down('ArrowUp');
    const dn = input.down('KeyS') || input.down('ArrowDown');
    if (up) this.throttle = Math.min(1, this.throttle + dt * 0.45);
    if (dn) this.throttle = Math.max(-0.4, this.throttle - dt * 0.45);
    if (input.pressed('KeyX')) this.throttle = 0;
    // Snap through zero so stopping is easy.
    if (!up && !dn && Math.abs(this.throttle) < 0.03) this.throttle = 0;
    const left = input.down('KeyA') || input.down('ArrowLeft');
    const right = input.down('KeyD') || input.down('ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 2.5 : 1.8;
    this.rudder += Math.sign(target - this.rudder) * Math.min(Math.abs(target - this.rudder), rate * dt);

    // Speed.
    const vmax = BOAT_MAX_SPEED;
    const thrust = this.throttle >= 0 ? this.throttle * vmax * vmax : this.throttle * vmax * vmax * 0.5;
    const acc = 0.032 * (thrust - this.speed * Math.abs(this.speed)) - 0.04 * this.speed;
    this.speed += acc * dt;

    // Turning: needs flow over the rudder; prop wash gives a little at low speed.
    const flow = Math.max(Math.abs(this.speed) / 3, Math.abs(this.throttle) * 0.35, 0.05);
    const yawTarget = this.rudder * 0.32 * Math.min(1, flow) * (this.speed < -0.05 ? -1 : 1);
    this.yawRate += (yawTarget - this.yawRate) * (1 - Math.exp(-dt / 0.55));
    this.heading += this.yawRate * dt;
    this.heading = (this.heading + Math.PI * 4) % (Math.PI * 2);

    // Move with grounding checks.
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const nx = this.x + fx * this.speed * dt;
    const nz = this.z + fz * this.speed * dt;
    this.groundCooldown -= dt;
    const map = this.terrain.map;
    if (!map.inBounds(nx, nz, 30)) {
      this.speed *= -0.3;
      this.events.onBoundary?.();
    } else if (this.hullTouches(nx, nz)) {
      const impact = Math.abs(this.speed);
      this.speed *= -0.25;
      this.throttle *= 0.5;
      if (this.groundCooldown <= 0 && impact > 0.4) {
        this.groundCooldown = 1.5;
        this.hull = Math.max(0, this.hull - Math.min(30, impact * 6));
        this.events.onGround?.(impact);
      }
    } else {
      this.x = nx;
      this.z = nz;
    }
    this.updateTransform(time);
  }

  /** True if any hull probe point is in water shallower than the draft. */
  private hullTouches(x: number, z: number): boolean {
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const probes: [number, number][] = [
      [4.3, 0],
      [-4.2, 0],
      [0.5, 1.5],
      [0.5, -1.5],
      [-3, 1.4],
      [-3, -1.4],
    ];
    for (const [f, s] of probes) {
      const px = x + fx * f + -fz * s;
      const pz = z + fz * f + fx * s;
      if (this.terrain.fullHeight(px, pz) > -BOAT_DRAFT) return true;
    }
    return false;
  }

  private updateTransform(time: number) {
    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const w0 = waveHeight(this.x, this.z, time);
    const wf = waveHeight(this.x + fx * 3.5, this.z + fz * 3.5, time);
    const wa = waveHeight(this.x - fx * 3.5, this.z - fz * 3.5, time);
    const ws = waveHeight(this.x - fz * 1.4, this.z + fx * 1.4, time);
    const wp = waveHeight(this.x + fz * 1.4, this.z - fx * 1.4, time);
    const pitchT = Math.atan2(wf - wa, 7) * 2.5 + Math.min(0.06, Math.max(0, this.speed) * 0.011);
    const rollT = Math.atan2(ws - wp, 2.8) * 2.0 - this.yawRate * this.speed * 0.12;
    this.pitch += (pitchT - this.pitch) * 0.1;
    this.roll += (rollT - this.roll) * 0.1;
    this.group.position.set(this.x, w0 + Math.max(0, this.speed) * 0.015, this.z);
    this.group.rotation.set(0, 0, 0);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = -this.heading;
    this.group.rotation.x = this.pitch;
    this.group.rotation.z = this.roll;
    this.group.updateMatrixWorld(true);
    this.towPoint.set(0, 2.9, 4.05).applyMatrix4(this.group.matrixWorld);
  }

  reset(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.throttle = 0;
    this.yawRate = 0;
    this.hull = 100;
  }
}
