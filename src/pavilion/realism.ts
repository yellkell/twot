/**
 * realism.ts — scene-level plumbing for the realistic pavilion, harvested
 * from yellkell/vrenv (claude/iwsdk-quest3-environments branch):
 *
 *  - `applyRealismRenderer`: ACES tone mapping + a single *static* shadow
 *    map (rendered once, then frozen — near-zero per-frame cost on Quest).
 *  - `skyDome`: an analytic gradient-plus-sun shader sky.
 *  - `bakeEnvironment`: runs the sky through PMREMGenerator so PBR materials
 *    (glass, steel, water) actually reflect the world. Returns the map so
 *    the caller can toggle it on/off against passthrough.
 *  - `onTick` + `runTicks`: tiny per-frame callback registry (scrolling
 *    water normals etc.), driven by PavilionSystem only while visible.
 */

import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  Mesh,
  PCFSoftShadowMap,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
} from 'three';
import type { World } from '@iwsdk/core';

export function applyRealismRenderer(world: World, exposure = 1.0): void {
  const renderer = world.renderer;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // The environment is static: render the shadow map once and freeze it.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
}

export interface SkySpec {
  top: string;
  mid: string;
  horizon: string;
  /** World-space direction pointing *at* the sun. */
  sunDirection: Vector3;
  sunColor: string;
  /** Solid disc size (cosine threshold) and halo breadth. */
  sunSize?: number;
  haloPower?: number;
  haloStrength?: number;
}

/**
 * Analytic sky: vertical three-stop gradient + sun disc with halo. One
 * draw call, no textures, tone-mapping friendly.
 */
export function skyDome(spec: SkySpec, radius = 380): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(spec.top) },
      mid: { value: new Color(spec.mid) },
      horizon: { value: new Color(spec.horizon) },
      sunDir: { value: spec.sunDirection.clone().normalize() },
      sunColor: { value: new Color(spec.sunColor) },
      sunSize: { value: spec.sunSize ?? 0.9994 },
      haloPower: { value: spec.haloPower ?? 80 },
      haloStrength: { value: spec.haloStrength ?? 0.7 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float sunSize;
      uniform float haloPower;
      uniform float haloStrength;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.12, 1.0);
        vec3 col;
        if (h < 0.22) {
          col = mix(horizon, mid, smoothstep(-0.12, 0.22, h));
        } else {
          col = mix(mid, top, smoothstep(0.22, 0.85, h));
        }
        float cosang = dot(d, sunDir);
        col += sunColor * haloStrength * pow(max(cosang, 0.0), haloPower);
        col = mix(col, sunColor * 2.6, smoothstep(sunSize, sunSize + 0.0006, cosang));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(radius, 32, 20), mat);
  dome.userData.noMerge = true;
  dome.frustumCulled = false;
  return dome;
}

/**
 * Renders the given sky into a PMREM and returns the environment map. The
 * caller assigns/unassigns it to `scene.environment` when toggling views.
 */
export function bakeEnvironment(world: World, spec: SkySpec): Texture {
  const pmrem = new PMREMGenerator(world.renderer);
  const skyScene = new Scene();
  skyScene.add(skyDome(spec, 100));
  const envMap = pmrem.fromScene(skyScene, 0.04).texture;
  pmrem.dispose();
  return envMap;
}

type TickFn = (delta: number, time: number) => void;
const tickFns: TickFn[] = [];

/** Register a per-frame callback (runs only while the pavilion is shown). */
export function onTick(fn: TickFn): void {
  tickFns.push(fn);
}

export function runTicks(delta: number, time: number): void {
  for (const fn of tickFns) fn(delta, time);
}
