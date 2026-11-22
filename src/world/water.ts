// Water surface: stylized clear water with fresnel sky reflection, sun glints, wave
// normals and sparse painted wave lines. The seabed shader does the depth colouring;
// this layer adds the surface itself.

import * as THREE from 'three';
import { GAME_MAX_DEPTH, WATER_LEVEL } from '../config';
import type { Terrain } from './terrain';
import { sharedUniforms } from './materials';

export const skyUniforms = {
  uSkyTop: { value: new THREE.Color(0x4f8fd0) },
  uSkyHorizon: { value: new THREE.Color(0xcfe3ea) },
  uSunColor: { value: new THREE.Color(0xfff1d6) },
};

const vert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform sampler2D uDepthTex;
uniform vec2 uWorldSize;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uMaxDepth;
varying vec3 vWorld;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
void wave(inout vec2 g, vec2 p, float t, vec2 d, float len, float amp, float spd, float dist) {
  float k = 6.2831 / len;
  float ph = dot(d, p) * k - t * spd * k;
  // Fade short waves with distance so they do not alias into moire.
  float fade = 1.0 - smoothstep(len * 6.0, len * 20.0, dist);
  g += amp * k * cos(ph) * d * fade;
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float dist = length(cameraPosition - vWorld);
  vec2 g = vec2(0.0);
  wave(g, p, t, normalize(vec2(1.0, 0.35)), 11.0, 0.07, 1.6, dist);
  wave(g, p, t, normalize(vec2(0.6, -0.8)), 6.5, 0.04, 1.2, dist);
  wave(g, p, t, normalize(vec2(-0.3, 1.0)), 3.7, 0.022, 0.9, dist);
  wave(g, p, t, normalize(vec2(0.9, 0.9)), 2.1, 0.012, 0.7, dist);
  float e = 0.35;
  float n0 = vnoise(p * 1.3 + t * 0.4);
  g += vec2(vnoise(p * 1.3 + vec2(e, 0.0) + t * 0.4) - n0, vnoise(p * 1.3 + vec2(0.0, e) + t * 0.4) - n0) * 0.07 * (1.0 - smoothstep(20.0, 60.0, dist));
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

  vec3 V = normalize(cameraPosition - vWorld);
  // Flatten the normal with distance so far water reads calm.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(150.0, 1500.0, dist)));
  float ndv = max(dot(N, V), 0.0);
  float F = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);

  vec2 uv = vWorld.xz / uWorldSize;
  float depth = texture2D(uDepthTex, uv).r * uMaxDepth;
  float inWorld = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  depth = mix(20.0, depth, inWorld);

  vec3 body = mix(uShallow, uDeep, smoothstep(0.5, 18.0, depth));
  float alpha = mix(0.10, 0.5, smoothstep(0.3, 24.0, depth));

  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6));
  float sunDot = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunColor * (pow(sunDot, 2400.0) * 1.4 + pow(sunDot, 90.0) * 0.05);

  // Painted wave lines (stylized).
  float ln = sin(dot(p, vec2(0.55, 0.3)) + vnoise(p * 0.12) * 5.0 - t * 1.1);
  float lines = smoothstep(0.975, 0.998, ln) * smoothstep(0.74, 0.92, vnoise(p * vec2(0.22, 0.4) + t * 0.05));
  lines *= 1.0 - smoothstep(40.0, 160.0, dist);

  vec3 col = mix(body, sky, F);
  col += spec;
  col = mix(col, vec3(0.95), lines * 0.28);
  float a = clamp(alpha + F * 0.9 + lines * 0.3 + length(spec) * 0.3, 0.0, 0.97);

  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(terrain: Terrain) {
    const map = terrain.map;
    // Depth texture at base-map resolution (smooth; used only for tint).
    const w = map.nx;
    const h = map.ny;
    const data = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const s = map.cellValue(i, j);
        const d = s > 0 ? terrain.map.cellValue(i, j) : 0;
        const gd = d > 0 ? GAME_MAX_DEPTH * Math.pow(d / 260, 0.75) : 0;
        data[j * w + i] = Math.max(0, Math.min(255, Math.round((gd / GAME_MAX_DEPTH) * 255)));
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uDepthTex: { value: tex },
          uWorldSize: { value: new THREE.Vector2(map.width + map.cell, map.height + map.cell) },
          uShallow: { value: new THREE.Color(0x46d6cf) },
          uDeep: { value: new THREE.Color(0x0b4f73) },
          uMaxDepth: { value: GAME_MAX_DEPTH },
        },
      ]),
    });
    // Share live uniforms (merge clones them).
    this.material.uniforms.uTime = sharedUniforms.uTime;
    this.material.uniforms.uSunDir = sharedUniforms.uSunDir;
    this.material.uniforms.uSkyTop = skyUniforms.uSkyTop;
    this.material.uniforms.uSkyHorizon = skyUniforms.uSkyHorizon;
    this.material.uniforms.uSunColor = skyUniforms.uSunColor;
    this.material.uniforms.uDepthTex.value = tex;

    const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  update(camera: THREE.Camera) {
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }
}

/** Surface wave height (m) at a point, used for boat motion. Matches the shader roughly. */
export function waveHeight(x: number, z: number, t: number): number {
  const w = (dx: number, dz: number, len: number, amp: number, spd: number) => {
    const l = Math.hypot(dx, dz);
    const k = (Math.PI * 2) / len;
    return amp * Math.sin(((dx / l) * x + (dz / l) * z) * k - t * spd * k);
  };
  return w(1, 0.35, 11, 0.07, 1.6) + w(0.6, -0.8, 6.5, 0.04, 1.2) + w(-0.3, 1, 3.7, 0.022, 0.9);
}
