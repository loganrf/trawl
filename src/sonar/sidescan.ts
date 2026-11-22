// Side-scan sonar simulation.
//
// For each ping and each side, the model marches outward along the across-track line
// on the seabed. Each ground sample gets a slant range from the transducer, a
// visibility test against everything closer (acoustic shadow), a Lambertian
// backscatter from the local slope and material, and a vertical beam pattern. The
// samples are summed into slant-range bins. This gives the real artefacts of a
// side-scan record: the dark water column before first return, bright faces towards
// the fish, shadows behind targets and along-track squash at high speed.

import { SONAR_BINS, SONAR_HISTORY } from '../config';
import { hash2 } from '../world/noise';
import { Mat, MAT_GRAIN, MAT_REFLECTIVITY, type TerrainSample } from '../world/terrain';
import type { Instrument, SonarContext } from './instrument';

export type Band = 'HF' | 'LF';

export interface PingRow {
  index: number;
  time: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  altitude: number;
  range: number;
  /** Intensities, 2N bins. [0] = far port ... [N-1] = port nadir, [N] = stbd nadir ... [2N-1] = far stbd. */
  data: Float32Array;
  /** Ground range (m) of the energy in each bin; NaN where nothing came back. */
  ground: Float32Array;
  fix: number;
}

export const RANGES = [25, 50, 75, 100, 150];

export class SideScan implements Instrument {
  readonly id = 'sidescan';
  readonly name = 'SS-900 Dual-Frequency Side-Scan';
  enabled = true;
  range = 50;
  band: Band = 'HF';
  /** Ring buffer of recent pings. */
  readonly rows: (PingRow | null)[] = new Array(SONAR_HISTORY).fill(null);
  pingCount = 0;
  onPing: ((row: PingRow) => void) | null = null;
  status = 'OK';

  private acc = 0;
  private prev = { x: 0, y: 0, z: 0, heading: 0, t: 0, valid: false };
  private sample: TerrainSample = { h: 0, mat: Mat.Mud, depth: 0, current: 0 };
  private sum = new Float32Array(SONAR_BINS);
  private cnt = new Float32Array(SONAR_BINS);
  private gsum = new Float32Array(SONAR_BINS);
  private seed = 1;
  private lastFixTime = 0;
  fixCount = 0;
  strikeFlash = 0;

  get maxRange(): number {
    return this.band === 'HF' ? 75 : 150;
  }

  get pingRate(): number {
    // Two-way travel time limits the rate: c / 2R, with c = 1500 m/s.
    return Math.min(30, 750 / this.range);
  }

  setRange(r: number) {
    this.range = Math.min(r, this.maxRange);
  }

  setBand(b: Band) {
    this.band = b;
    this.range = Math.min(this.range, this.maxRange);
  }

  rowAt(index: number): PingRow | null {
    if (index < 0 || index >= this.pingCount || this.pingCount - index > SONAR_HISTORY) return null;
    return this.rows[index % SONAR_HISTORY];
  }

  update(dt: number, ctx: SonarContext): void {
    const f = ctx.fish;
    const cur = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: f.heading, t: ctx.time, valid: true };
    if (!this.prev.valid) Object.assign(this.prev, cur);
    if (!this.enabled) {
      Object.assign(this.prev, cur);
      this.status = 'STANDBY';
      return;
    }
    this.acc += dt;
    const period = 1 / this.pingRate;
    let n = 0;
    while (this.acc >= period && n < 6) {
      this.acc -= period;
      n++;
    }
    if (this.acc > period) this.acc = 0; // drop backlog after a stall
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      const pose = {
        x: this.prev.x + (cur.x - this.prev.x) * t,
        y: this.prev.y + (cur.y - this.prev.y) * t,
        z: this.prev.z + (cur.z - this.prev.z) * t,
        heading: this.prev.heading + Math.atan2(Math.sin(cur.heading - this.prev.heading), Math.cos(cur.heading - this.prev.heading)) * t,
        t: this.prev.t + (cur.t - this.prev.t) * t,
      };
      this.ping(pose, ctx);
    }
    Object.assign(this.prev, cur);
    this.strikeFlash = Math.max(0, this.strikeFlash - dt);
  }

  private rand(): number {
    // Fast LCG for speckle.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return ((this.seed >>> 8) & 0xffffff) / 0x1000000;
  }

  private ping(pose: { x: number; y: number; z: number; heading: number; t: number }, ctx: SonarContext) {
    const N = SONAR_BINS;
    const R = this.range;
    const data = new Float32Array(2 * N);
    const ground = new Float32Array(2 * N).fill(NaN);
    const terrain = ctx.terrain;
    const fy = pose.y;
    const wet = fy < -0.25;
    const fwdX = Math.sin(pose.heading);
    const fwdZ = -Math.cos(pose.heading);
    const stbX = -fwdZ;
    const stbZ = fwdX;
    const speed = Math.abs(ctx.boat.speed);
    const hf = this.band === 'HF';
    const atten = hf ? 1.1 : 0.45;
    const speckK = hf ? 4 : 2.5;
    let altitude = 0;

    if (wet) {
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? -1 : 1;
        this.sum.fill(0);
        this.cnt.fill(0);
        this.gsum.fill(0);
        const M = Math.round(N * 1.4);
        const dg = R / M;
        let maxA = -Infinity;
        let prevH = NaN;
        let along = 0;
        for (let k = 0; k < M; k++) {
          const g = (k + 0.5) * dg;
          const px = pose.x + sgn * stbX * g;
          const pz = pose.z + sgn * stbZ * g;
          const s = terrain.sampleFull(px, pz, this.sample);
          const h = s.h;
          const mat = s.mat;
          const dy = h - fy;
          const a = Math.atan2(dy, g);
          const visible = a >= maxA;
          if (a > maxA) maxA = a;
          const sAcross = Number.isNaN(prevH) ? 0 : (h - prevH) / dg;
          prevH = h;
          if (k === 0) altitude = -dy;
          if (!visible) continue;
          const r = Math.sqrt(g * g + dy * dy);
          if (r >= R) continue;
          if ((k & 1) === 0) along = (terrain.fullHeight(px + fwdX * 0.6, pz + fwdZ * 0.6) - h) / 0.6;
          const nLen = Math.sqrt(sAcross * sAcross + along * along + 1);
          let cosInc = (sAcross * g - dy) / (r * nLen);
          if (cosInc < 0.02) cosInc = 0.02;
          const grain = MAT_GRAIN[mat];
          const tex =
            1 +
            grain * (vnoise(px * 2.3, pz * 2.3) - 0.5) * 1.8 +
            0.4 * (vnoise(px * 0.22 + 31, pz * 0.22) - 0.5) +
            (mat === Mat.Gravel || mat === Mat.Stone ? grain * (hash2(Math.floor(px * 4), Math.floor(pz * 4), 5) - 0.5) : 0);
          let bs = MAT_REFLECTIVITY[mat] * Math.max(0.05, tex) * (0.05 + cosInc * cosInc);
          if ((mat === Mat.Metal || mat === Mat.Stone) && cosInc > 0.8) bs += (cosInc - 0.8) * 10 * MAT_REFLECTIVITY[mat];
          const dep = -a;
          const bp = 0.28 + 0.72 * Math.exp(-(((dep - 0.33) / 0.42) ** 2));
          const bin = Math.floor((r / R) * N);
          this.sum[bin] += bs * bp;
          this.cnt[bin] += 1;
          this.gsum[bin] += g;
        }

        // Gas plumes: bubbles in the water column near the ping plane.
        for (const p of ctx.plumes) {
          const rx = p.x - pose.x;
          const rz = p.z - pose.z;
          const al = rx * fwdX + rz * fwdZ;
          if (Math.abs(al) > 2.5) continue;
          const ac = (rx * stbX + rz * stbZ) * sgn;
          if (ac <= 0 || ac > R) continue;
          for (let y = p.y0; y < -0.4; y += 0.35) {
            if (this.rand() > 0.55) continue;
            const dy = y - fy;
            const r = Math.sqrt(ac * ac + dy * dy);
            if (r >= R) continue;
            const bin = Math.floor((r / R) * N);
            this.sum[bin] += 1.6 * this.rand() * (1 - Math.abs(al) / 2.5);
            this.cnt[bin] = Math.max(this.cnt[bin], 1);
          }
        }

        for (let b = 0; b < N; b++) {
          const r = ((b + 0.5) / N) * R;
          let v = 0;
          if (this.cnt[b] > 0) {
            v = this.sum[b] / Math.pow(this.cnt[b], 0.62);
            const gi = side === 0 ? N - 1 - b : N + b;
            ground[gi] = this.gsum[b] / this.cnt[b];
          }
          // Spreading and absorption loss (TVG in the display puts most of it back).
          v *= Math.exp(-atten * (r / R)) / (1 + 2.5 * (r / R) ** 2);
          // Speckle: gamma-distributed multiplicative noise.
          let sp = 0;
          for (let i = 0; i < speckK; i++) sp -= Math.log(this.rand() + 1e-6);
          v *= sp / speckK;
          v += 0.004 * this.rand();
          // Surface return.
          const rs = -fy;
          if (Math.abs(r - rs) < (R / N) * 1.5) v += 0.004 + 0.012 * this.rand();
          if (fy > -1.6) v += (1.6 + fy) * 0.12 * this.rand() * (this.rand() < 0.5 ? 1 : 0.2);
          // Aeration and engine noise at high speed.
          if (speed > 4.6) v += (speed - 4.6) * 0.035 * this.rand() * (this.rand() < 0.3 ? 3 : 1);
          const gi = side === 0 ? N - 1 - b : N + b;
          data[gi] = v;
        }
      }
      // LF: coarser resolution.
      if (!hf) {
        for (let i = 1; i < 2 * N - 1; i++) data[i] = 0.25 * data[i - 1] + 0.5 * data[i] + 0.25 * data[i + 1];
      }
      this.status = fy > -1.6 ? 'FISH SHALLOW' : speed > 4.6 ? 'NOISE: SPEED' : 'OK';
    } else {
      for (let i = 0; i < 2 * N; i++) data[i] = 0.002 * this.rand();
      this.status = 'FISH OUT OF WATER';
    }
    if (this.strikeFlash > 0) for (let i = 0; i < 2 * N; i++) data[i] += this.rand() * 1.5;

    let fix = 0;
    if (pose.t - this.lastFixTime >= 10) {
      this.lastFixTime = pose.t;
      fix = ++this.fixCount;
    }
    const row: PingRow = {
      index: this.pingCount,
      time: pose.t,
      x: pose.x,
      y: pose.y,
      z: pose.z,
      heading: pose.heading,
      altitude,
      range: R,
      data,
      ground,
      fix,
    };
    this.rows[this.pingCount % SONAR_HISTORY] = row;
    this.pingCount++;
    this.onPing?.(row);
  }

  /** World position for a bin of a row (null for water column / shadow without data). */
  binToWorld(row: PingRow, bin: number): { x: number; z: number; slant: number; side: number } | null {
    const N = SONAR_BINS;
    const side = bin < N ? -1 : 1;
    const b = side < 0 ? N - 1 - bin : bin - N;
    const slant = ((b + 0.5) / N) * row.range;
    let g = row.ground[bin];
    if (Number.isNaN(g)) {
      // Flat-bottom estimate for shadows.
      if (slant <= row.altitude) return null;
      g = Math.sqrt(slant * slant - row.altitude * row.altitude);
    }
    const fx = Math.sin(row.heading);
    const fz = -Math.cos(row.heading);
    return { x: row.x + side * -fz * g, z: row.z + side * fx * g, slant, side };
  }
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = x - ix;
  const tz = z - iz;
  const ux = tx * tx * (3 - 2 * tx);
  const uz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, 77);
  const b = hash2(ix + 1, iz, 77);
  const c = hash2(ix, iz + 1, 77);
  const d = hash2(ix + 1, iz + 1, 77);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}
