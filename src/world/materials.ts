// Shared shader uniforms and the "underwater" material patch: light absorption with
// depth, caustics and shoreline foam. Every material under the water line uses it, so
// the bottom, wrecks and the towfish get the same clear-tropical-water look.

import * as THREE from 'three';
import { WATER_LEVEL } from '../config';

export const sharedUniforms = {
  uTime: { value: 0 },
  uWaterLevel: { value: WATER_LEVEL },
  // Absorption per metre of path (R, G, B). Red goes first, blue last.
  uAbsorb: { value: new THREE.Vector3(0.2, 0.052, 0.036) },
  uDeepColor: { value: new THREE.Color(0x05384c) },
  uCausticStrength: { value: 0.42 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, -0.3).normalize() },
};

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform float uWaterLevel;
uniform vec3 uAbsorb;
uniform vec3 uDeepColor;
uniform float uCausticStrength;
varying vec3 vUwWorld;
vec2 uwHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float uwVoronoiEdge(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = uwHash(n + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}
float uwCaustic(vec2 p, float t) {
  vec2 w = p + vec2(sin(p.y * 0.31 + t * 0.7), cos(p.x * 0.27 - t * 0.6)) * 1.3;
  float a = 1.0 - smoothstep(0.0, 0.13, uwVoronoiEdge(w * 0.34, t * 0.9));
  float b = 1.0 - smoothstep(0.0, 0.18, uwVoronoiEdge(w * 0.52 + 7.3, t * 1.3 + 2.0));
  float c = a * 0.55 + b * 0.3 + a * b * 0.9;
  float patchy = 0.55 + 0.45 * sin(p.x * 0.07 + t * 0.25) * sin(p.y * 0.09 - t * 0.2);
  return c * patchy;
}
`;

export interface UnderwaterOptions {
  /** Paint surf and wet sand at the water line (terrain only). */
  shore?: boolean;
  /** Skip caustics (for small moving objects). */
  noCaustics?: boolean;
  /** Discard fragments inside this world XZ rectangle (minX, minZ, maxX, maxZ). */
  discardRect?: { value: THREE.Vector4 };
}

export function applyUnderwater<T extends THREE.Material>(mat: T, opts: UnderwaterOptions = {}): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    if (opts.discardRect) {
      shader.uniforms.uDiscardRect = opts.discardRect;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uDiscardRect;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          if (vUwWorld.x > uDiscardRect.x && vUwWorld.x < uDiscardRect.z &&
              vUwWorld.z > uDiscardRect.y && vUwWorld.z < uDiscardRect.w) discard;`,
        );
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUwWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 uwW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          uwW = instanceMatrix * uwW;
        #endif
        uwW = modelMatrix * uwW;
        vUwWorld = uwW.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace(
        '#include <tonemapping_fragment>',
        `{
          float uwD = uWaterLevel - vUwWorld.y;
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float upF = clamp(dot(normal, upV), 0.0, 1.0);
          ${
            opts.shore
              ? `
          // Wet sand and surf near the water line.
          float swash = 0.12 * sin(uTime * 0.9 + vUwWorld.x * 0.05 + vUwWorld.z * 0.03);
          float wet = 1.0 - smoothstep(0.0, 0.6, -uwD - swash);
          if (uwD < 0.0) gl_FragColor.rgb *= mix(1.0, 0.72, wet);
          float band = 1.0 - smoothstep(0.0, 0.32, abs(uwD + swash * 0.5 - 0.05));
          float fn = uwVoronoiEdge(vUwWorld.xz * 0.5, uTime * 1.5);
          float foam = band * smoothstep(0.05, 0.3, fn) * upF;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.95, 0.97, 0.95), foam * 0.85);`
              : ''
          }
          if (uwD > 0.0) {
            vec3 V = normalize(cameraPosition - vUwWorld);
            float pathLen = uwD + uwD / max(0.2, abs(V.y));
            ${
              opts.noCaustics
                ? ''
                : `float c = uwCaustic(vUwWorld.xz, uTime) * exp(-uwD * 0.1) * uCausticStrength * (0.25 + 0.75 * upF);
            gl_FragColor.rgb += c * vec3(0.85, 1.0, 0.95);`
            }
            vec3 absorb = exp(-uAbsorb * pathLen);
            gl_FragColor.rgb = gl_FragColor.rgb * absorb + uDeepColor * (1.0 - absorb);
          }
        }
        #include <tonemapping_fragment>`,
      );
  };
  // Distinct program cache key per option set.
  mat.customProgramCacheKey = () =>
    `uw-${opts.shore ? 1 : 0}-${opts.noCaustics ? 1 : 0}-${opts.discardRect ? 1 : 0}`;
  return mat;
}
