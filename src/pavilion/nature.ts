/**
 * nature.ts
 *
 * Shared organic scenery for the realistic environments:
 *
 *  - `mountainRange`: one continuous noise-displaced ridge ring encircling
 *    the scene — a panoramic mountain *range* with varied peaks instead of
 *    discrete cones, with forest/rock/snow vertex coloring and an optional
 *    dip (lowered crest) toward a chosen azimuth so a sunset stays visible.
 *  - `leafyTree` / `pineTree`: volumetric trees built from noise-displaced
 *    geometry (icosahedral leaf clumps, ragged cone tiers) with opaque
 *    tiling foliage textures. No billboard cards — they hold up in VR
 *    stereo and never erode under alpha-test mipmapping.
 *
 * Tree functions return bare meshes for the caller to batch-merge, so an
 * entire forest still costs a couple of draw calls.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { rockTexture } from './textures.js';

// Deterministic smooth value noise (shared flavor of the cove's terrain fn).
function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 10000) / 10000;
}
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// ----------------------------------------------------------------------------
// Mountain range ring
// ----------------------------------------------------------------------------

export interface RangeOptions {
  /** Radius of the ridge crest line. */
  crestRadius: number;
  /** Half-width of the range footprint (feet to crest). */
  halfWidth: number;
  /** Tallest peaks reach roughly this height. */
  maxHeight: number;
  /** Ground level the feet sit at. */
  baseY: number;
  /** Noise seed offset so different scenes get different skylines. */
  seed?: number;
  /** Azimuth (atan2(x, z)) where the crest dips low, e.g. toward a sunset. */
  dipAzimuth?: number;
  /** How far the dip drops the crest (0..1 of local height). */
  dipDepth?: number;
  /** Vertex-color ramp. */
  forest?: string;
  rock?: string;
  snow?: string;
  /** Height fraction where snow starts. */
  snowLine?: number;
}

/**
 * A ring heightfield: `around` columns × radial rows, crest in the middle.
 * Peak heights come from seamless fbm sampled on a circle, so the skyline
 * wanders naturally — shoulders, saddles, and summits instead of pyramids.
 */
export function mountainRange(opts: RangeOptions): Mesh {
  const around = 260;
  const rows = 7; // feet → crest → feet
  const seed = opts.seed ?? 0;
  const dipDepth = opts.dipDepth ?? 0;
  const snowLine = opts.snowLine ?? 0.6;
  const cForest = new Color(opts.forest ?? '#2c4426');
  const cRock = new Color(opts.rock ?? '#6e6862');
  const cSnow = new Color(opts.snow ?? '#eef2f4');

  // Crest height per column, from fbm sampled on a circle (seamless wrap).
  const peak = (theta: number): number => {
    const cx = Math.cos(theta);
    const sz = Math.sin(theta);
    const f =
      noise2(cx * 2.1 + 9 + seed, sz * 2.1 + 9) * 0.55 +
      noise2(cx * 5.3 + 21 + seed, sz * 5.3 + 21) * 0.3 +
      noise2(cx * 11.7 + 40 + seed, sz * 11.7 + 40) * 0.15;
    let h = opts.maxHeight * (0.22 + 0.95 * f);
    if (opts.dipAzimuth !== undefined && dipDepth > 0) {
      let d = theta - opts.dipAzimuth;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to [-π, π]
      const window = Math.max(0, 1 - (d / 0.55) ** 2);
      h *= 1 - dipDepth * window;
    }
    return h;
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tmp = new Color();

  for (let i = 0; i <= around; i++) {
    // Last column duplicates the first so the ring closes cleanly.
    const theta = ((i % around) / around) * Math.PI * 2;
    const colPeak = peak(theta);
    for (let j = 0; j < rows; j++) {
      const t = j / (rows - 1); // 0 inner foot … 1 outer foot
      const acrossProfile = Math.sin(t * Math.PI) ** 1.25; // 0 at feet, 1 at crest
      // Radial position, wobbled so the range foot meanders.
      const wobble =
        (noise2(Math.cos(theta) * 3.6 + 60 + seed, Math.sin(theta) * 3.6 + j) - 0.5) *
        opts.halfWidth *
        0.5;
      const r = opts.crestRadius + (t - 0.5) * 2 * opts.halfWidth + wobble;
      // Height plus small-scale relief so slopes aren't glassy.
      const relief =
        (noise2(Math.cos(theta) * 9 + j * 2.3 + seed, Math.sin(theta) * 9 + j) - 0.5) *
        colPeak *
        0.22 *
        acrossProfile;
      const h = Math.max(0, colPeak * acrossProfile + relief);
      const x = Math.sin(theta) * r;
      const z = Math.cos(theta) * r;
      positions.push(x, opts.baseY + h, z);
      uvs.push((i / around) * 40, t * 6);

      // Color ramp by height fraction with noisy transitions. The rock map
      // multiplies these (average luminance ≈ 0.45), so compensate to keep
      // the authored tones on screen.
      const TEX_COMP = 2.2;
      const frac = h / (opts.maxHeight * 1.1);
      const jitter = (noise2(x * 0.12, z * 0.12) - 0.5) * 0.18;
      const f = frac + jitter;
      if (f > snowLine) {
        const k = Math.min(1, (f - snowLine) / 0.16);
        tmp.copy(cRock).lerp(cSnow, k);
      } else {
        const k = Math.min(1, Math.max(0, (f - 0.06) / 0.3));
        tmp.copy(cForest).lerp(cRock, k);
      }
      colors.push(tmp.r * TEX_COMP, tmp.g * TEX_COMP, tmp.b * TEX_COMP);
    }
  }
  for (let i = 0; i < around; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = (i + 1) * rows + j;
      // Wound so faces (and computed normals) point up/outward.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const rock = rockTexture();
  const mat = new MeshStandardMaterial({
    map: rock.map,
    normalMap: rock.normalMap,
    roughness: 1,
    vertexColors: true,
  });
  const mesh = new Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// ----------------------------------------------------------------------------
// Volumetric trees
// ----------------------------------------------------------------------------

type Rng = (min: number, max: number) => number;

function scaleUVs(geom: BufferGeometry, s: number): void {
  const uv = geom.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  }
}

/** One displaced, vertically-shaded leaf clump (also good for shrubs). */
export function leafClump(
  cx: number,
  cy: number,
  cz: number,
  r: number,
  rng: Rng,
  tint = 1,
): Mesh {
  const geom = new IcosahedronGeometry(r, 2);
  const pos = geom.getAttribute('position');
  const off = rng(0, 90);
  for (let v = 0; v < pos.count; v++) {
    const px = pos.getX(v);
    const py = pos.getY(v);
    const pz = pos.getZ(v);
    const f = 1 + (noise2((px / r) * 1.6 + off, ((py + pz) / r) * 1.6) - 0.5) * 0.5;
    pos.setXYZ(v, px * f, py * f * 0.85, pz * f);
  }
  // Canopy shading baked into vertex colors: lit crown, occluded underside.
  const colors = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const t = (pos.getY(v) / r + 1) / 2;
    const k = (0.45 + 0.75 * t) * tint;
    colors[v * 3] = k;
    colors[v * 3 + 1] = k;
    colors[v * 3 + 2] = k;
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  scaleUVs(geom, Math.max(1.5, r * 2.2));
  geom.computeVertexNormals();
  const clump = new Mesh(geom);
  clump.position.set(cx, cy, cz);
  return clump;
}

/**
 * Broadleaf tree: tapered trunk + a couple of branches + 4-6 displaced leaf
 * clumps. Returns parts for the caller to merge (trunk batch / canopy batch).
 */
export function leafyTree(
  x: number,
  y: number,
  z: number,
  s: number,
  rng: Rng,
): { trunk: Mesh[]; canopy: Mesh[] } {
  const trunk: Mesh[] = [];
  const canopy: Mesh[] = [];

  const stem = new Mesh(new CylinderGeometry(0.08 * s, 0.15 * s, 1.7 * s, 8));
  stem.position.set(x, y + 0.85 * s, z);
  stem.rotation.y = rng(0, Math.PI);
  trunk.push(stem);
  for (let b = 0; b < 2; b++) {
    const branch = new Mesh(new CylinderGeometry(0.03 * s, 0.055 * s, 0.9 * s, 6));
    const a = rng(0, Math.PI * 2);
    branch.position.set(
      x + Math.sin(a) * 0.3 * s,
      y + 1.7 * s,
      z + Math.cos(a) * 0.3 * s,
    );
    branch.rotation.set(Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7);
    trunk.push(branch);
  }

  const crownY = y + 2.1 * s;
  const clumps = 4 + Math.floor(rng(0, 2.4));
  for (let c = 0; c < clumps; c++) {
    const a = rng(0, Math.PI * 2);
    const rr = rng(0, 0.55) * s;
    canopy.push(
      leafClump(
        x + Math.sin(a) * rr,
        crownY + rng(-0.3, 0.45) * s,
        z + Math.cos(a) * rr,
        rng(0.55, 0.9) * s,
        rng,
        rng(0.9, 1.1),
      ),
    );
  }
  // A crowning clump keeps the silhouette rounded.
  canopy.push(leafClump(x, crownY + 0.55 * s, z, 0.62 * s, rng, rng(1.0, 1.15)));
  return { trunk, canopy };
}

/**
 * Conifer: tapered trunk + 3 ragged, drooped cone tiers with baked
 * rim-lighting in vertex colors.
 */
export function pineTree(
  x: number,
  y: number,
  z: number,
  s: number,
  rng: Rng,
): { trunk: Mesh[]; canopy: Mesh[] } {
  const trunk: Mesh[] = [];
  const canopy: Mesh[] = [];

  const stem = new Mesh(new CylinderGeometry(0.06 * s, 0.13 * s, 1.2 * s, 8));
  stem.position.set(x, y + 0.6 * s, z);
  trunk.push(stem);

  const tiers: Array<[number, number, number]> = [
    [1.15, 1.5, 0.55],
    [0.88, 1.3, 1.35],
    [0.58, 1.15, 2.15],
  ];
  const off = rng(0, 60);
  for (const [radius, height, base] of tiers) {
    const geom = new CylinderGeometry(0.03 * s, radius * s, height * s, 10, 3);
    const pos = geom.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v);
      const py = pos.getY(v);
      const pz = pos.getZ(v);
      const ang = Math.atan2(px, pz);
      const radial = Math.hypot(px, pz) / (radius * s); // 0 axis … 1 rim
      const n = noise2(Math.cos(ang) * 2.4 + off, Math.sin(ang) * 2.4 + py / s);
      const f = 1 + (n - 0.5) * 0.5 * radial;
      // Rim droop gives the boughs their hanging look.
      const droop = radial * radial * 0.16 * s * (0.6 + n);
      pos.setXYZ(v, px * f, py - droop, pz * f);
      const k = 0.5 + 0.7 * radial + (n - 0.5) * 0.25;
      colors[v * 3] = k;
      colors[v * 3 + 1] = k;
      colors[v * 3 + 2] = k;
    }
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    scaleUVs(geom, Math.max(1.5, radius * s * 2));
    geom.computeVertexNormals();
    const tier = new Mesh(geom);
    tier.position.set(x, y + (base + height / 2) * s, z);
    tier.rotation.y = rng(0, Math.PI * 2);
    canopy.push(tier);
  }
  return { trunk, canopy };
}
