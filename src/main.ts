import * as THREE from 'three';
import './styles.css';
import { H_SCALE } from './config';
import { BaseMap } from './world/bathymetry';
import { Terrain } from './world/terrain';
import { Places } from './world/places';
import { TerrainRenderer } from './world/chunks';
import { WaterSurface } from './world/water';
import { Sky } from './world/sky';
import { Features, type Target } from './world/features';
import { Landmarks } from './world/landmarks';
import { sharedUniforms } from './world/materials';
import { Boat } from './vessel/boat';
import { Towfish } from './vessel/towfish';
import { Wake } from './vessel/wake';
import { SideScan } from './sonar/sidescan';
import { Waterfall } from './ui/waterfall';
import { Charts } from './ui/chart';
import { Hud, categoryColor } from './ui/hud';
import { Input } from './ui/input';
import { CameraRig } from './ui/camera';
import { clearSave, loadSave, writeSave, type SaveData } from './game/save';

const NEXT_SEED_KEY = 'trawl-next-seed';

async function main() {
  const gameEl = document.getElementById('game')!;
  const sonarEl = document.getElementById('sonar')!;
  const loading = (t: string) => {
    let l = document.querySelector<HTMLDivElement>('.loading');
    if (!l) {
      l = document.createElement('div');
      l.className = 'loading';
      document.body.append(l);
    }
    l.innerHTML = `<div class="title-logo">TRAWL</div><div class="loading-t">${t}</div>`;
  };
  const frameYield = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  loading('Reading the bathymetry…');
  await frameYield();
  const map = await BaseMap.load();

  // Seed: ?seed= in the URL, a seed chosen on the title screen, the saved game, or random.
  const save = loadSave();
  const urlSeed = new URLSearchParams(location.search).get('seed');
  let nextSeed: number | null = null;
  try {
    const n = localStorage.getItem(NEXT_SEED_KEY);
    if (n) {
      nextSeed = Number(n) >>> 0;
      localStorage.removeItem(NEXT_SEED_KEY);
    }
  } catch {
    /* ignore */
  }
  const seed =
    urlSeed !== null ? Number(urlSeed) >>> 0 : nextSeed ?? save?.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const startFresh = nextSeed !== null;

  loading('Shaping the seabed…');
  await frameYield();
  const terrain = new Terrain(map, seed);
  const places = new Places(map);
  const spawn = findSpawn(terrain, map);

  loading('Sinking wrecks and hiding secrets…');
  await frameYield();
  const features = new Features(terrain, places, spawn);
  features.generate();
  features.buildBubbles();
  const landmarks = new Landmarks(terrain);

  loading('Raising the shoreline…');
  await frameYield();

  // ---------------------------------------------------------------- renderer and scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  gameEl.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1.0, 60000);
  const sky = new Sky(map, seed);
  scene.add(sky.group);
  scene.fog = sky.fog;
  scene.background = sky.fog.color;

  const terrainRenderer = new TerrainRenderer(terrain);
  terrainRenderer.buildFarMesh();
  scene.add(terrainRenderer.root);
  scene.add(features.root);
  scene.add(landmarks.root);
  const water = new WaterSurface(terrain);
  scene.add(water.mesh);

  // ---------------------------------------------------------------- vessel and sonar
  const input = new Input();
  let hud!: Hud;
  let score = 0;
  let falseContacts = 0;
  let playTime = 0;
  const meta = new Map<string, { place: string; time: number }>();
  let boundaryCooldown = 0;

  const boat = new Boat(terrain, spawn.x, spawn.z, spawn.heading, {
    onGround: () => {
      hud.toast('Aground!', 'The hull touched bottom. Back off into deeper water.', 'bad');
      if (boat.hull <= 0) {
        score = Math.max(0, score - 100);
        boat.reset(spawn.x, spawn.z, spawn.heading);
        fish.pos.set(spawn.x, -3, spawn.z + 6);
        hud.toast('Towed back to port', 'The hull gave out. Repairs cost 100 points.', 'bad', 7000);
      }
    },
    onBoundary: () => {
      if (boundaryCooldown <= 0) {
        hud.toast('Edge of the survey area', 'Turn back into the sound.', 'warn');
        boundaryCooldown = 4;
      }
    },
  });
  scene.add(boat.group);
  const fish = new Towfish(terrain, boat, {
    onStrike: (sev) => {
      sonar.strikeFlash = 0.35;
      if (sev > 2) hud.toast('Towfish hit the bottom', 'Haul in cable (F) or speed up to lift the fish.', 'bad');
      else hud.toast('Fish on the bottom', 'The fish is resting on the seabed. Haul in cable (F).', 'warn', 3000);
    },
    onLost: () => {
      score = Math.max(0, score - 150);
      hud.toast('Towfish lost', 'The spare fish is rigged. That cost 150 points.', 'bad', 7000);
    },
  });
  scene.add(fish.group, fish.cableObject);
  // Start with a safe amount of cable for the local depth.
  fish.cable = Math.max(4, Math.min(18, -terrain.naturalHeight(spawn.x, spawn.z) - 5 + 2.9));
  const wake = new Wake();
  scene.add(wake.mesh);

  const sonar = new SideScan();
  const waterfall = new Waterfall(sonar);
  const charts = new Charts(map, places);
  hud = new Hud({ game: gameEl, sonarPanel: sonarEl, sonar, waterfall, charts, places, map, terrain });
  sonar.onPing = (row) => {
    waterfall.push(row);
    charts.addPing(row);
  };

  const rig = new CameraRig(camera, renderer.domElement);
  rig.snap(boat);

  // Build the near terrain before the first frame.
  terrainRenderer.update(boat.x, boat.z, 1e9);

  // ---------------------------------------------------------------- contacts
  waterfall.onPick = (row, bin) => {
    if (hud.modalOpen) return;
    const w = sonar.binToWorld(row, bin);
    if (!w) {
      hud.toast('Water column', 'Nothing on the seabed there. Pick the bright return or its shadow.', 'info', 3000);
      return;
    }
    let best: Target | null = null;
    let bd = Infinity;
    for (const t of features.targets) {
      const d = Math.hypot(t.x - w.x, t.z - w.z) - t.radius;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    const tol = 4 + row.range * 0.05;
    if (best && bd < tol) {
      if (best.discovered) {
        hud.toast('Already logged', best.def.name, 'info', 2500);
        return;
      }
      features.markDiscovered(best);
      score += best.def.points;
      const place = places.describe(best.x, best.z, H_SCALE);
      meta.set(best.id, { place, time: Date.now() });
      waterfall.addContact({ rowIndex: row.index, bin, label: best.def.name.toUpperCase(), color: categoryColor(best.def.category) });
      hud.discovery(best, place);
      persist();
      if (features.targets.every((t) => t.discovered))
        hud.toast('Survey complete', 'Every target in the sound is logged. Try a new seed for a new seabed.', 'good', 12000);
    } else {
      falseContacts++;
      score = Math.max(0, score - 5);
      waterfall.addContact({ rowIndex: row.index, bin, label: '✕', color: '#9fb3b8' });
      hud.toast('False contact', 'No target there. Logged as a false contact (−5).', 'warn', 2500);
    }
  };

  // ---------------------------------------------------------------- save / load
  function snapshot(): SaveData {
    return {
      version: 1,
      seed,
      score,
      discovered: features.targets.filter((t) => t.discovered).map((t) => ({ id: t.id, time: meta.get(t.id)?.time ?? 0, place: meta.get(t.id)?.place ?? '' })),
      falseContacts,
      lineLength: charts.lineLength,
      boat: { x: boat.x, z: boat.z, heading: boat.heading },
      cable: fish.cable,
      coverage: charts.coverageDataUrl(),
      playTime,
    };
  }
  let playing = false;
  function persist() {
    if (playing) writeSave(snapshot());
  }
  setInterval(persist, 20000);
  window.addEventListener('beforeunload', persist);

  async function restore(s: SaveData) {
    score = s.score;
    falseContacts = s.falseContacts;
    playTime = s.playTime ?? 0;
    for (const d of s.discovered) {
      const t = features.targets.find((x) => x.id === d.id);
      if (!t) continue;
      features.markDiscovered(t);
      meta.set(t.id, { place: d.place, time: d.time });
    }
    if (map.inBounds(s.boat.x, s.boat.z, 30)) {
      boat.reset(s.boat.x, s.boat.z, s.boat.heading);
      fish.pos.set(s.boat.x - Math.sin(s.boat.heading) * 8, -3, s.boat.z + Math.cos(s.boat.heading) * 8);
    }
    fish.cable = s.cable;
    if (s.coverage) await charts.loadCoverage(s.coverage);
    charts.lineLength = s.lineLength;
    rig.snap(boat);
    terrainRenderer.update(boat.x, boat.z, 1e9);
  }

  function startGame() {
    playing = true;
    hud.setLoading(null);
    setTimeout(() => hud.toast('Welcome aboard', `Throttle up with W. The fish is on ${fish.cable.toFixed(0)} m of cable. Pay out more with R as you gain speed.`, 'info', 8000), 600);
    setTimeout(() => hud.toast('Reading the record', 'Targets show a bright face and a dark shadow. Click one on the record to log it.', 'info', 9000), 9000);
    setTimeout(() => hud.toast('Need a lead?', 'Press L for the survey log. It lists rumours of rare finds.', 'info', 8000), 20000);
  }

  // ---------------------------------------------------------------- layout
  function resize() {
    const w = gameEl.clientWidth;
    const h = gameEl.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    waterfall.resize();
  }
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(gameEl);
  new ResizeObserver(() => waterfall.resize()).observe(waterfall.el);
  resize();

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let time = 0;
  let hudTimer = 0;
  // Adaptive resolution: drop the pixel ratio if frames are slow.
  let pixelRatio = renderer.getPixelRatio();
  let frameAcc = 0;
  let frameCount = 0;
  const loop = (now: number) => {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    frameAcc += rawDt;
    frameCount++;
    if (frameAcc > 2) {
      const avg = frameAcc / frameCount;
      if (avg > 0.024 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        resize();
      }
      frameAcc = 0;
      frameCount = 0;
    }
    time += dt;
    sharedUniforms.uTime.value = time;
    boundaryCooldown -= dt;

    if (input.pressed('KeyM')) hud.toggle('chart', features.targets, meta);
    if (input.pressed('KeyL')) hud.toggle('log', features.targets, meta);
    if (input.pressed('KeyH')) hud.toggle('help', features.targets, meta);
    if (input.pressed('Escape') && hud.modalOpen) hud.closeModal();
    if (input.pressed('BracketRight')) {
      sonar.setRange([25, 50, 75, 100, 150].find((r) => r > sonar.range) ?? sonar.range);
      hud.syncControls();
      waterfall.markDirty();
    }
    if (input.pressed('BracketLeft')) {
      sonar.setRange([150, 100, 75, 50, 25].find((r) => r < sonar.range) ?? sonar.range);
      hud.syncControls();
      waterfall.markDirty();
    }

    const active = playing && !hud.modalOpen;
    if (active) {
      playTime += dt;
      boat.update(dt, input, time);
      fish.update(dt, boat, input);
      sonar.update(dt, { time, boat, fish, terrain, plumes: features.plumes });
    }
    const f = boat.forward;
    wake.update(time, boat.x - f.x * 4.2, boat.z - f.z * 4.2, boat.heading, boat.speed);
    features.update(time);
    terrainRenderer.update(boat.x, boat.z, 5);
    rig.update(dt, boat, terrain);
    water.update(camera);
    sky.update(camera);
    waterfall.drawOverlay();

    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      hud.update(boat, fish, features.targets, score, falseContacts);
    }
    renderer.render(scene, camera);
    input.endFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- title
  hud.setLoading(null);
  const canContinue = !!save && save.seed === seed && !startFresh;
  hud.showTitle({
    hasSave: canContinue,
    seed,
    onContinue: async () => {
      if (save) await restore(save);
      startGame();
    },
    onNew: (newSeed) => {
      if (newSeed === seed) {
        clearSave();
        startGame();
        persist();
      } else {
        clearSave();
        try {
          localStorage.setItem(NEXT_SEED_KEY, String(newSeed));
        } catch {
          /* ignore */
        }
        const url = new URL(location.href);
        url.searchParams.delete('seed');
        location.href = url.toString();
      }
    },
  });

  // Debug handle for the console.
  (window as unknown as { trawl: unknown }).trawl = {
    terrain,
    features,
    boat,
    fish,
    sonar,
    waterfall,
    camera,
    rig,
    renderer,
    scene,
    map,
    places,
    teleport(name: string) {
      const p = places.byName(name);
      if (!p) return 'unknown place';
      const s = findSpawnNear(terrain, p.x, p.z);
      boat.reset(s.x, s.z, boat.heading);
      fish.pos.set(s.x, -3, s.z + 5);
      rig.snap(boat);
      return s;
    },
    goto(x: number, z: number, heading = boat.heading) {
      boat.reset(x, z, heading);
      fish.pos.set(x - Math.sin(heading) * 6, -4, z + Math.cos(heading) * 6);
      rig.snap(boat);
    },
  };
}

function findSpawnNear(terrain: Terrain, x0: number, z0: number): { x: number; z: number } {
  for (let r = 0; r < 2000; r += 8) {
    const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 8));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const x = x0 + Math.cos(a) * r;
      const z = z0 + Math.sin(a) * r;
      if (terrain.naturalHeight(x, z) > -8) continue;
      let ok = true;
      for (let i = 0; i < 8 && ok; i++) {
        const b = (i / 8) * Math.PI * 2;
        if (terrain.fullHeight(x + Math.cos(b) * 12, z + Math.sin(b) * 12) > -3) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  return { x: x0, z: z0 };
}

function findSpawn(terrain: Terrain, map: BaseMap): { x: number; z: number; heading: number } {
  // Shilshole Bay, Seattle, heading west towards Port Madison.
  const p = map.fromGeo(47.684, -122.425);
  const s = findSpawnNear(terrain, p.x, p.z);
  return { ...s, heading: (285 * Math.PI) / 180 };
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#f88;padding:2em">Trawl failed to start:\n${String(e?.stack ?? e)}</pre>`;
});
