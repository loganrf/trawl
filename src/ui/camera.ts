// Third-person camera that trails the boat. Drag to orbit, wheel to zoom,
// double-click to reset.

import * as THREE from 'three';
import type { Boat } from '../vessel/boat';
import type { Terrain } from '../world/terrain';

export class CameraRig {
  yawOffset = 0;
  pitch = 0.4;
  dist = 38;
  private camHeading = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private target = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yawOffset -= (e.clientX - this.lastX) * 0.006;
      this.pitch = Math.min(1.45, Math.max(0.08, this.pitch + (e.clientY - this.lastY) * 0.005));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = () => (this.dragging = false);
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.dist = Math.min(260, Math.max(10, this.dist * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: false },
    );
    dom.addEventListener('dblclick', () => {
      this.yawOffset = 0;
      this.pitch = 0.4;
      this.dist = 38;
    });
  }

  snap(boat: Boat) {
    this.camHeading = boat.heading;
  }

  update(dt: number, boat: Boat, terrain: Terrain) {
    let d = boat.heading - this.camHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camHeading += d * (1 - Math.exp(-dt / 0.7));
    const h = this.camHeading + this.yawOffset;
    this.target.set(boat.x, 1.5, boat.z);
    const cp = Math.cos(this.pitch);
    const cam = this.camera.position;
    cam.set(
      this.target.x - Math.sin(h) * this.dist * cp,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(h) * this.dist * cp,
    );
    const ground = terrain.naturalHeight(cam.x, cam.z, 1);
    cam.y = Math.max(cam.y, Math.max(0, ground) + 2.5);
    this.camera.lookAt(this.target);
  }
}
