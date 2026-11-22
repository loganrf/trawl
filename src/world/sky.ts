// Sky dome, sun, fog and lights. Plus two backdrop landmarks: Mount Rainier and the
// Cascade foothills, drawn as hazy silhouettes outside the survey area.

import * as THREE from 'three';
import type { BaseMap } from './bathymetry';
import { sharedUniforms } from './materials';
import { skyUniforms } from './water';
import { mulberry32, Simplex2 } from './noise';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // far plane
}
`;

const skyFrag = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(y, 0.45));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
  // Soft painted clouds.
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(uTime * 0.004, 0.0);
    float c = vn(uv) * 0.6 + vn(uv * 2.3) * 0.3 + vn(uv * 5.1) * 0.1;
    c = smoothstep(0.55, 0.8, c) * smoothstep(0.0, 0.25, d.y);
    col = mix(col, vec3(1.0, 0.98, 0.95), c * 0.65);
  }
  col = mix(col, uSkyHorizon, 1.0 - smoothstep(-0.02, 0.06, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  private dome: THREE.Mesh;

  constructor(map: BaseMap, seed: number) {
    const domeMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSkyTop: skyUniforms.uSkyTop,
        uSkyHorizon: skyUniforms.uSkyHorizon,
        uSunColor: skyUniforms.uSunColor,
        uSunDir: sharedUniforms.uSunDir,
        uTime: sharedUniforms.uTime,
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.position.copy(sharedUniforms.uSunDir.value).multiplyScalar(1000);
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5d6b4a, 1.15);
    this.group.add(this.hemi);

    this.fog = new THREE.Fog(skyUniforms.uSkyHorizon.value.clone(), 300, 4200);

    this.group.add(this.makeRainier(map));
    this.group.add(this.makeCascades(map, seed));
  }

  private hazeMaterial(amount: number): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = skyUniforms.uSkyHorizon;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;')
        .replace(
          '#include <tonemapping_fragment>',
          `gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, ${amount.toFixed(2)});\n#include <tonemapping_fragment>`,
        );
    };
    return m;
  }

  private makeRainier(map: BaseMap): THREE.Mesh {
    const p = map.fromGeo(46.853, -121.76);
    const pts: THREE.Vector2[] = [];
    const H = 440;
    const R = 1900;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const r = R * Math.pow(1 - t, 1.6) + 60 * (1 - t);
      pts.push(new THREE.Vector2(Math.max(r, 0.01), H * t));
    }
    const geo = new THREE.LatheGeometry(pts, 28);
    const pos = geo.getAttribute('position');
    const rng = mulberry32(7);
    const col = new Float32Array(pos.count * 3);
    const snow = new THREE.Color(0xf4f7fa);
    const rock = new THREE.Color(0x6f7b86);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const jitter = (rng() - 0.5) * 50;
      pos.setY(i, Math.max(0, y + (y > 5 && y < H - 5 ? jitter * 0.4 : 0)));
      const sn = y > 150 + jitter * 2 ? 1 : 0;
      c.copy(rock).lerp(snow, sn);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, this.hazeMaterial(0.45));
    mesh.position.set(p.x, -20, p.z);
    mesh.name = 'rainier';
    return mesh;
  }

  /** Low ridge line far to the east. */
  private makeCascades(map: BaseMap, seed: number): THREE.Mesh {
    const noise = new Simplex2(mulberry32(seed ^ 0xca5c));
    const n = 120;
    const pos: number[] = [];
    const col: number[] = [];
    const x0 = map.width + 9000;
    const c1 = new THREE.Color(0x5f7884);
    const c2 = new THREE.Color(0x8aa0aa);
    for (let i = 0; i < n; i++) {
      const z = -6000 + (i / (n - 1)) * (map.height + 14000);
      const h = 120 + 140 * noise.ridged(z / 2500, 3.3, 4);
      pos.push(x0, -30, z, x0 - 200, h, z);
      col.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mat = this.hazeMaterial(0.55);
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'cascades';
    return mesh;
  }

  update(camera: THREE.Camera) {
    this.dome.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(sharedUniforms.uSunDir.value, 1000);
    this.sun.target.position.copy(camera.position);
  }
}
