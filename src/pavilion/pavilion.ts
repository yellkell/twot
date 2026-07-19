/**
 * The Lakeside Sports Pavilion — harvested from yellkell/vrenv
 * (claude/iwsdk-quest3-environments branch, pavilion-real.ts) and rebuilt
 * for TWOT:
 *
 *  - the tennis court, net, pit, steps and grabbable paddles are GONE —
 *    the hall floor is a flat oak deck with an acrylic play pad under the
 *    TWOT court, so the goal, fence and pedestals sit flush on it;
 *  - the LED scoreboard now runs a live TWOT feed (score, combo, the
 *    letters of shame, top scorers, aura king) redrawn by PavilionSystem;
 *  - everything hangs off ONE root group parented into arena-root, so the
 *    hall re-anchors with the court when the rotation law moves you;
 *  - `setPavilionView` toggles the whole thing against passthrough:
 *    visibility, fog, tone mapping and a one-shot static shadow re-bake.
 *
 * Fully procedural: every texture is painted into a canvas at load.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type Object3D,
  type Texture,
  type ToneMapping,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '@iwsdk/core';
import { leafClump, leafyTree, mountainRange, noise2 } from './nature.js';
import { applyRealismRenderer, bakeEnvironment, onTick, runTicks, skyDome, type SkySpec } from './realism.js';
import {
  acrylic,
  bannerArt,
  barkTexture,
  cloudCard,
  concreteTexture,
  grassTexture,
  leafage,
  muralWall,
  paintedMetal,
  srand,
  waterNormal,
  woodPlanks,
} from './textures.js';

// ----------------------------------------------------------------------------
// Layout & palette
// ----------------------------------------------------------------------------

const HALL = { hx: 13, hz: 17, low: 0.92, eaves: 4.2, peak: 8.6 };
const RIB_ZS = [-17, -12.75, -8.5, -4.25, 0, 4.25, 8.5, 12.75, 17];

/**
 * Arena-local z of the hall centre. The hall is 34 m deep; this offset
 * parks the WHOLE court setup at the far end of it — the fence stands
 * ~5 m in front of the far wall, with the benches, planters and the LED
 * scoreboard filling the gap behind the cage as a spectator zone — and
 * the rest of the deck opens out behind the attackers.
 */
export const PAVILION_OFFSET_Z = 10.5;

const TEAL = '#2b8a99';
const WHITE_STEEL = '#e8eae6';

let seed = 77;
const rand = (min: number, max: number) => {
  seed = (seed * 16807) % 2147483647;
  return min + ((seed & 0xffff) / 0x10000) * (max - min);
};

function archY(x: number): number {
  const t = Math.min(Math.abs(x) / HALL.hx, 1);
  return HALL.eaves + (HALL.peak - HALL.eaves) * Math.cos((t * Math.PI) / 2);
}

function scaleUV(geom: BufferGeometry, sx: number, sy: number): BufferGeometry {
  const uv = geom.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  return geom;
}

function mergeInto(material: MeshStandardMaterial, meshes: Mesh[], shadows = true): Mesh {
  const geoms = meshes.map((m) => {
    m.updateMatrix();
    return m.geometry.applyMatrix4(m.matrix);
  });
  const merged = new Mesh(mergeGeometries(geoms, false)!, material);
  merged.castShadow = shadows;
  merged.receiveShadow = true;
  return merged;
}

const SKY: SkySpec = {
  top: '#2e6fb2',
  mid: '#68a9d8',
  horizon: '#aed6ec',
  sunDirection: new Vector3(0.45, 0.72, 0.4),
  sunColor: '#fff2d8',
  haloPower: 120,
  haloStrength: 0.4,
};

// ----------------------------------------------------------------------------
// Public surface
// ----------------------------------------------------------------------------

export interface PavilionRig {
  /** Everything — parent into arena-root and toggle visible. */
  root: Group;
  /** The live scoreboard canvas: redraw + set scoreTexture.needsUpdate. */
  scoreCanvas: HTMLCanvasElement;
  scoreTexture: CanvasTexture;
  /** Ambient drifters (boats, clouds) animated by tickPavilion. */
  drifters: Object3D[];
}

let rig: PavilionRig | null = null;
let envMap: Texture | null = null;
let priorToneMapping: ToneMapping | null = null;
let priorExposure = 1;
let priorEnvironment: Texture | null = null;

/** Build once (hidden); returns the rig. */
export function buildPavilion(world: World): PavilionRig {
  if (rig) return rig;
  srand(0x51ab);
  envMap = bakeEnvironment(world, SKY);

  const root = new Group();
  root.name = 'pavilion';
  root.position.z = PAVILION_OFFSET_Z;

  const drifters: Object3D[] = [];
  buildFloor(root);
  buildStructure(root);
  buildGlazing(root);
  buildKicker(root);
  const score = buildFurnishings(root);
  buildBackdrop(root);
  buildBoats(root, drifters);
  buildClouds(root, drifters);
  root.add(skyDome(SKY));
  buildLights(root);

  // Per-material environment map: reflections work regardless of who owns
  // scene.environment, and passthrough materials are never touched.
  root.traverse((o) => {
    const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (mat && mat.isMeshStandardMaterial) mat.envMap = envMap;
  });

  root.visible = false;
  rig = { root, scoreCanvas: score.canvas, scoreTexture: score.texture, drifters };
  return rig;
}

/**
 * Flip between the pavilion backdrop and passthrough. Captures the
 * renderer/scene state the first time it takes over so passthrough gets
 * back exactly what it had.
 */
export function setPavilionView(world: World, view: 'pavilion' | 'passthrough'): void {
  if (!rig) return;
  const renderer = world.renderer;
  const scene = world.scene;
  if (view === 'pavilion') {
    if (priorToneMapping === null) {
      priorToneMapping = renderer.toneMapping;
      priorExposure = renderer.toneMappingExposure;
      priorEnvironment = (scene.environment as Texture | null) ?? null;
    }
    applyRealismRenderer(world, 1.05);
    renderer.shadowMap.needsUpdate = true; // one-shot bake now we're visible
    scene.fog = new Fog('#c8dfeb', 150, 460);
    rig.root.visible = true;
  } else {
    rig.root.visible = false;
    scene.fog = null;
    if (priorToneMapping !== null) {
      renderer.toneMapping = priorToneMapping ?? NoToneMapping;
      renderer.toneMappingExposure = priorExposure;
      scene.environment = priorEnvironment;
    }
  }
}

const _head = new Vector3();

/** Ambient life: water scroll, boats bobbing, clouds drifting/billboarding. */
export function tickPavilion(delta: number, time: number, headWorld: Vector3 | null): void {
  if (!rig || !rig.root.visible) return;
  runTicks(delta, time);
  if (headWorld) _head.copy(headWorld);
  for (const obj of rig.drifters) {
    const d = obj.userData;
    if (d.baseX === undefined) {
      d.baseX = obj.position.x;
      d.baseY = obj.position.y;
      d.baseZ = obj.position.z;
    }
    const phase = (d.phase as number) ?? 0;
    obj.position.y = d.baseY + Math.sin(time * ((d.bobSpeed as number) ?? 0.25) + phase) * ((d.bobAmp as number) ?? 0.4);
    const driftAmp = (d.driftAmp as number) ?? 0;
    if (driftAmp > 0) {
      const driftSpeed = (d.driftSpeed as number) ?? 0.04;
      obj.position.x = d.baseX + Math.sin(time * driftSpeed + phase) * driftAmp;
      obj.position.z = d.baseZ + Math.cos(time * driftSpeed * 0.7 + phase) * driftAmp;
    }
    if (d.swayAmp) {
      obj.rotation.z = Math.sin(time * ((d.swaySpeed as number) ?? 0.4) + phase) * (d.swayAmp as number);
    }
    if (d.billboard && headWorld) {
      obj.rotation.y = Math.atan2(_head.x - obj.position.x, _head.z - obj.position.z);
    }
  }
}

// ----------------------------------------------------------------------------
// Floor: flat oak deck across the hall + acrylic play pad (no pit, no court)
// ----------------------------------------------------------------------------

function buildFloor(root: Group): void {
  const oak = woodPlanks('#8a6138');
  const deckMat = new MeshStandardMaterial({
    map: oak.map,
    normalMap: oak.normalMap,
    roughnessMap: oak.roughnessMap,
    roughness: 1,
  });
  const g = new PlaneGeometry(HALL.hx * 2, HALL.hz * 2);
  g.rotateX(-Math.PI / 2);
  scaleUV(g, (HALL.hx * 2) / 1.35, (HALL.hz * 2) / 4.2);
  const deck = new Mesh(g, deckMat);
  // Sits nearly a full pedestal below the game's floor plane so the octagon
  // platforms (tops at y = 0, the real floor you stand on) rise almost their
  // whole height out of it — matching how they read as raised plinths in
  // passthrough, where there's no floor under them at all.
  deck.position.y = -0.125;
  deck.receiveShadow = true;
  root.add(deck);

  // Acrylic play pad under the TWOT court (goal + arc + fence footprint).
  const pad = acrylic('#2e7fae');
  const padMat = new MeshStandardMaterial({
    map: pad.map,
    roughnessMap: pad.roughnessMap,
    roughness: 1,
  });
  const padMesh = new Mesh(new PlaneGeometry(17, 10.5), padMat);
  padMesh.rotation.x = -Math.PI / 2;
  // Covers arena-local z −3.5…+7 (goal, fence, whole arc) → pavilion-local.
  // A whisker above the deck, so the platforms rise out of the play surface.
  padMesh.position.set(0, -0.118, -8.75);
  padMesh.receiveShadow = true;
  root.add(padMesh);
}

// ----------------------------------------------------------------------------
// Structure, glazing, kicker — the hall itself (unchanged from vrenv)
// ----------------------------------------------------------------------------

function archCurvePoints(offset = 0): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = -HALL.hx + (i / 24) * HALL.hx * 2;
    pts.push(new Vector3(x, archY(x) + offset, 0));
  }
  return pts;
}

function buildStructure(root: Group): void {
  const whitePaint = paintedMetal(WHITE_STEEL);
  const whiteMat = new MeshStandardMaterial({
    map: whitePaint.map,
    roughnessMap: whitePaint.roughnessMap,
    roughness: 1,
    metalness: 0.25,
  });
  const tealPaint = paintedMetal(TEAL);
  const tealMat = new MeshStandardMaterial({
    map: tealPaint.map,
    roughnessMap: tealPaint.roughnessMap,
    roughness: 1,
    metalness: 0.35,
  });

  const curve = new CatmullRomCurve3(archCurvePoints());
  const ribs: Mesh[] = [];
  for (const z of RIB_ZS) {
    const rib = new Mesh(new TubeGeometry(curve, 40, 0.11, 10), whiteMat);
    rib.position.z = z;
    ribs.push(rib);
  }
  root.add(mergeInto(whiteMat, ribs));

  const tealParts: Mesh[] = [];
  for (let i = 1; i < 12; i++) {
    const x = -HALL.hx + (i / 12) * HALL.hx * 2;
    const p = new Mesh(new CylinderGeometry(0.045, 0.045, HALL.hz * 2, 8), tealMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(x, archY(x) - 0.02, 0);
    tealParts.push(p);
  }
  for (const sx of [-1, 1]) {
    const beam = new Mesh(new BoxGeometry(0.2, 0.24, HALL.hz * 2), tealMat);
    beam.position.set(sx * (HALL.hx - 0.06), HALL.eaves - 0.08, 0);
    tealParts.push(beam);
    for (const z of RIB_ZS) {
      const zc = Math.max(-HALL.hz + 0.4, Math.min(HALL.hz - 0.4, z));
      const col = new Mesh(new CylinderGeometry(0.09, 0.11, HALL.eaves, 12), tealMat);
      col.position.set(sx * (HALL.hx - 0.26), HALL.eaves / 2, zc);
      tealParts.push(col);
    }
  }
  for (const sx of [-1, 1]) {
    const x = sx * (HALL.hx - 0.1);
    for (let i = 0; i <= 16; i++) {
      const z = Math.max(-HALL.hz + 0.05, Math.min(HALL.hz - 0.05, -HALL.hz + (i * HALL.hz * 2) / 16));
      const m = new Mesh(new BoxGeometry(0.06, HALL.eaves - HALL.low, 0.06), tealMat);
      m.position.set(x, (HALL.eaves + HALL.low) / 2, z);
      tealParts.push(m);
    }
    const transom = new Mesh(new BoxGeometry(0.07, 0.06, HALL.hz * 2), tealMat);
    transom.position.set(x, 2.55, 0);
    tealParts.push(transom);
  }
  for (const sz of [-1, 1]) {
    const z = sz * (HALL.hz - 0.1);
    for (let i = 0; i <= 12; i++) {
      const x = Math.max(-HALL.hx + 0.05, Math.min(HALL.hx - 0.05, -HALL.hx + (i * HALL.hx * 2) / 12));
      const h = archY(x) - 0.25;
      const m = new Mesh(new BoxGeometry(0.06, h - HALL.low, 0.06), tealMat);
      m.position.set(x, (h + HALL.low) / 2, z);
      tealParts.push(m);
    }
    const transom = new Mesh(new BoxGeometry(HALL.hx * 2, 0.06, 0.07), tealMat);
    transom.position.set(0, 2.55, z);
    tealParts.push(transom);
  }
  root.add(mergeInto(tealMat, tealParts));
}

function glassMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: '#cfe6ec',
    transparent: true,
    opacity: 0.18,
    roughness: 0.06,
    metalness: 0,
    side: DoubleSide,
    envMapIntensity: 1.5,
    // Glass must never occlude: with depthWrite on, whenever a pane sorted
    // in front of the ball it stamped the depth buffer and a lobbed ball
    // vanished above the roof. It's 18% glass — you can see through it.
    depthWrite: false,
  });
}

function buildGlazing(root: Group): void {
  const mat = glassMaterial();

  const N = 30;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = -HALL.hx + (i / N) * HALL.hx * 2;
    const y = archY(x) + 0.1;
    positions.push(x, y, -HALL.hz, x, y, HALL.hz);
    uvs.push(i / N, 0, i / N, 1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const vault = new BufferGeometry();
  vault.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  vault.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  vault.setIndex(indices);
  vault.computeVertexNormals();
  root.add(new Mesh(vault, mat));

  for (const sx of [-1, 1]) {
    const pane = new Mesh(new PlaneGeometry(HALL.hz * 2, HALL.eaves - HALL.low), mat);
    pane.rotation.y = (sx * -Math.PI) / 2;
    pane.position.set(sx * (HALL.hx - 0.1), (HALL.eaves + HALL.low) / 2, 0);
    root.add(pane);
  }
  for (const sz of [-1, 1]) {
    const M = 26;
    const gp: number[] = [];
    const guv: number[] = [];
    const gi: number[] = [];
    for (let i = 0; i <= M; i++) {
      const x = -HALL.hx + (i / M) * HALL.hx * 2;
      gp.push(x, HALL.low, 0, x, archY(x) - 0.22, 0);
      guv.push(i / M, 0, i / M, 1);
    }
    for (let i = 0; i < M; i++) {
      const a = i * 2;
      gi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const gable = new BufferGeometry();
    gable.setAttribute('position', new BufferAttribute(new Float32Array(gp), 3));
    gable.setAttribute('uv', new BufferAttribute(new Float32Array(guv), 2));
    gable.setIndex(gi);
    gable.computeVertexNormals();
    const mesh = new Mesh(gable, mat);
    mesh.position.z = sz * (HALL.hz - 0.1);
    root.add(mesh);
  }
}

function buildKicker(root: Group): void {
  const mural = muralWall();
  const mat = new MeshStandardMaterial({
    map: mural.map,
    roughnessMap: mural.roughnessMap,
    roughness: 1,
  });
  const walls: Mesh[] = [];
  const mk = (w: number, x: number, z: number, ry: number) => {
    const g = scaleUV(new BoxGeometry(w, HALL.low, 0.16), w / 16, 1);
    const m = new Mesh(g, mat);
    m.position.set(x, HALL.low / 2, z);
    m.rotation.y = ry;
    walls.push(m);
  };
  mk(HALL.hx * 2, 0, -HALL.hz + 0.1, 0);
  mk(HALL.hz * 2, -HALL.hx + 0.1, 0, Math.PI / 2);
  mk(HALL.hz * 2, HALL.hx - 0.1, 0, -Math.PI / 2);
  const doorHalf = 1.35;
  const southW = HALL.hx - doorHalf;
  mk(southW, -(doorHalf + southW / 2), HALL.hz - 0.1, Math.PI);
  mk(southW, doorHalf + southW / 2, HALL.hz - 0.1, Math.PI);
  root.add(mergeInto(mat, walls));

  const frameMat = new MeshStandardMaterial({ color: '#1d616e', roughness: 0.5, metalness: 0.4 });
  const frames: Mesh[] = [];
  for (const sx of [-doorHalf, doorHalf]) {
    const f = new Mesh(new BoxGeometry(0.12, 2.4, 0.18), frameMat);
    f.position.set(sx, 1.2, HALL.hz - 0.1);
    frames.push(f);
  }
  const header = new Mesh(new BoxGeometry(doorHalf * 2 + 0.24, 0.16, 0.2), frameMat);
  header.position.set(0, 2.46, HALL.hz - 0.1);
  frames.push(header);
  const mid = new Mesh(new BoxGeometry(0.08, 2.4, 0.1), frameMat);
  mid.position.set(0, 1.2, HALL.hz - 0.1);
  frames.push(mid);
  root.add(mergeInto(frameMat, frames));
}

// ----------------------------------------------------------------------------
// Furnishings: benches, planters, banners + the LIVE TWOT scoreboard
// ----------------------------------------------------------------------------

function buildFurnishings(root: Group): { canvas: HTMLCanvasElement; texture: CanvasTexture } {
  const oak = woodPlanks('#96703f', 4, 512);
  const slatMat = new MeshStandardMaterial({
    map: oak.map,
    normalMap: oak.normalMap,
    roughness: 0.8,
  });
  const frameMat = new MeshStandardMaterial({ color: '#26343a', roughness: 0.45, metalness: 0.7 });

  const woodParts: Mesh[] = [];
  const steelParts: Mesh[] = [];
  const benchAt = (x: number, z: number, ry: number) => {
    const g = new Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.updateMatrixWorld(true);
    const local = (mesh: Mesh, lx: number, ly: number, lz: number, list: Mesh[]) => {
      mesh.position.set(lx, ly, lz).applyMatrix4(g.matrixWorld);
      mesh.rotation.y = ry;
      list.push(mesh);
    };
    for (const dz of [-0.14, 0.02, 0.18]) {
      local(new Mesh(scaleUV(new BoxGeometry(1.9, 0.045, 0.13), 2, 0.3), slatMat), 0, 0.46, dz, woodParts);
    }
    for (const dz of [0.1, 0.24]) {
      local(new Mesh(scaleUV(new BoxGeometry(1.9, 0.045, 0.12), 2, 0.3), slatMat), 0, 0.62 + dz, -0.3, woodParts);
    }
    for (const sx of [-0.82, 0.82]) {
      local(new Mesh(new BoxGeometry(0.05, 0.46, 0.42), frameMat), sx, 0.23, 0, steelParts);
      local(new Mesh(new BoxGeometry(0.05, 0.5, 0.05), frameMat), sx, 0.66, -0.3, steelParts);
    }
  };
  benchAt(-10.6, -3.5, Math.PI / 2);
  benchAt(-10.6, 3.5, Math.PI / 2);
  benchAt(10.6, -3.5, -Math.PI / 2);
  benchAt(10.6, 3.5, -Math.PI / 2);
  benchAt(-5.5, -14.8, 0);
  benchAt(5.5, -14.8, 0);
  root.add(mergeInto(slatMat, woodParts));
  root.add(mergeInto(frameMat, steelParts));

  const conc = concreteTexture();
  const planterMat = new MeshStandardMaterial({
    map: conc.map,
    normalMap: conc.normalMap,
    roughness: 0.95,
  });
  const bushLeaf = leafage('#26451d', '#7cb23e');
  const bushMat = new MeshStandardMaterial({
    map: bushLeaf.map,
    roughnessMap: bushLeaf.roughnessMap,
    roughness: 1,
    vertexColors: true,
  });
  const planters: Mesh[] = [];
  const bushes: Mesh[] = [];
  const planterAt = (x: number, z: number) => {
    const box = new Mesh(new BoxGeometry(1.5, 0.5, 0.5), planterMat);
    box.position.set(x, 0.25, z);
    planters.push(box);
    for (let i = 0; i < 3; i++) {
      const bx = x - 0.5 + i * 0.5;
      bushes.push(leafClump(bx + rand(-0.05, 0.05), 0.66, z + rand(-0.05, 0.05), rand(0.2, 0.3), rand));
    }
  };
  planterAt(-6, -16.35);
  planterAt(6, -16.35);
  planterAt(-12.35, -8);
  planterAt(-12.35, 8);
  planterAt(12.35, -8);
  planterAt(12.35, 8);
  root.add(mergeInto(planterMat, planters));
  const bushMesh = mergeInto(bushMat, bushes);
  bushMesh.castShadow = true;
  root.add(bushMesh);

  // Hanging banners (printed fabric) — aero-adjacent colours.
  const art1 = bannerArt('#29b6f6', '#9be82a');
  const art2 = bannerArt('#ffb226', '#ff7ac8');
  const bannerMat1 = new MeshStandardMaterial({ map: art1, side: DoubleSide, roughness: 0.9 });
  const bannerMat2 = new MeshStandardMaterial({ map: art2, side: DoubleSide, roughness: 0.9 });
  const b1: Mesh[] = [];
  const b2: Mesh[] = [];
  for (const sx of [-1, 1]) {
    RIB_ZS.filter((z) => Math.abs(z) > 2 && Math.abs(z) < 15).forEach((z, i) => {
      const m = new Mesh(new PlaneGeometry(0.85, 2.3), i % 2 ? bannerMat2 : bannerMat1);
      m.position.set(sx * (HALL.hx - 0.8), 4.55, z);
      m.rotation.y = (sx * -Math.PI) / 2;
      m.castShadow = true;
      (i % 2 ? b2 : b1).push(m);
    });
  }
  root.add(mergeInto(bannerMat1, b1));
  root.add(mergeInto(bannerMat2, b2));

  // The LED scoreboard — now a LIVE TWOT feed. Stands beyond the fence on
  // the keeper's left, angled back at the court, scaled up to read from
  // the arc. PavilionSystem redraws the canvas.
  const canvas = document.createElement('canvas');
  // 2× supersample (logical 640×320) so the feed reads from the arc.
  canvas.width = 1280;
  canvas.height = 640;
  canvas.getContext('2d')!.scale(2, 2);
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  // Canvas pixels are sRGB — sampled as linear they gamma-lift, washing the
  // dark board face out to pale blue.
  texture.colorSpace = SRGBColorSpace;
  // A true LED face: black diffuse + emissive-only, no env reflections —
  // otherwise sunlight and the sky env map wash the dark panel to pale blue.
  const screenMat = new MeshStandardMaterial({
    color: '#000000',
    emissiveMap: texture,
    emissive: new Color('#ffffff'),
    emissiveIntensity: 1.15,
    roughness: 1,
    envMapIntensity: 0,
  });
  const screen = new Mesh(new PlaneGeometry(3.2, 1.6), screenMat);
  const sg = new Group();
  sg.position.set(-8.6, 0, -14.6);
  sg.rotation.y = 0.35;
  sg.scale.setScalar(1.5);
  const frame = new Mesh(new BoxGeometry(3.44, 1.84, 0.12), frameMat);
  frame.position.set(0, 2.5, 0);
  frame.castShadow = true;
  sg.add(frame);
  screen.position.set(0, 2.5, 0.065);
  sg.add(screen);
  for (const sx of [-1.4, 1.4]) {
    const leg = new Mesh(new CylinderGeometry(0.05, 0.06, 3.3, 10), frameMat);
    leg.position.set(sx, 1.65, 0);
    sg.add(leg);
  }
  root.add(sg);
  return { canvas, texture };
}

// ----------------------------------------------------------------------------
// Backdrop: lawn, lake, aprons, trees, hills, mountains (unchanged)
// ----------------------------------------------------------------------------

function groundsY(r: number, wobble: number): number {
  const shore = 54 + wobble * 8;
  let y = -0.35;
  if (r > 24) {
    const t = Math.min((r - 24) / (shore - 24), 1);
    y -= t * t * (3 - 2 * t) * 1.75;
  }
  if (r > shore) {
    const t = Math.min((r - shore) / 10, 1);
    y -= t * t * 0.75;
  }
  return y;
}

function groundsHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(x, z);
  const wobble = noise2(Math.cos(theta) * 2.8 + 7, Math.sin(theta) * 2.8 + 7) - 0.5;
  return groundsY(r, wobble);
}

function buildBackdrop(root: Group): void {
  const grass = grassTexture();
  const lawnMat = new MeshStandardMaterial({
    map: grass.map,
    normalMap: grass.normalMap,
    roughness: 1,
    vertexColors: true,
  });
  {
    const around = 96;
    const rings = [0, 14, 26, 36, 44, 50, 54, 57, 60, 63, 66];
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= around; i++) {
      const theta = ((i % around) / around) * Math.PI * 2;
      const cx = Math.cos(theta);
      const sz = Math.sin(theta);
      const wobble = noise2(cx * 2.8 + 7, sz * 2.8 + 7) - 0.5;
      for (const r of rings) {
        const x = Math.sin(theta) * r;
        const z = Math.cos(theta) * r;
        const y = groundsY(r, wobble);
        positions.push(x, y, z);
        uvs.push(x / 6.7, z / 6.7);
        const shore = 54 + wobble * 8;
        const t = Math.max(0, Math.min((r - shore + 3) / 9, 1));
        const sink = Math.max(0, Math.min((r - shore - 4) / 5, 1));
        colors.push(
          (1 + t * 0.35) * (1 - sink * 0.55),
          (1 + t * 0.18) * (1 - sink * 0.5),
          (1 + t * 0.05) * (1 - sink * 0.5),
        );
      }
    }
    const cols = rings.length;
    for (let i = 0; i < around; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = (i + 1) * cols + j;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const lawn = new Mesh(geom, lawnMat);
    lawn.receiveShadow = true;
    root.add(lawn);
  }

  const ripple = waterNormal();
  ripple.repeat.set(60, 60);
  const waterMat = new MeshStandardMaterial({
    color: '#1c6280',
    roughness: 0.4,
    metalness: 0.08,
    normalMap: ripple,
    envMapIntensity: 0.45,
  });
  waterMat.normalScale.set(0.55, 0.55);
  const water = new Mesh(new PlaneGeometry(600, 600), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -2.35;
  root.add(water);
  const reflect = new Mesh(
    new RingGeometry(118, 168, 72),
    new MeshStandardMaterial({
      color: '#16281e',
      transparent: true,
      opacity: 0.5,
      roughness: 0.55,
    }),
  );
  reflect.rotation.x = -Math.PI / 2;
  reflect.position.y = -2.33;
  root.add(reflect);
  onTick((delta) => {
    ripple.offset.x += delta * 0.006;
    ripple.offset.y += delta * 0.0035;
  });

  const conc = concreteTexture();
  conc.map.repeat.set(10, 1.6);
  const apronMat = new MeshStandardMaterial({
    map: conc.map,
    normalMap: conc.normalMap,
    roughness: 0.95,
  });
  const aprons: Mesh[] = [];
  for (const [w, d, x, z] of [
    [HALL.hx * 2 + 5, 2.5, 0, -(HALL.hz + 1.25)],
    [HALL.hx * 2 + 5, 2.5, 0, HALL.hz + 1.25],
    [2.5, HALL.hz * 2, -(HALL.hx + 1.25), 0],
    [2.5, HALL.hz * 2, HALL.hx + 1.25, 0],
  ] as Array<[number, number, number, number]>) {
    const m = new Mesh(new BoxGeometry(w, 0.22, d), apronMat);
    m.position.set(x, -0.26, z);
    aprons.push(m);
  }
  const slab = new Mesh(new BoxGeometry(HALL.hx * 2, 0.36, HALL.hz * 2), apronMat);
  slab.position.set(0, -0.48, 0);
  aprons.push(slab);
  for (const [w, d, x, z] of [
    [HALL.hx * 2, 0.16, 0, -HALL.hz + 0.08],
    [HALL.hx * 2, 0.16, 0, HALL.hz - 0.08],
    [0.16, HALL.hz * 2, -HALL.hx + 0.08, 0],
    [0.16, HALL.hz * 2, HALL.hx - 0.08, 0],
  ] as Array<[number, number, number, number]>) {
    const skirt = new Mesh(new BoxGeometry(w, 0.4, d), apronMat);
    skirt.position.set(x, -0.18, z);
    aprons.push(skirt);
  }
  root.add(mergeInto(apronMat, aprons, false));

  const bark = barkTexture();
  const trunkMat = new MeshStandardMaterial({
    map: bark.map,
    normalMap: bark.normalMap,
    roughness: 1,
  });
  const leaf = leafage('#274a1e', '#8cc24a');
  const leafMat = new MeshStandardMaterial({
    map: leaf.map,
    roughnessMap: leaf.roughnessMap,
    roughness: 1,
    vertexColors: true,
  });
  const trunks: Mesh[] = [];
  const canopies: Mesh[] = [];
  const treeAt = (x: number, z: number, s: number, y = -0.35) => {
    const parts = leafyTree(x, y, z, s, rand);
    trunks.push(...parts.trunk);
    canopies.push(...parts.canopy);
  };
  for (let i = 0; i < 22; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(24, 46);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (Math.abs(x) < HALL.hx + 5 && Math.abs(z) < HALL.hz + 5) continue;
    treeAt(x, z, rand(0.8, 1.7), groundsHeight(x, z) - 0.05);
  }
  for (let i = 0; i < 9; i++) {
    const x = rand(-26, 26);
    const z = -HALL.hz - rand(7, 22);
    treeAt(x, z, rand(1.0, 1.9), groundsHeight(x, z) - 0.05);
  }
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(128, 158);
    treeAt(Math.sin(a) * r, Math.cos(a) * r, rand(2.6, 4.2), -2.55);
  }
  root.add(mergeInto(trunkMat, trunks));
  const canopyMesh = mergeInto(leafMat, canopies);
  canopyMesh.castShadow = true;
  root.add(canopyMesh);

  root.add(
    mountainRange({
      crestRadius: 175,
      halfWidth: 48,
      maxHeight: 30,
      baseY: -2.5,
      seed: 7,
      forest: '#3c6432',
      rock: '#5a8a4a',
      snow: '#ffffff',
      snowLine: 1.5,
    }),
  );
  root.add(
    mountainRange({
      crestRadius: 235,
      halfWidth: 58,
      maxHeight: 85,
      baseY: -0.6,
      seed: 3,
      forest: '#2c4a26',
      rock: '#6b645c',
      snow: '#eef3f5',
      snowLine: 0.7,
    }),
  );
}

/** Little sailboats out on the lake, drifting slowly. */
function buildBoats(root: Group, drifters: Object3D[]): void {
  const hullMat = new MeshStandardMaterial({ color: '#f2efe6', roughness: 0.5 });
  const trimMat = new MeshStandardMaterial({ color: '#7e3c22', roughness: 0.7 });
  const sailMat = new MeshStandardMaterial({
    color: '#fbfaf4',
    roughness: 0.85,
    side: DoubleSide,
  });
  const specs: Array<[number, number, number, string]> = [
    [64, -78, 0.9, '#c62f3e'],
    [-88, -46, 1.15, '#2e6fb2'],
    [96, 34, 1.0, '#e8a13a'],
  ];
  for (const [x, z, s, accent] of specs) {
    const g = new Group();
    const hull = new Mesh(new SphereGeometry(1.5 * s, 14, 10), hullMat);
    hull.scale.set(0.42, 0.28, 1);
    g.add(hull);
    const stripe = new Mesh(
      new SphereGeometry(1.52 * s, 14, 10),
      new MeshStandardMaterial({ color: accent, roughness: 0.6 }),
    );
    stripe.scale.set(0.43, 0.12, 1.01);
    stripe.position.y = 0.12 * s;
    g.add(stripe);
    const mast = new Mesh(new CylinderGeometry(0.03 * s, 0.04 * s, 3.4 * s, 8), trimMat);
    mast.position.y = 1.9 * s;
    g.add(mast);
    const sail = new Mesh(new CylinderGeometry(0.02, 1.15 * s, 2.8 * s, 3), sailMat);
    sail.scale.z = 0.06;
    sail.position.set(0.02, 2.0 * s, -0.55 * s);
    sail.rotation.y = Math.PI / 6;
    g.add(sail);
    const jib = new Mesh(new CylinderGeometry(0.02, 0.7 * s, 2.0 * s, 3), sailMat);
    jib.scale.z = 0.06;
    jib.position.set(0, 1.6 * s, 0.85 * s);
    g.add(jib);
    g.position.set(x, -2.22, z);
    g.rotation.y = rand(0, Math.PI * 2);
    g.userData = {
      bobAmp: 0.06,
      bobSpeed: 0.5,
      driftAmp: rand(4, 9),
      driftSpeed: 0.01,
      swayAmp: 0.035,
      swaySpeed: 0.45,
      phase: rand(0, 6),
    };
    root.add(g);
    drifters.push(g);
  }
}

function buildClouds(root: Group, drifters: Object3D[]): void {
  const tex = cloudCard('#ffffff');
  const mat = new MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    roughness: 1,
    emissive: new Color('#ffffff'),
    emissiveIntensity: 0.35,
  });
  for (let i = 0; i < 5; i++) {
    const m = new Mesh(new PlaneGeometry(rand(50, 90), rand(16, 26)), mat);
    const a = rand(0, Math.PI * 2);
    m.position.set(Math.sin(a) * rand(120, 220), rand(55, 95), Math.cos(a) * rand(120, 220));
    m.rotation.y = -a;
    m.userData = {
      bobAmp: 0.8,
      bobSpeed: 0.04,
      driftAmp: rand(6, 12),
      driftSpeed: 0.006,
      phase: rand(0, 6),
      billboard: true,
    };
    root.add(m);
    drifters.push(m);
  }
}

function buildLights(root: Group): void {
  const sun = new DirectionalLight('#fff1d8', 2.6);
  sun.position.set(SKY.sunDirection.x * 90, SKY.sunDirection.y * 90, SKY.sunDirection.z * 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  // Half-strength shadows: the hall's arch ribs throw big bands across the
  // court, and at full darkness they read as a hard "everything is darker
  // past this line" edge instead of soft indoor shading.
  sun.shadow.intensity = 0.45;
  root.add(sun);
  root.add(sun.target);
}
