// DOM user interface: helm HUD, sonar panel controls and readouts, toasts, survey
// log, chart and title screen.

import { KNOTS_PER_MS, H_SCALE } from '../config';
import { PALETTE_NAMES, Waterfall } from './waterfall';
import { RANGES, type SideScan } from '../sonar/sidescan';
import type { Boat } from '../vessel/boat';
import type { Towfish } from '../vessel/towfish';
import type { Target, Category } from '../world/features';
import type { Charts } from './chart';
import type { Places } from '../world/places';
import { formatLatLon, type BaseMap } from '../world/bathymetry';
import type { Terrain } from '../world/terrain';

const CAT_LABEL: Record<Category, string> = {
  natural: 'Natural features',
  debris: 'Debris',
  wreck: 'Wrecks',
  oddity: 'Oddities',
  legend: 'Legends',
};
const CAT_SINGULAR: Record<Category, string> = {
  natural: 'Natural feature',
  debris: 'Debris',
  wreck: 'Wreck',
  oddity: 'Oddity',
  legend: 'Legend',
};
const CAT_COLOR: Record<Category, string> = {
  natural: '#8fd18b',
  debris: '#c9c3b0',
  wreck: '#e2a04a',
  oddity: '#7fc8f8',
  legend: '#f27a9b',
};
export const categoryColor = (c: Category) => CAT_COLOR[c];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface HudDeps {
  game: HTMLElement;
  sonarPanel: HTMLElement;
  sonar: SideScan;
  waterfall: Waterfall;
  charts: Charts;
  places: Places;
  map: BaseMap;
  terrain: Terrain;
}

export class Hud {
  private score = el('div', 'hud-score');
  private loc = el('div', 'hud-loc');
  private helm = el('div', 'hud-helm');
  private toasts = el('div', 'toasts');
  private miniWrap = el('div', 'minimap');
  private mini = el('canvas');
  private miniScale = 3;
  private readouts: Record<string, HTMLElement> = {};
  private cursorLine = el('div', 'wf-cursor');
  private status = el('span', 'chip');
  private profile = el('canvas', 'tow-profile');
  private modal = el('div', 'modal hidden');
  private modalBody = el('div', 'modal-body');
  private modalKind = '';
  private chartCanvas = el('canvas', 'chart-canvas');
  private throttleFill = el('div', 'thr-fill');
  private rudderNeedle = el('div', 'rud-needle');
  private speedText = el('div', 'helm-speed');
  private hdgText = el('div', 'helm-hdg');
  private hullText = el('div', 'helm-hull');
  private rangeButtons: HTMLButtonElement[] = [];
  private bandButtons: HTMLButtonElement[] = [];
  private pingButton!: HTMLButtonElement;
  onModalChange: ((open: boolean) => void) | null = null;

  constructor(private d: HudDeps) {
    this.buildGameHud();
    this.buildSonarPanel();
    document.body.append(this.modal);
    this.modal.append(this.modalBody);
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
  }

  // ------------------------------------------------------------------ game view

  private buildGameHud() {
    const g = this.d.game;
    g.append(this.score, this.loc, this.toasts, this.helm, this.miniWrap);
    const hint = el(
      'div',
      'keys-hint',
      '<b>W/S</b> throttle · <b>A/D</b> steer · <b>X</b> stop · <b>R/F</b> cable out/in · <b>click the sonar record</b> to log a target · <b>M</b> chart · <b>L</b> log · <b>H</b> help',
    );
    g.append(hint);

    // Helm: throttle lever, rudder, speed, heading, hull.
    const thr = el('div', 'thr');
    thr.append(this.throttleFill, el('div', 'thr-zero'));
    const rud = el('div', 'rud');
    rud.append(this.rudderNeedle);
    const nums = el('div', 'helm-nums');
    nums.append(this.speedText, this.hdgText, this.hullText);
    const row = el('div', 'helm-row');
    row.append(thr, nums);
    this.helm.append(el('div', 'helm-title', 'HELM'), row, rud);

    this.mini.width = 220;
    this.mini.height = 220;
    const zin = el('button', 'mini-btn', '+');
    const zout = el('button', 'mini-btn', '−');
    zin.onclick = () => (this.miniScale = Math.max(0.75, this.miniScale / 1.5));
    zout.onclick = () => (this.miniScale = Math.min(20, this.miniScale * 1.5));
    const btns = el('div', 'mini-btns');
    btns.append(zin, zout);
    this.miniWrap.append(this.mini, btns, el('div', 'mini-label', 'N ↑ · M for chart'));
  }

  // ------------------------------------------------------------------ sonar panel

  private buildSonarPanel() {
    const p = this.d.sonarPanel;
    const sonar = this.d.sonar;
    const wf = this.d.waterfall;
    const head = el('div', 'sp-head');
    head.append(el('div', 'sp-title', `SIDE-SCAN <span>${sonar.name}</span>`), this.status);

    const ctl = el('div', 'sp-controls');
    const rg = el('div', 'seg');
    for (const r of RANGES) {
      const b = el('button', '', `${r} m`);
      b.onclick = () => {
        sonar.setRange(r);
        this.syncControls();
        wf.markDirty();
      };
      this.rangeButtons.push(b);
      rg.append(b);
    }
    const bd = el('div', 'seg');
    for (const band of ['HF', 'LF'] as const) {
      const b = el('button', '', band === 'HF' ? 'HF 900 kHz' : 'LF 400 kHz');
      b.onclick = () => {
        sonar.setBand(band);
        this.syncControls();
        wf.markDirty();
      };
      this.bandButtons.push(b);
      bd.append(b);
    }
    this.pingButton = el('button', 'ping-btn', 'PING');
    this.pingButton.onclick = () => {
      sonar.enabled = !sonar.enabled;
      this.syncControls();
    };
    ctl.append(labelled('Range', rg), labelled('Band', bd), labelled('Tx', this.pingButton));

    const ctl2 = el('div', 'sp-controls');
    const pal = el('select');
    for (const n of PALETTE_NAMES) pal.append(new Option(n, n));
    pal.value = wf.palette;
    pal.onchange = () => wf.setPalette(pal.value);
    const gain = slider(0.2, 4, 0.05, wf.gain, (v) => wf.setGain(v));
    const tvg = slider(0, 4, 0.05, wf.tvg, (v) => wf.setTvg(v));
    ctl2.append(labelled('Palette', pal), labelled('Gain', gain), labelled('TVG', tvg));

    const foot = el('div', 'sp-foot');
    const grid = el('div', 'readouts');
    const items: [string, string][] = [
      ['alt', 'FISH ALT'],
      ['depth', 'WATER DEPTH'],
      ['cable', 'CABLE OUT'],
      ['fdepth', 'FISH DEPTH'],
      ['speed', 'SPEED'],
      ['hdg', 'HEADING'],
      ['ping', 'PING RATE'],
      ['fish', 'FISH'],
    ];
    for (const [k, label] of items) {
      const cell = el('div', 'ro');
      const v = el('div', 'ro-v', '—');
      cell.append(el('div', 'ro-l', label), v);
      this.readouts[k] = v;
      grid.append(cell);
    }
    this.profile.width = 360;
    this.profile.height = 120;
    foot.append(grid, this.profile);

    p.append(head, ctl, ctl2, wf.el, this.cursorLine, foot);
    this.syncControls();

    wf.onHover = (row, bin) => {
      if (!row) {
        this.cursorLine.textContent = 'Move over the record to read range and position. Click a target to log it.';
        return;
      }
      const w = sonar.binToWorld(row, bin);
      if (!w) {
        this.cursorLine.textContent = `${bin < 400 ? 'PORT' : 'STBD'} · water column`;
        return;
      }
      const geo = this.d.map.toGeo(w.x, w.z);
      this.cursorLine.textContent = `${w.side < 0 ? 'PORT' : 'STBD'} ${w.slant.toFixed(1)} m slant · ${formatLatLon(geo)} · ping ${row.index}`;
    };
    wf.onHover(null, 0);
  }

  syncControls() {
    const s = this.d.sonar;
    RANGES.forEach((r, i) => {
      this.rangeButtons[i].classList.toggle('on', s.range === r);
      this.rangeButtons[i].disabled = r > s.maxRange;
    });
    this.bandButtons[0].classList.toggle('on', s.band === 'HF');
    this.bandButtons[1].classList.toggle('on', s.band === 'LF');
    this.pingButton.classList.toggle('on', s.enabled);
    this.pingButton.textContent = s.enabled ? 'PINGING' : 'STANDBY';
  }

  // ------------------------------------------------------------------ per frame

  update(boat: Boat, fish: Towfish, targets: Target[], score: number, falseContacts: number) {
    const sonar = this.d.sonar;
    const found = targets.filter((t) => t.discovered).length;
    const realKm = (this.d.charts.lineLength * H_SCALE) / 1000;
    this.score.innerHTML = `<div class="sc-v">${score.toLocaleString()}</div><div class="sc-l">POINTS</div>
      <div class="sc-row"><span>Targets</span><b>${found} / ${targets.length}</b></div>
      <div class="sc-row"><span>Line surveyed</span><b>${realKm.toFixed(1)} km</b></div>
      <div class="sc-row"><span>False contacts</span><b>${falseContacts}</b></div>`;

    const geo = this.d.map.toGeo(boat.x, boat.z);
    this.loc.innerHTML = `<div class="loc-place">${this.d.places.describe(boat.x, boat.z, H_SCALE)}</div><div class="loc-ll">${formatLatLon(geo)}</div>`;

    const thr = boat.throttle;
    this.throttleFill.style.height = `${Math.abs(thr) * 50}%`;
    this.throttleFill.style.bottom = thr >= 0 ? '50%' : `${50 - Math.abs(thr) * 50}%`;
    this.throttleFill.classList.toggle('astern', thr < 0);
    this.rudderNeedle.style.left = `${50 + boat.rudder * 45}%`;
    const kn = boat.speed * KNOTS_PER_MS;
    this.speedText.innerHTML = `<b>${kn.toFixed(1)}</b> kn`;
    this.hdgText.innerHTML = `<b>${String(Math.round((boat.heading * 180) / Math.PI) % 360).padStart(3, '0')}°</b> HDG`;
    this.hullText.innerHTML = `HULL <b class="${boat.hull < 40 ? 'warn' : ''}">${Math.round(boat.hull)}%</b>`;

    // Sonar readouts.
    const R = sonar.range;
    const alt = fish.altitude;
    const altOk = alt >= R * 0.08 && alt <= R * 0.22;
    const altCls = !fish.wet ? '' : alt < 2 ? 'bad' : altOk ? 'good' : 'warn';
    this.set('alt', fish.wet ? `${alt.toFixed(1)} m` : '—', altCls);
    this.set('depth', `${Math.max(0, -fish.seabed).toFixed(1)} m`);
    this.set('cable', `${fish.cable.toFixed(1)} m`, fish.stoppedDepth > -fish.seabed - 1 && Math.abs(boat.speed) < 1.5 ? 'warn' : '');
    this.set('fdepth', `${Math.max(0, -fish.pos.y).toFixed(1)} m`);
    this.set('speed', `${kn.toFixed(1)} kn`, kn > 9 ? 'warn' : kn >= 3 && kn <= 6 ? 'good' : '');
    this.set('hdg', `${String(Math.round((boat.heading * 180) / Math.PI) % 360).padStart(3, '0')}°`);
    this.set('ping', `${sonar.pingRate.toFixed(1)} Hz`);
    this.set('fish', `${Math.round(fish.health)}%`, fish.health < 40 ? 'bad' : '');
    this.status.textContent = sonar.enabled ? sonar.status : 'STANDBY';
    this.status.className = `chip ${sonar.status === 'OK' && sonar.enabled ? 'ok' : 'warn'}`;

    this.drawProfile(boat, fish);
    const mctx = this.mini.getContext('2d')!;
    this.d.charts.draw(mctx, this.mini.width, this.mini.height, boat.x, boat.z, this.miniScale, {
      boat: { x: boat.x, z: boat.z, heading: boat.heading },
      fish: { x: fish.pos.x, z: fish.pos.z },
      targets,
      labels: this.miniScale > 4,
    });
    if (this.modalKind === 'chart') this.drawChart(boat, fish, targets);
  }

  private set(k: string, v: string, cls = '') {
    const e = this.readouts[k];
    if (e.textContent !== v) e.textContent = v;
    e.className = `ro-v ${cls}`;
  }

  /** Side view of boat, cable, fish and the seabed along the tow line. */
  private drawProfile(boat: Boat, fish: Towfish) {
    const c = this.profile;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const span = 80;
    const maxD = 34;
    ctx.fillStyle = '#081217';
    ctx.fillRect(0, 0, W, H);
    const x0 = 30;
    const sx = (W - x0 - 10) / span;
    const sy = (H - 20) / maxD;
    const top = 12;
    // Seabed along the line from the boat back through the fish.
    let dx = fish.pos.x - boat.x;
    let dz = fish.pos.z - boat.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 1) {
      dx = -Math.sin(boat.heading);
      dz = Math.cos(boat.heading);
    } else {
      dx /= dl;
      dz /= dl;
    }
    ctx.fillStyle = '#0e2a33';
    ctx.fillRect(x0, top, W - x0, H - top);
    ctx.beginPath();
    ctx.moveTo(x0, H);
    for (let i = 0; i <= 60; i++) {
      const s = (i / 60) * span;
      const h = this.d.terrain.fullHeight(boat.x + dx * s, boat.z + dz * s);
      ctx.lineTo(x0 + s * sx, top + Math.min(maxD, -h) * sy);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#5b4a33';
    ctx.fill();
    // Depth scale.
    ctx.fillStyle = 'rgba(200,230,240,0.6)';
    ctx.font = '9px ui-monospace, Menlo, monospace';
    for (let d = 0; d <= 30; d += 10) {
      ctx.fillText(`${d}`, 4, top + d * sy + 3);
      ctx.fillStyle = 'rgba(200,230,240,0.12)';
      ctx.fillRect(x0, top + d * sy, W - x0, 1);
      ctx.fillStyle = 'rgba(200,230,240,0.6)';
    }
    // Surface, boat, cable, fish.
    ctx.fillStyle = '#7fd6e0';
    ctx.fillRect(x0, top - 1, W - x0, 2);
    ctx.fillStyle = '#f0ece2';
    ctx.fillRect(x0 - 2, top - 7, 12, 6);
    const fsx = x0 + Math.min(span, dl) * sx;
    const fsy = top + -fish.pos.y * sy;
    ctx.strokeStyle = '#cfcfcf';
    ctx.beginPath();
    ctx.moveTo(x0 + 6, top - 4);
    ctx.quadraticCurveTo((x0 + fsx) / 2, (top + fsy) / 2 + 6, fsx, fsy);
    ctx.stroke();
    ctx.fillStyle = '#f2c21b';
    ctx.beginPath();
    ctx.ellipse(fsx, fsy, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Altitude tick.
    const by = top + -fish.seabed * sy;
    ctx.strokeStyle = fish.altitude < 2 ? '#ff5a4a' : '#8fd18b';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(fsx, fsy + 3);
    ctx.lineTo(fsx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(220,240,250,0.85)';
    ctx.fillText('TOW PROFILE', x0 + 4, H - 4);
  }

  // ------------------------------------------------------------------ toasts

  toast(title: string, text = '', kind: 'info' | 'warn' | 'bad' | 'good' = 'info', ms = 4500) {
    const t = el('div', `toast ${kind}`);
    t.append(el('div', 'toast-t', title));
    if (text) t.append(el('div', 'toast-x', text));
    this.toasts.prepend(t);
    while (this.toasts.children.length > 5) this.toasts.lastChild?.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 600);
    }, ms);
  }

  discovery(t: Target, place: string) {
    const c = el('div', 'discovery');
    c.style.setProperty('--cat', CAT_COLOR[t.def.category]);
    c.innerHTML = `<div class="dc-cat">${CAT_SINGULAR[t.def.category]} logged</div>
      <div class="dc-name">${t.def.name}</div>
      <div class="dc-pts">+${t.def.points}</div>
      <div class="dc-blurb">${t.def.blurb}</div>
      <div class="dc-place">${place}</div>`;
    this.d.game.append(c);
    setTimeout(() => c.classList.add('out'), 6500);
    setTimeout(() => c.remove(), 7300);
  }

  // ------------------------------------------------------------------ modals

  get modalOpen(): boolean {
    return this.modalKind !== '';
  }

  closeModal() {
    this.modal.classList.add('hidden');
    this.modalKind = '';
    this.modalBody.innerHTML = '';
    this.onModalChange?.(false);
  }

  private open(kind: string, wide = false) {
    this.modalKind = kind;
    this.modal.classList.remove('hidden');
    this.modalBody.className = `modal-body ${wide ? 'wide' : ''}`;
    this.modalBody.innerHTML = '';
    this.onModalChange?.(true);
  }

  toggle(kind: 'log' | 'help' | 'chart', targets: Target[], discoveredMeta: Map<string, { place: string; time: number }>) {
    if (this.modalKind === kind) return this.closeModal();
    if (kind === 'help') this.openHelp();
    else if (kind === 'log') this.openLog(targets, discoveredMeta);
    else this.openChart();
  }

  openHelp() {
    this.open('help');
    this.modalBody.innerHTML = `
      <h2>Survey briefing</h2>
      <p>You run a small survey launch on Puget Sound. The shape of the sound and its depths come from real bathymetry. The detail on the bottom is different for each survey seed.</p>
      <h3>Helm</h3>
      <ul>
        <li><b>W / S</b> or <b>↑ / ↓</b>: set the throttle. It stays where you leave it. <b>X</b>: stop.</li>
        <li><b>A / D</b> or <b>← / →</b>: steer. The rudder needs water flow, so turns are slow at low speed.</li>
        <li>Drag the 3D view to look around. Use the wheel to zoom. Double-click to reset the view.</li>
      </ul>
      <h3>Side-scan sonar</h3>
      <ul>
        <li><b>R / F</b>: pay out or haul in tow cable. More cable puts the fish deeper. More speed lifts it.</li>
        <li>Keep the fish at about 10–20% of the range above the bottom. The altitude readout turns green in that band.</li>
        <li>When you slow down, the fish sinks. Haul in cable before you stop in shallow water.</li>
        <li>Survey at 3–6 kn. Above about 9 kn, aeration noise covers the record.</li>
        <li>The dark band in the centre is the water column. Targets show a bright face toward the fish and a dark acoustic shadow behind. Taller targets cast longer shadows.</li>
        <li>HF gives a sharper picture to 75 m. LF reaches 150 m with less detail.</li>
      </ul>
      <h3>Logging targets</h3>
      <ul>
        <li><b>Click a target on the sonar record</b> to log it. A correct pick gives points and drops a buoy.</li>
        <li>A pick with no target is a false contact and costs 5 points.</li>
        <li>The survey log (<b>L</b>) lists rumours that point to the rarer targets.</li>
        <li><b>M</b> opens the chart. Orange shows the seabed you have already covered.</li>
      </ul>
      <p class="dim">Base map: SalishSeaCast bathymetry (UBC), compressed 10:1 horizontally. Depths are scaled for clear water.</p>
      <button class="primary" data-close>Close</button>`;
    this.modalBody.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.closeModal();
  }

  openLog(targets: Target[], meta: Map<string, { place: string; time: number }>) {
    this.open('log', true);
    const cats: Category[] = ['natural', 'debris', 'wreck', 'oddity', 'legend'];
    let html = '<h2>Survey log</h2><div class="log-cats">';
    for (const c of cats) {
      const all = targets.filter((t) => t.def.category === c);
      const f = all.filter((t) => t.discovered).length;
      html += `<div class="log-cat" style="--cat:${CAT_COLOR[c]}"><b>${f}/${all.length}</b><span>${CAT_LABEL[c]}</span></div>`;
    }
    html += '</div><div class="log-cols"><div><h3>Logged targets</h3>';
    const found = targets.filter((t) => t.discovered).sort((a, b) => (meta.get(b.id)?.time ?? 0) - (meta.get(a.id)?.time ?? 0));
    if (!found.length) html += '<p class="dim">Nothing logged yet. Click targets on the sonar record to log them.</p>';
    for (const t of found) {
      html += `<div class="log-item" style="--cat:${CAT_COLOR[t.def.category]}"><div><b>${t.def.name}</b> <span class="pts">+${t.def.points}</span></div><div class="dim">${meta.get(t.id)?.place ?? ''}</div></div>`;
    }
    html += '</div><div><h3>Rumours</h3>';
    const seen = new Set<string>();
    for (const t of targets) {
      if (t.discovered || !t.def.rumor || !t.zoneName) continue;
      const key = t.def.type + t.zoneName;
      if (seen.has(key)) continue;
      seen.add(key);
      html += `<div class="log-item rumor" style="--cat:${CAT_COLOR[t.def.category]}">“${t.def.rumor.replace('{place}', t.zoneName)}”</div>`;
    }
    html += '</div></div><button class="primary" data-close>Close</button>';
    this.modalBody.innerHTML = html;
    this.modalBody.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.closeModal();
  }

  openChart() {
    this.open('chart', true);
    this.modalBody.innerHTML = '<h2>Chart of the survey area</h2>';
    this.modalBody.append(this.chartCanvas);
    const b = el('button', 'primary', 'Close');
    b.onclick = () => this.closeModal();
    this.modalBody.append(b);
  }

  private drawChart(boat: Boat, fish: Towfish, targets: Target[]) {
    const c = this.chartCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ch = Math.floor(window.innerHeight * 0.74);
    const cw = Math.floor((ch * this.d.map.width) / this.d.map.height);
    if (c.width !== Math.floor(cw * dpr)) {
      c.width = Math.floor(cw * dpr);
      c.height = Math.floor(ch * dpr);
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
    }
    const scale = this.d.map.height / c.height;
    this.d.charts.draw(c.getContext('2d')!, c.width, c.height, this.d.map.width / 2, this.d.map.height / 2, scale, {
      boat: { x: boat.x, z: boat.z, heading: boat.heading },
      fish: { x: fish.pos.x, z: fish.pos.z },
      targets,
      labels: true,
      dpr,
    });
  }

  showTitle(opts: { hasSave: boolean; seed: number; onContinue: () => void; onNew: (seed: number) => void }) {
    this.open('title', false);
    this.modal.classList.add('title');
    this.modalBody.innerHTML = `
      <div class="title-logo">TRAWL</div>
      <div class="title-sub">A side-scan survey of Puget Sound</div>
      <p>The bottom of the sound holds wrecks, lost cargo and a few things nobody can explain. Tow the fish, read the record and log what you find.</p>
      <div class="title-actions">
        ${opts.hasSave ? '<button class="primary" data-cont>Continue survey</button>' : ''}
        <button class="${opts.hasSave ? '' : 'primary'}" data-new>New survey</button>
        <label class="seed">Seed <input type="text" value="${opts.seed}" data-seed /></label>
      </div>
      <p class="dim">W/S throttle · A/D steer · R/F cable · click the sonar record to log targets · H help</p>`;
    const cont = this.modalBody.querySelector<HTMLButtonElement>('[data-cont]');
    const seedInput = this.modalBody.querySelector<HTMLInputElement>('[data-seed]')!;
    const close = () => {
      this.modal.classList.remove('title');
      this.closeModal();
    };
    if (cont)
      cont.onclick = () => {
        close();
        opts.onContinue();
      };
    this.modalBody.querySelector<HTMLButtonElement>('[data-new]')!.onclick = () => {
      const v = seedInput.value.trim();
      const n = /^\d+$/.test(v) ? Number(v) >>> 0 : hashSeed(v || String(Date.now()));
      close();
      opts.onNew(n);
    };
  }

  setLoading(text: string | null) {
    let l = document.querySelector<HTMLDivElement>('.loading');
    if (!text) {
      l?.remove();
      return;
    }
    if (!l) {
      l = el('div', 'loading');
      document.body.append(l);
    }
    l.innerHTML = `<div class="title-logo">TRAWL</div><div class="loading-t">${text}</div>`;
  }

}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function labelled(label: string, child: HTMLElement): HTMLElement {
  const w = el('div', 'ctl');
  w.append(el('span', 'ctl-l', label), child);
  return w;
}

function slider(min: number, max: number, step: number, value: number, on: (v: number) => void): HTMLInputElement {
  const s = el('input');
  s.type = 'range';
  s.min = String(min);
  s.max = String(max);
  s.step = String(step);
  s.value = String(value);
  s.oninput = () => on(Number(s.value));
  return s;
}
