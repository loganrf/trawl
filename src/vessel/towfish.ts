// Towed side-scan fish on a cable from the A-frame. Cable length and boat speed set
// the depth. Too much cable at low speed puts the fish into the bottom.

import * as THREE from 'three';
import { CABLE_MAX, WINCH_RATE } from '../config';
import type { Terrain } from '../world/terrain';
import { applyUnderwater } from '../world/materials';
import type { Boat } from './boat';
import type { Input } from '../ui/input';

export interface TowfishEvents {
  onStrike?: (severity: number) => void;
  onLost?: () => void;
}

export class Towfish {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  heading = 0;
  cable = 18;
  altitude = 10;
  /** Seabed height under the fish. */
  seabed = -20;
  health = 100;
  /** Depression angle of the cable (rad). */
  angle = Math.PI / 2;
  private cableLine: THREE.Line;
  private cablePts: Float32Array;
  private strikeCooldown = 0;
  private pitch = 0;

  constructor(private terrain: Terrain, boat: Boat, private events: TowfishEvents = {}) {
    const mat = (hex: number) => applyUnderwater(new THREE.MeshLambertMaterial({ color: hex, flatShading: true }), { noCaustics: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 10), mat(0xf2c21b));
    body.rotation.x = Math.PI / 2;
    this.group.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 10), mat(0xf2c21b));
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.8;
    this.group.add(nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.38, 0.28), mat(0x23292d));
      fin.position.z = 0.55;
      fin.rotation.z = (i * Math.PI) / 2;
      fin.translateY(0.17);
      this.group.add(fin);
    }
    // Transducer strips on both sides.
    for (const s of [1, -1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.7), mat(0x1a1a1a));
      t.position.set(s * 0.11, -0.03, -0.1);
      this.group.add(t);
    }

    this.cablePts = new Float32Array(16 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.cablePts, 3));
    this.cableLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1b1b1b }));
    this.cableLine.frustumCulled = false;

    const f = boat.forward;
    this.pos.set(boat.towPoint.x - f.x * 4, -6, boat.towPoint.z - f.z * 4);
    this.heading = boat.heading;
  }

  get cableObject(): THREE.Line {
    return this.cableLine;
  }

  /** True when the fish is in the water and able to ping. */
  get wet(): boolean {
    return this.pos.y < -0.25;
  }

  update(dt: number, boat: Boat, input: Input) {
    if (input.down('KeyR')) this.cable = Math.min(CABLE_MAX, this.cable + WINCH_RATE * dt);
    if (input.down('KeyF')) this.cable = Math.max(0, this.cable - WINCH_RATE * dt);

    const tow = boat.towPoint;
    const v = Math.abs(boat.speed);
    // Weight versus hydrodynamic drag sets the cable angle.
    const targetAngle = Math.atan(1.0 / (0.12 * v * v + 0.06));
    this.angle += (targetAngle - this.angle) * (1 - Math.exp(-dt / 1.4));
    const drop = this.cable * Math.sin(this.angle);
    const layback = this.cable * Math.cos(this.angle);

    // Vertical: fish settles towards the cable-limited depth.
    const targetY = tow.y - drop;
    const yRate = targetY < this.pos.y ? 1.5 : 0.9;
    this.pos.y += (targetY - this.pos.y) * (1 - Math.exp(-dt / yRate));
    if (this.pos.y > tow.y - 0.5) this.pos.y = tow.y - 0.5;

    // Horizontal: rope constraint behind the tow point.
    let dx = this.pos.x - tow.x;
    let dz = this.pos.z - tow.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      const f = boat.forward;
      dx = -f.x;
      dz = -f.z;
      d = 1;
    }
    let nd = d;
    if (d > layback) nd = layback;
    else nd = d + (layback - d) * (1 - Math.exp(-dt / 1.5));
    this.pos.x = tow.x + (dx / d) * nd;
    this.pos.z = tow.z + (dz / d) * nd;

    // Heading: nose towards the tow point.
    if (d > 0.5) {
      const h = Math.atan2(-dx, dz); // direction from fish to tow point
      let diff = h - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-dt / 0.5));
    }

    // Bottom contact.
    this.seabed = this.terrain.fullHeight(this.pos.x, this.pos.z);
    this.altitude = this.pos.y - this.seabed;
    this.strikeCooldown -= dt;
    if (this.altitude < 0.35 && this.pos.y < 0) {
      this.pos.y = this.seabed + 0.35;
      this.altitude = 0.35;
      if (this.strikeCooldown <= 0) {
        // Dragging along the bottom at speed does real damage; settling onto it at rest does little.
        const sev = v < 0.6 ? 1 : 4 + v * 7;
        this.strikeCooldown = v < 0.6 ? 4 : 1.2;
        this.health = Math.max(0, this.health - sev);
        this.events.onStrike?.(sev);
        if (this.health <= 0) {
          this.events.onLost?.();
          this.health = 100;
          this.cable = 0;
        }
      }
    }

    // Transform.
    this.pitch += (Math.min(0.5, (targetY - this.pos.y) * 0.1) - this.pitch) * 0.1;
    this.group.position.copy(this.pos);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(this.pitch, -this.heading, 0);

    // Cable: quadratic curve with a little sag.
    const mid = new THREE.Vector3().addVectors(tow, this.pos).multiplyScalar(0.5);
    mid.y -= Math.min(3, this.cable * 0.06) * (1 - Math.min(1, v / 4));
    const n = this.cablePts.length / 3;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      this.cablePts[i * 3] = a * tow.x + b * mid.x + c * this.pos.x;
      this.cablePts[i * 3 + 1] = a * tow.y + b * mid.y + c * this.pos.y;
      this.cablePts[i * 3 + 2] = a * tow.z + b * mid.z + c * this.pos.z;
    }
    (this.cableLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Fish depth if the boat stopped now (cable hanging straight down). */
  get stoppedDepth(): number {
    return this.cable - 2.9;
  }
}
