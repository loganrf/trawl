// Puget Sound base map: a regular grid of signed values from SalishSeaCast bathymetry.
// Value > 0: real water depth (m). Value < 0: land, -(distance to water, m) * landK.
// Game coordinates: origin at the north-west corner, +x east, +z south.

import { H_SCALE } from '../config';
import meta from '../data/puget_sound.json';
import binUrl from '../data/puget_sound.bin?url';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export class BaseMap {
  readonly nx: number;
  readonly ny: number;
  /** Grid cell size in game metres. */
  readonly cell: number;
  /** World extent in game metres. */
  readonly width: number;
  readonly height: number;
  readonly landK: number;
  private data: Float32Array;

  private constructor(data: Float32Array) {
    this.nx = meta.nx;
    this.ny = meta.ny;
    this.cell = meta.cellM / H_SCALE;
    this.width = (this.nx - 1) * this.cell;
    this.height = (this.ny - 1) * this.cell;
    this.landK = meta.landK;
    this.data = data;
  }

  static async load(): Promise<BaseMap> {
    let buf: ArrayBuffer;
    if (binUrl.startsWith('data:')) {
      // Single-file build: the grid is inlined as base64.
      const b64 = binUrl.slice(binUrl.indexOf(',') + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      buf = bytes.buffer;
    } else {
      const res = await fetch(binUrl);
      if (!res.ok) throw new Error(`base map: HTTP ${res.status}`);
      buf = await res.arrayBuffer();
    }
    const raw = new Int16Array(buf);
    const data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] * meta.valueScale;
    return new BaseMap(data);
  }

  /** Raw grid value at integer cell (clamped). */
  cellValue(ix: number, iy: number): number {
    if (ix < 0) ix = 0;
    else if (ix >= this.nx) ix = this.nx - 1;
    if (iy < 0) iy = 0;
    else if (iy >= this.ny) iy = this.ny - 1;
    return this.data[iy * this.nx + ix];
  }

  /** Bicubic (Catmull-Rom) sample of the signed field at game position. */
  signedAt(x: number, z: number): number {
    const gx = x / this.cell;
    const gz = z / this.cell;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const tx = gx - ix;
    const tz = gz - iz;
    let result = 0;
    const wz0 = cr0(tz), wz1 = cr1(tz), wz2 = cr2(tz), wz3 = cr3(tz);
    const wx0 = cr0(tx), wx1 = cr1(tx), wx2 = cr2(tx), wx3 = cr3(tx);
    for (let j = -1; j <= 2; j++) {
      const row =
        this.cellValue(ix - 1, iz + j) * wx0 +
        this.cellValue(ix, iz + j) * wx1 +
        this.cellValue(ix + 1, iz + j) * wx2 +
        this.cellValue(ix + 2, iz + j) * wx3;
      result += row * (j === -1 ? wz0 : j === 0 ? wz1 : j === 1 ? wz2 : wz3);
    }
    return result;
  }

  /** Bilinear sample (cheaper, used for maps). */
  signedBilinear(x: number, z: number): number {
    const gx = x / this.cell;
    const gz = z / this.cell;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const tx = gx - ix;
    const tz = gz - iz;
    const a = this.cellValue(ix, iz);
    const b = this.cellValue(ix + 1, iz);
    const c = this.cellValue(ix, iz + 1);
    const d = this.cellValue(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  toGeo(x: number, z: number): GeoPoint {
    return {
      lat: meta.latMax - (z * H_SCALE) / meta.mPerDegLat,
      lon: meta.lonMin + (x * H_SCALE) / meta.mPerDegLon,
    };
  }

  fromGeo(lat: number, lon: number): { x: number; z: number } {
    return {
      x: ((lon - meta.lonMin) * meta.mPerDegLon) / H_SCALE,
      z: ((meta.latMax - lat) * meta.mPerDegLat) / H_SCALE,
    };
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return x >= margin && z >= margin && x <= this.width - margin && z <= this.height - margin;
  }
}

function cr0(t: number) {
  return ((-t + 2) * t - 1) * t * 0.5;
}
function cr1(t: number) {
  return ((3 * t - 5) * t * t + 2) * 0.5;
}
function cr2(t: number) {
  return ((-3 * t + 4) * t + 1) * t * 0.5;
}
function cr3(t: number) {
  return (t - 1) * t * t * 0.5;
}

export function formatLatLon(g: GeoPoint): string {
  const f = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${d}°${m.toFixed(3).padStart(6, '0')}'${v >= 0 ? pos : neg}`;
  };
  return `${f(g.lat, 'N', 'S')} ${f(g.lon, 'E', 'W')}`;
}
