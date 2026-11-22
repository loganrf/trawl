// Charts: a base chart of the sound, a coverage layer painted by each sonar ping, the
// corner minimap and the full-screen chart.

import { H_SCALE, SONAR_BINS, realToGameDepth } from '../config';
import type { BaseMap } from '../world/bathymetry';
import type { Places } from '../world/places';
import type { Target } from '../world/features';
import type { PingRow } from '../sonar/sidescan';

const BASE_RES = 12.5; // game m per pixel of the base chart
const COV_RES = 5; // game m per pixel of the coverage layer

export class Charts {
  readonly base: HTMLCanvasElement;
  readonly coverage: HTMLCanvasElement;
  private cctx: CanvasRenderingContext2D;
  private prevSwath: { px: number; pz: number; sx: number; sz: number; index: number } | null = null;
  /** Surveyed line length in game metres. */
  lineLength = 0;

  constructor(private map: BaseMap, private places: Places) {
    this.base = document.createElement('canvas');
    this.base.width = Math.ceil(map.width / BASE_RES);
    this.base.height = Math.ceil(map.height / BASE_RES);
    this.renderBase();
    this.coverage = document.createElement('canvas');
    this.coverage.width = Math.ceil(map.width / COV_RES);
    this.coverage.height = Math.ceil(map.height / COV_RES);
    this.cctx = this.coverage.getContext('2d')!;
  }

  private renderBase() {
    const w = this.base.width;
    const h = this.base.height;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const sig = new Float32Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) sig[j * w + i] = this.map.signedBilinear((i + 0.5) * BASE_RES, (j + 0.5) * BASE_RES);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const s = sig[j * w + i];
        const o = (j * w + i) * 4;
        if (s > 0) {
          const d = realToGameDepth(s);
          const t = Math.min(1, d / 30);
          // Chart style: pale shallows to deeper blue, with 5 m contour lines.
          let r = 200 - 150 * t;
          let g = 228 - 120 * t;
          let b = 226 - 60 * t;
          const sR = sig[j * w + Math.min(w - 1, i + 1)];
          const sD = sig[Math.min(h - 1, j + 1) * w + i];
          const c0 = Math.floor(d / 5);
          if (sR > 0 && Math.floor(realToGameDepth(sR) / 5) !== c0) [r, g, b] = [r * 0.75, g * 0.8, b * 0.85];
          else if (sD > 0 && Math.floor(realToGameDepth(sD) / 5) !== c0) [r, g, b] = [r * 0.75, g * 0.8, b * 0.85];
          img.data.set([r, g, b, 255], o);
        } else {
          const dist = -s / this.map.landK / H_SCALE;
          const sR = sig[j * w + Math.min(w - 1, i + 1)];
          const sD = sig[Math.min(h - 1, j + 1) * w + i];
          const t = Math.min(1, dist / 300);
          const coast = sR > 0 || sD > 0;
          let r = 236 - 22 * t;
          let g = 224 - 16 * t;
          let b = 186 - 22 * t;
          if (coast) [r, g, b] = [90, 80, 60];
          img.data.set([r, g, b, 255], o);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Paint the swath of a ping onto the coverage layer. */
  addPing(row: PingRow) {
    if (row.y > -0.25) {
      this.prevSwath = null;
      return;
    }
    // Swath edges: farthest bins with data on each side.
    const N = SONAR_BINS;
    let gp = 0;
    let gs = 0;
    for (let i = 0; i < N; i++) {
      const g = row.ground[i];
      if (!Number.isNaN(g)) gp = Math.max(gp, g);
    }
    for (let i = N; i < 2 * N; i++) {
      const g = row.ground[i];
      if (!Number.isNaN(g)) gs = Math.max(gs, g);
    }
    const fx = Math.sin(row.heading);
    const fz = -Math.cos(row.heading);
    const sx = -fz;
    const sz = fx;
    const cur = {
      px: row.x - sx * gp,
      pz: row.z - sz * gp,
      sx: row.x + sx * gs,
      sz: row.z + sz * gs,
      index: row.index,
    };
    const p = this.prevSwath;
    if (p && row.index - p.index < 8 && (gp > 0 || gs > 0)) {
      const moved = Math.hypot(cur.px + cur.sx - p.px - p.sx, cur.pz + cur.sz - p.pz - p.sz) / 2;
      if (moved < 30) {
        this.lineLength += moved;
        const c = this.cctx;
        c.fillStyle = '#ff8a1f';
        c.beginPath();
        c.moveTo(p.px / COV_RES, p.pz / COV_RES);
        c.lineTo(p.sx / COV_RES, p.sz / COV_RES);
        c.lineTo(cur.sx / COV_RES, cur.sz / COV_RES);
        c.lineTo(cur.px / COV_RES, cur.pz / COV_RES);
        c.closePath();
        c.fill();
      }
    }
    this.prevSwath = cur;
  }

  coverageDataUrl(): string {
    return this.coverage.toDataURL('image/png');
  }

  loadCoverage(url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.cctx.drawImage(img, 0, 0);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  clearCoverage() {
    this.cctx.clearRect(0, 0, this.coverage.width, this.coverage.height);
    this.lineLength = 0;
  }

  /**
   * Draw a north-up view centred at (cx, cz). scale = game metres per screen pixel.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cx: number,
    cz: number,
    scale: number,
    opts: {
      boat?: { x: number; z: number; heading: number };
      fish?: { x: number; z: number };
      targets?: Target[];
      labels?: boolean;
      dpr?: number;
    },
  ) {
    const dpr = opts.dpr ?? 1;
    ctx.save();
    ctx.fillStyle = '#d8ccaa';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    const toX = (x: number) => w / 2 + (x - cx) / scale;
    const toY = (z: number) => h / 2 + (z - cz) / scale;
    ctx.drawImage(this.base, toX(0), toY(0), this.map.width / scale, this.map.height / scale);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this.coverage, toX(0), toY(0), (this.coverage.width * COV_RES) / scale, (this.coverage.height * COV_RES) / scale);
    ctx.globalAlpha = 1;

    if (opts.labels) {
      ctx.font = `italic ${11 * dpr}px Georgia, 'Iowan Old Style', serif`;
      ctx.fillStyle = 'rgba(40,52,60,0.9)';
      ctx.textAlign = 'center';
      for (const p of this.places.list) {
        const x = toX(p.x);
        const y = toY(p.z);
        if (x < -40 || y < -10 || x > w + 40 || y > h + 10) continue;
        ctx.fillText(p.name, x, y);
      }
    }

    if (opts.targets) {
      for (const t of opts.targets) {
        if (!t.discovered) continue;
        const x = toX(t.x);
        const y = toY(t.z);
        ctx.fillStyle = '#f2b134';
        ctx.strokeStyle = '#5a2d10';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (opts.fish) {
      ctx.fillStyle = '#f2c21b';
      ctx.beginPath();
      ctx.arc(toX(opts.fish.x), toY(opts.fish.z), 2.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (opts.boat) {
      const b = opts.boat;
      ctx.translate(toX(b.x), toY(b.z));
      ctx.rotate(b.heading);
      ctx.fillStyle = '#c23b22';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, -9 * dpr);
      ctx.lineTo(6 * dpr, 7 * dpr);
      ctx.lineTo(0, 4 * dpr);
      ctx.lineTo(-6 * dpr, 7 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
