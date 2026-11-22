// Waterfall display for the side-scan: newest ping at the top, port on the left,
// starboard on the right. One ping row per screen pixel. Gain, TVG and palette apply
// at display time, so changing them re-renders the whole record.

import { SONAR_BINS } from '../config';
import type { PingRow, SideScan } from '../sonar/sidescan';

export interface Contact {
  rowIndex: number;
  bin: number;
  label: string;
  color: string;
}

type Stop = [number, number];
const PALETTES: Record<string, Stop[]> = {
  Sepia: [
    [0, 0x050302],
    [0.25, 0x3a230b],
    [0.55, 0xb07a2a],
    [0.8, 0xf0cf7a],
    [1, 0xfffbe8],
  ],
  Grey: [
    [0, 0x000000],
    [1, 0xffffff],
  ],
  Copper: [
    [0, 0x020101],
    [0.3, 0x4f200b],
    [0.65, 0xd06d32],
    [1, 0xffe2b8],
  ],
  Ocean: [
    [0, 0x00050c],
    [0.35, 0x0a3a66],
    [0.7, 0x45a9d8],
    [1, 0xeafcff],
  ],
  Inverted: [
    [0, 0xffffff],
    [1, 0x000000],
  ],
};

export const PALETTE_NAMES = Object.keys(PALETTES);

function buildLut(stops: Stop[]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let ch = 0; ch < 3; ch++) {
      const s = 16 - ch * 8;
      const a = (c0 >> s) & 255;
      const b = (c1 >> s) & 255;
      lut[i * 3 + ch] = Math.round(a + (b - a) * u);
    }
  }
  return lut;
}

export class Waterfall {
  readonly el: HTMLDivElement;
  private data: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private rowImg: ImageData;
  private lut: Uint8Array;
  private tvgCurve = new Float32Array(2 * SONAR_BINS);
  gain = 1.0;
  tvg = 1.4;
  palette = 'Sepia';
  contacts: Contact[] = [];
  private cursor: { x: number; y: number } | null = null;
  onPick: ((row: PingRow, bin: number) => void) | null = null;
  onHover: ((row: PingRow | null, bin: number) => void) | null = null;
  private dirty = true;

  constructor(private sonar: SideScan) {
    this.el = document.createElement('div');
    this.el.className = 'waterfall';
    this.data = document.createElement('canvas');
    this.data.className = 'wf-data';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'wf-overlay';
    this.el.append(this.data, this.overlay);
    this.ctx = this.data.getContext('2d', { willReadFrequently: false })!;
    this.octx = this.overlay.getContext('2d')!;
    this.data.width = 2 * SONAR_BINS;
    this.data.height = 400;
    this.rowImg = this.ctx.createImageData(2 * SONAR_BINS, 1);
    this.lut = buildLut(PALETTES[this.palette]);
    this.updateTvg();

    this.overlay.addEventListener('mousemove', (e) => {
      const r = this.overlay.getBoundingClientRect();
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.dirty = true;
      const hit = this.hitTest(this.cursor.x, this.cursor.y);
      this.onHover?.(hit?.row ?? null, hit?.bin ?? 0);
    });
    this.overlay.addEventListener('mouseleave', () => {
      this.cursor = null;
      this.dirty = true;
      this.onHover?.(null, 0);
    });
    this.overlay.addEventListener('click', (e) => {
      const r = this.overlay.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hit) this.onPick?.(hit.row, hit.bin);
    });
  }

  setPalette(name: string) {
    this.palette = name;
    this.lut = buildLut(PALETTES[name]);
    this.redraw();
  }

  setGain(g: number) {
    this.gain = g;
    this.redraw();
  }

  setTvg(t: number) {
    this.tvg = t;
    this.updateTvg();
    this.redraw();
  }

  private updateTvg() {
    const N = SONAR_BINS;
    for (let i = 0; i < 2 * N; i++) {
      const b = i < N ? N - 1 - i : i - N;
      const rf = (b + 0.5) / N;
      this.tvgCurve[i] = (1 + this.tvg * (2.5 * rf * rf + rf)) * 14;
    }
  }

  /** Match the canvas height to its box: one row per CSS pixel. */
  resize() {
    const h = Math.max(50, Math.floor(this.el.clientHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.data.height !== h) {
      this.data.height = h;
      this.redraw();
    }
    const ow = Math.floor(this.el.clientWidth * dpr);
    const oh = Math.floor(this.el.clientHeight * dpr);
    if (this.overlay.width !== ow || this.overlay.height !== oh) {
      this.overlay.width = ow;
      this.overlay.height = oh;
      this.dirty = true;
    }
  }

  private renderRow(row: PingRow) {
    const px = this.rowImg.data;
    const g = this.gain;
    const lut = this.lut;
    for (let i = 0; i < 2 * SONAR_BINS; i++) {
      const x = row.data[i] * g * this.tvgCurve[i];
      const d = 1 - Math.exp(-x);
      const k = Math.min(255, (d * 255) | 0) * 3;
      const o = i * 4;
      px[o] = lut[k];
      px[o + 1] = lut[k + 1];
      px[o + 2] = lut[k + 2];
      px[o + 3] = 255;
    }
  }

  private drawAnnotations(row: PingRow, y: number) {
    const ctx = this.ctx;
    if (row.fix) {
      ctx.fillStyle = 'rgba(255,90,60,0.85)';
      for (let x = 0; x < this.data.width; x += 6) ctx.fillRect(x, y, 3, 1);
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(255,120,90,0.95)';
      ctx.fillText(`FIX ${String(row.fix).padStart(3, '0')}`, 4, y + 11);
    }
  }

  private drawContact(c: Contact, y: number) {
    const ctx = this.ctx;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.ellipse(c.bin, y, 16, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.color;
    ctx.stroke();
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    const left = c.bin > SONAR_BINS;
    const tw = ctx.measureText(c.label).width;
    const tx = left ? c.bin - 22 - tw : c.bin + 22;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(c.label, tx, y + 4);
    ctx.fillStyle = c.color;
    ctx.fillText(c.label, tx, y + 4);
  }

  /** Append a new ping at the top. */
  push(row: PingRow) {
    const h = this.data.height;
    const w = this.data.width;
    this.ctx.drawImage(this.data, 0, 0, w, h - 1, 0, 1, w, h - 1);
    this.renderRow(row);
    this.ctx.putImageData(this.rowImg, 0, 0);
    this.drawAnnotations(row, 0);
  }

  addContact(c: Contact) {
    this.contacts.push(c);
    const y = this.sonar.pingCount - 1 - c.rowIndex;
    if (y >= 0 && y < this.data.height) this.drawContact(c, y);
  }

  redraw() {
    const h = this.data.height;
    const newest = this.sonar.pingCount - 1;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.data.width, h);
    for (let y = h - 1; y >= 0; y--) {
      const row = this.sonar.rowAt(newest - y);
      if (!row) continue;
      this.renderRow(row);
      this.ctx.putImageData(this.rowImg, 0, y);
    }
    for (let y = h - 1; y >= 0; y--) {
      const row = this.sonar.rowAt(newest - y);
      if (row) this.drawAnnotations(row, y);
    }
    for (const c of this.contacts) {
      const y = newest - c.rowIndex;
      if (y >= 0 && y < h) this.drawContact(c, y);
    }
    this.dirty = true;
  }

  private hitTest(cx: number, cy: number): { row: PingRow; bin: number } | null {
    const w = this.el.clientWidth;
    const bin = Math.floor((cx / w) * 2 * SONAR_BINS);
    const y = Math.floor(cy);
    const row = this.sonar.rowAt(this.sonar.pingCount - 1 - y);
    if (!row || bin < 0 || bin >= 2 * SONAR_BINS) return null;
    return { row, bin };
  }

  /** Scale bar and cursor. Called every frame; cheap when nothing changed. */
  drawOverlay(force = false) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    const ctx = this.octx;
    const W = this.overlay.width;
    const H = this.overlay.height;
    const dpr = W / Math.max(1, this.el.clientWidth);
    ctx.clearRect(0, 0, W, H);
    const R = this.sonar.range;
    const step = R <= 25 ? 5 : R <= 75 ? 10 : 25;
    ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    for (let r = step; r <= R + 0.01; r += step) {
      for (const s of [-1, 1]) {
        const x = W / 2 + (s * r * W) / (2 * R);
        ctx.strokeStyle = 'rgba(160,220,255,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 14 * dpr);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.fillStyle = 'rgba(190,230,255,0.85)';
        ctx.fillText(`${r}`, Math.min(W - 10 * dpr, Math.max(10 * dpr, x)), 11 * dpr);
      }
    }
    ctx.strokeStyle = 'rgba(255,200,120,0.35)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 14 * dpr);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.fillStyle = 'rgba(190,230,255,0.85)';
    ctx.textAlign = 'left';
    ctx.fillText('PORT', 4 * dpr, 24 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText('STBD', W - 4 * dpr, 24 * dpr);

    if (this.cursor) {
      const x = this.cursor.x * dpr;
      const y = this.cursor.y * dpr;
      ctx.strokeStyle = 'rgba(120,255,200,0.7)';
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(120,255,200,0.95)';
      ctx.strokeRect(x - 12 * dpr, y - 9 * dpr, 24 * dpr, 18 * dpr);
    }
  }

  markDirty() {
    this.dirty = true;
  }
}
