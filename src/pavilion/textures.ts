/**
 * textures.ts
 *
 * Procedural texture kitchen for the realistic environments. Everything is
 * painted into offscreen canvases at load time — wood grain, sport acrylic,
 * terrain splats, foliage alpha cards, cloud billboards, banner art — so the
 * project still ships zero external assets while materials read as real
 * surfaces under PBR lighting.
 *
 * Conventions:
 *  - albedo canvases become sRGB textures (`colorSpace = SRGBColorSpace`)
 *  - normal / roughness maps stay linear
 *  - noise is layered "smooth noise": small random canvases upscaled with
 *    bilinear filtering, composited over each other (cheap, tileable enough)
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';

export interface TextureSet {
  map: Texture;
  normalMap?: Texture;
  roughnessMap?: Texture;
}

function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

let seed = 1234;
export function srand(s: number): void {
  seed = s >>> 0;
}
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
const R = (min: number, max: number) => min + (max - min) * rnd();

/** Layered smooth noise painted over whatever is already on the canvas. */
function addNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cells: number,
  alpha: number,
  dark = '#000000',
  light = '#ffffff',
): void {
  const [n, nctx] = makeCanvas(cells, Math.max(1, Math.round((cells * h) / w)));
  const img = nctx.createImageData(n.width, n.height);
  const cd = new Color(dark);
  const cl = new Color(light);
  for (let i = 0; i < img.data.length; i += 4) {
    const t = rnd();
    img.data[i] = ((cd.r + (cl.r - cd.r) * t) * 255) | 0;
    img.data[i + 1] = ((cd.g + (cl.g - cd.g) * t) * 255) | 0;
    img.data[i + 2] = ((cd.b + (cl.b - cd.b) * t) * 255) | 0;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  // 2x2 tiling of the small canvas hides the upscale pattern a little.
  ctx.drawImage(n, 0, 0, w, h);
  ctx.restore();
}

/** Multi-octave mottling: a few noise layers at increasing frequency. */
function addFbm(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  baseCells: number,
  alpha: number,
  dark?: string,
  light?: string,
): void {
  addNoise(ctx, w, h, baseCells, alpha, dark, light);
  addNoise(ctx, w, h, baseCells * 3, alpha * 0.55, dark, light);
  addNoise(ctx, w, h, baseCells * 9, alpha * 0.3, dark, light);
}

export function canvasTexture(
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number } = {},
): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  if (opts.srgb) tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  return tex;
}

/** Sobel height→normal conversion for canvases painted as height maps. */
export function normalFromHeight(height: HTMLCanvasElement, strength = 1): HTMLCanvasElement {
  const w = height.width;
  const h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h);
  const [out, octx] = makeCanvas(w, h);
  const dst = octx.createImageData(w, h);
  const lum = (x: number, y: number) => {
    const xx = (x + w) % w;
    const yy = (y + h) % h;
    return src.data[(yy * w + xx) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      dst.data[i] = ((-dx * inv * 0.5 + 0.5) * 255) | 0;
      dst.data[i + 1] = ((-dy * inv * 0.5 + 0.5) * 255) | 0;
      dst.data[i + 2] = ((inv * 0.5 + 0.5) * 255) | 0;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// ----------------------------------------------------------------------------
// Wood
// ----------------------------------------------------------------------------

/**
 * Plank flooring: vertical boards with tone variation, grain streaks, knots,
 * and seams. Returns albedo + normal (seams/grain relief) + roughness.
 */
export function woodPlanks(
  base = '#9a6b40',
  planks = 8,
  size = 1024,
): TextureSet {
  const [c, ctx] = makeCanvas(size);
  const [hc, hctx] = makeCanvas(size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);

  const pw = size / planks;
  const baseColor = new Color(base);
  for (let p = 0; p < planks; p++) {
    const tone = R(-0.14, 0.12);
    const col = baseColor.clone().offsetHSL(R(-0.01, 0.01), R(-0.05, 0.05), tone);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.fillRect(p * pw, 0, pw + 1, size);

    // Grain: long, slightly wavy strokes along the plank.
    for (let g = 0; g < 26; g++) {
      const gx = p * pw + R(2, pw - 2);
      const grainCol = col.clone().offsetHSL(0, R(-0.04, 0.02), R(-0.16, -0.04));
      ctx.strokeStyle = `#${grainCol.getHexString()}`;
      ctx.globalAlpha = R(0.2, 0.5);
      ctx.lineWidth = R(0.7, 2.2);
      ctx.beginPath();
      const wob = R(1.5, 5);
      ctx.moveTo(gx + R(-2, 2), 0);
      for (let y = 0; y <= size; y += size / 8) {
        ctx.lineTo(gx + Math.sin(y * 0.01 + g) * wob, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // The odd knot.
    if (rnd() < 0.5) {
      const kx = p * pw + R(pw * 0.25, pw * 0.75);
      const ky = R(size * 0.1, size * 0.9);
      const kr = R(4, 9);
      for (let ring = 4; ring >= 1; ring--) {
        const kcol = col.clone().offsetHSL(0, 0, -0.08 * ring);
        ctx.fillStyle = `#${kcol.getHexString()}`;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr * ring * 0.35, kr * ring * 0.5, 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Seam lines (dark in albedo, grooves in height).
    ctx.fillStyle = 'rgba(30,18,8,0.55)';
    ctx.fillRect(p * pw - 1, 0, 2, size);
    hctx.fillStyle = '#585858';
    hctx.fillRect(p * pw - 2, 0, 4, size);
    // Board end joints at random heights.
    const jy = R(0, size);
    ctx.fillStyle = 'rgba(30,18,8,0.4)';
    ctx.fillRect(p * pw, jy, pw, 2);
    hctx.fillStyle = '#606060';
    hctx.fillRect(p * pw, jy - 1, pw, 3);
  }
  addFbm(ctx, size, size, 24, 0.06);
  addFbm(hctx, size, size, 40, 0.12);

  const [rc, rctx] = makeCanvas(size);
  rctx.fillStyle = '#9d9d9d';
  rctx.fillRect(0, 0, size, size);
  addFbm(rctx, size, size, 24, 0.18);

  return {
    map: canvasTexture(c, { srgb: true }),
    normalMap: canvasTexture(normalFromHeight(hc, 1.4)),
    roughnessMap: canvasTexture(rc),
  };
}

// ----------------------------------------------------------------------------
// Sport surfaces
// ----------------------------------------------------------------------------

/** Fine-speckled acrylic sport surface in a single color. */
export function acrylic(color: string, size = 512): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  addFbm(ctx, size, size, 32, 0.1);
  // Sand-grain speckle.
  for (let i = 0; i < 4200; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(R(0, size), R(0, size), 1.3, 1.3);
  }
  const [rc, rctx] = makeCanvas(size);
  rctx.fillStyle = '#c8c8c8';
  rctx.fillRect(0, 0, size, size);
  addFbm(rctx, size, size, 24, 0.12);
  return {
    map: canvasTexture(c, { srgb: true }),
    roughnessMap: canvasTexture(rc),
  };
}

/**
 * The whole court painted into one texture: orange surround, blue court,
 * lighter service boxes, white lines with a touch of wear. Aspect is
 * width:length = 1:2 (mapped onto the court plane).
 */
export function courtTexture(
  surround = '#b45a28',
  courtBlue = '#1d6ea8',
  courtLight = '#2e85c2',
  w = 1024,
  h = 2048,
): TextureSet {
  const [c, ctx] = makeCanvas(w, h);
  // Orange surround.
  ctx.fillStyle = surround;
  ctx.fillRect(0, 0, w, h);
  addFbm(ctx, w, h, 40, 0.1);

  // Court rectangle proportions (of the full texture).
  const cx0 = w * 0.135;
  const cx1 = w * 0.865;
  const cy0 = h * 0.1;
  const cy1 = h * 0.9;
  ctx.fillStyle = courtBlue;
  ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);

  // Service boxes (lighter blue), split by the net line at mid-height.
  const midY = h * 0.5;
  const sy0 = h * 0.25;
  const sy1 = h * 0.75;
  ctx.fillStyle = courtLight;
  ctx.fillRect(cx0, sy0, cx1 - cx0, midY - sy0);
  ctx.fillRect(cx0, midY, cx1 - cx0, sy1 - midY);
  addFbm(ctx, w, h, 64, 0.07);

  // White lines.
  const line = w * 0.012;
  ctx.fillStyle = '#eef2f2';
  const strokeRect = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.fillRect(x0, y0, x1 - x0, line);
    ctx.fillRect(x0, y1 - line, x1 - x0, line);
    ctx.fillRect(x0, y0, line, y1 - y0);
    ctx.fillRect(x1 - line, y0, line, y1 - y0);
  };
  strokeRect(cx0, cy0, cx1, cy1);
  ctx.fillRect(cx0, sy0, cx1 - cx0, line); // service lines
  ctx.fillRect(cx0, sy1 - line, cx1 - cx0, line);
  ctx.fillRect(w / 2 - line / 2, sy0, line, sy1 - sy0); // center line
  // Wear: erode lines with speckle.
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(R(0, w), R(0, h), 2, 2);
  }
  // Scuffs.
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = 'rgba(20,20,25,0.05)';
    ctx.lineWidth = R(1, 3);
    ctx.beginPath();
    const x = R(cx0, cx1);
    const y = R(cy0, cy1);
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + R(-40, 40), y + R(-30, 30), x + R(-80, 80), y + R(-40, 40));
    ctx.stroke();
  }
  const [rc, rctx] = makeCanvas(256);
  rctx.fillStyle = '#c2c2c2';
  rctx.fillRect(0, 0, 256, 256);
  addFbm(rctx, 256, 256, 24, 0.1);
  return {
    map: canvasTexture(c, { srgb: true }),
    roughnessMap: canvasTexture(rc),
  };
}

// ----------------------------------------------------------------------------
// Ground / terrain
// ----------------------------------------------------------------------------

/** Mottled lawn grass. */
export function grassTexture(size = 1024): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#4e7a2e';
  ctx.fillRect(0, 0, size, size);
  addFbm(ctx, size, size, 20, 0.35, '#2e5220', '#7fae4a');
  // Blade flecks.
  for (let i = 0; i < 9000; i++) {
    const g = R(0.35, 0.75);
    ctx.strokeStyle = `rgba(${(70 * g) | 0},${(130 * g + 40) | 0},${(45 * g) | 0},0.35)`;
    ctx.lineWidth = 1;
    const x = R(0, size);
    const y = R(0, size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + R(-2, 2), y - R(2, 5));
    ctx.stroke();
  }
  // Dry patches.
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = 'rgba(150,140,70,0.10)';
    ctx.beginPath();
    ctx.ellipse(R(0, size), R(0, size), R(20, 80), R(15, 60), R(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  const [hc, hctx] = makeCanvas(256);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, 256, 256);
  addFbm(hctx, 256, 256, 32, 0.5);
  return {
    map: canvasTexture(c, { srgb: true }),
    normalMap: canvasTexture(normalFromHeight(hc, 0.8)),
  };
}

/**
 * Baked island splat for the cove: lush meadow center, dry grass, a sandy
 * shore ring, and a worn path toward the dock (top of the texture = -Z).
 * Mapped once (not tiled) over the whole island.
 */
export function islandSplat(size = 1024): Texture {
  const [c, ctx] = makeCanvas(size);
  const cx = size / 2;
  // Radial: meadow → dry grass → sand.
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, '#5d7a35');
  grad.addColorStop(0.45, '#647c36');
  grad.addColorStop(0.58, '#7d8746');
  grad.addColorStop(0.66, '#a09058');
  grad.addColorStop(0.72, '#b9a878');
  grad.addColorStop(0.78, '#a2917d');
  grad.addColorStop(1, '#6e6a5e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  addFbm(ctx, size, size, 26, 0.22, '#3c5424', '#96a058');
  // Worn path from the center toward the dock (up/-Z in world).
  ctx.save();
  ctx.translate(cx, cx);
  ctx.strokeStyle = 'rgba(160,140,95,0.7)';
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.024;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.02);
  ctx.quadraticCurveTo(size * 0.02, -size * 0.14, -size * 0.01, -size * 0.31);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(140,120,80,0.5)';
  ctx.lineWidth = size * 0.016;
  ctx.stroke();
  ctx.restore();
  // Flower flecks in the meadow.
  for (let i = 0; i < 320; i++) {
    const a = R(0, Math.PI * 2);
    const r = R(0, size * 0.3);
    ctx.fillStyle = ['#e8e6b8', '#d8a8c8', '#e8c860'][Math.floor(R(0, 3))];
    ctx.globalAlpha = R(0.15, 0.4);
    ctx.fillRect(cx + Math.sin(a) * r, cx + Math.cos(a) * r, 2, 2);
    ctx.globalAlpha = 1;
  }
  addFbm(ctx, size, size, 90, 0.08);
  const tex = canvasTexture(c, { srgb: true });
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  return tex;
}

/** Grey rock with cracks and warm dust. */
export function rockTexture(size = 512): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#78716a';
  ctx.fillRect(0, 0, size, size);
  addFbm(ctx, size, size, 16, 0.35, '#4e4a45', '#9a938a');
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = 'rgba(35,32,30,0.35)';
    ctx.lineWidth = R(0.7, 1.8);
    ctx.beginPath();
    let x = R(0, size);
    let y = R(0, size);
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += R(-40, 40);
      y += R(10, 50);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(160,140,110,0.08)';
  ctx.fillRect(0, 0, size, size);
  const [hc, hctx] = makeCanvas(256);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, 256, 256);
  addFbm(hctx, 256, 256, 12, 0.6);
  return {
    map: canvasTexture(c, { srgb: true }),
    normalMap: canvasTexture(normalFromHeight(hc, 1.6)),
  };
}

/** Vertical bark ridges. */
export function barkTexture(base = '#5a4632', size = 512): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const baseCol = new Color(base);
  for (let i = 0; i < 90; i++) {
    const x = R(0, size);
    const col = baseCol.clone().offsetHSL(0, R(-0.03, 0.03), R(-0.14, 0.08));
    ctx.strokeStyle = `#${col.getHexString()}`;
    ctx.lineWidth = R(2, 7);
    ctx.globalAlpha = R(0.5, 0.95);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= size; y += size / 6) {
      ctx.lineTo(x + Math.sin(y * 0.02 + i) * R(2, 6), y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  addFbm(ctx, size, size, 30, 0.15);
  const [hc, hctx] = makeCanvas(256);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    hctx.strokeStyle = rnd() < 0.5 ? '#6a6a6a' : '#9a9a9a';
    hctx.lineWidth = R(2, 6);
    const x = R(0, 256);
    hctx.beginPath();
    hctx.moveTo(x, 0);
    hctx.lineTo(x + R(-8, 8), 256);
    hctx.stroke();
  }
  return {
    map: canvasTexture(c, { srgb: true }),
    normalMap: canvasTexture(normalFromHeight(hc, 1.5)),
  };
}

// ----------------------------------------------------------------------------
// Foliage / clouds (alpha cards)
// ----------------------------------------------------------------------------

/** Leafy canopy card: clustered leaf blobs with an alpha silhouette. */
export function foliageCard(
  dark = '#2e5c22',
  light = '#7fb544',
  size = 512,
): Texture {
  const [c, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const cd = new Color(dark);
  const cl = new Color(light);
  const cx = size / 2;
  // Dense core silhouette first so the canopy reads solid, then leaf clumps.
  for (let i = 0; i < 60; i++) {
    const a = R(0, Math.PI * 2);
    const rr = Math.sqrt(rnd()) * size * 0.3;
    const col = cd.clone().lerp(cl, R(0, 0.4));
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.beginPath();
    ctx.ellipse(cx + Math.sin(a) * rr, cx + Math.cos(a) * rr * 0.85, R(30, 60), R(24, 48), R(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 1200; i++) {
    const a = R(0, Math.PI * 2);
    const rr = Math.sqrt(rnd()) * size * 0.44;
    const x = cx + Math.sin(a) * rr;
    const y = cx + Math.cos(a) * rr * 0.86;
    const t = Math.min(1, rr / (size * 0.44)) * R(0.5, 1);
    const col = cd.clone().lerp(cl, 1 - t * R(0.5, 1));
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = R(0.75, 1);
    ctx.beginPath();
    ctx.ellipse(x, y, R(8, 26), R(6, 20), R(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = canvasTexture(c, { srgb: true });
  return tex;
}

/** Pine bough card: layered needle strokes in a rough triangle. */
export function pineCard(dark = '#2a4a34', light = '#6a9455', size = 512): Texture {
  const [c, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const cd = new Color(dark);
  const cl = new Color(light);
  // Solid tiered silhouette first so the canopy survives mipmapping…
  for (let tier = 0; tier < 5; tier++) {
    const ty = 0.16 + tier * 0.2;
    const halfW = (0.1 + ty * 0.4) * size;
    const col = cd.clone().lerp(cl, 0.2);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.beginPath();
    ctx.moveTo(size / 2, size * (ty - 0.22));
    ctx.lineTo(size / 2 - halfW, size * (ty + 0.1));
    ctx.lineTo(size / 2 + halfW, size * (ty + 0.1));
    ctx.closePath();
    ctx.fill();
  }
  // …then needle strokes for texture.
  for (let i = 0; i < 2200; i++) {
    const ty = rnd(); // 0 top … 1 bottom
    const halfW = 0.08 + ty * 0.42;
    const x = size * (0.5 + R(-halfW, halfW));
    const y = size * (0.06 + ty * 0.88);
    const col = cd.clone().lerp(cl, R(0, 1) * (1 - ty * 0.4));
    ctx.strokeStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = R(0.7, 1);
    ctx.lineWidth = R(2, 4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + R(-16, 16), y + R(6, 20));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvasTexture(c, { srgb: true });
}

/**
 * Opaque tiling foliage: dense small leaves over a dark base. Meant for
 * *geometry* canopies (displaced clumps), so there is no alpha at all —
 * no alpha-test erosion, correct in stereo.
 */
export function leafage(dark = '#243f1c', light = '#79a844', size = 512): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);
  const cd = new Color(dark);
  const cl = new Color(light);
  for (let i = 0; i < 2600; i++) {
    const t = R(0, 1);
    const col = cd.clone().lerp(cl, t * t);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = R(0.7, 1);
    const x = R(0, size);
    const y = R(0, size);
    const w = R(3, 9);
    const h = w * R(0.5, 0.8);
    const rot = R(0, Math.PI);
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, rot, 0, Math.PI * 2);
    ctx.fill();
    // wrap edges so it tiles
    if (x < 12) {
      ctx.beginPath();
      ctx.ellipse(x + size, y, w, h, rot, 0, Math.PI * 2);
      ctx.fill();
    }
    if (y < 12) {
      ctx.beginPath();
      ctx.ellipse(x, y + size, w, h, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const [rc, rctx] = makeCanvas(256);
  rctx.fillStyle = '#b8b8b8';
  rctx.fillRect(0, 0, 256, 256);
  addFbm(rctx, 256, 256, 24, 0.2);
  return {
    map: canvasTexture(c, { srgb: true }),
    roughnessMap: canvasTexture(rc),
  };
}

/** Opaque tiling conifer needles for geometry pine tiers. */
export function needleage(dark = '#1c3626', light = '#54823e', size = 512): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);
  const cd = new Color(dark);
  const cl = new Color(light);
  for (let i = 0; i < 5200; i++) {
    const col = cd.clone().lerp(cl, R(0, 1));
    ctx.strokeStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = R(0.6, 1);
    ctx.lineWidth = R(1, 2.2);
    const x = R(0, size);
    const y = R(0, size);
    const dx = R(-4, 4);
    const dy = R(5, 14);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    if (y > size - 16) {
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + dx, y - size + dy);
      ctx.stroke();
    }
    if (x > size - 8 || x < 8) {
      ctx.beginPath();
      ctx.moveTo((x + size / 2) % size, y);
      ctx.lineTo(((x + size / 2) % size) + dx, y + dy);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const [rc, rctx] = makeCanvas(256);
  rctx.fillStyle = '#c2c2c2';
  rctx.fillRect(0, 0, 256, 256);
  addFbm(rctx, 256, 256, 24, 0.15);
  return {
    map: canvasTexture(c, { srgb: true }),
    roughnessMap: canvasTexture(rc),
  };
}

/** Grass tuft card (a few blades) for near-field ground cover. */
export function grassTuftCard(size = 256): Texture {
  const [c, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = size * R(0.15, 0.85);
    const h = size * R(0.35, 0.9);
    const lean = R(-0.35, 0.35);
    const g = R(0.5, 1);
    ctx.strokeStyle = `rgb(${(70 * g) | 0},${(120 * g + 30) | 0},${(48 * g) | 0})`;
    ctx.lineWidth = R(2, 4.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + lean * 30, size - h * 0.6, x + lean * 90, size - h);
    ctx.stroke();
  }
  return canvasTexture(c, { srgb: true });
}

/** Sports-net weave: white threads on transparency (use with alphaTest). */
export function netWeave(size = 512, cells = 26): Texture {
  const [c, ctx] = makeCanvas(size, size / 4);
  ctx.clearRect(0, 0, size, size / 4);
  const h = size / 4;
  ctx.strokeStyle = '#e8ecec';
  ctx.lineWidth = 4.5;
  const step = size / cells;
  for (let i = 0; i <= cells; i++) {
    const x = i * step;
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(i) * 1.5, 0);
    ctx.lineTo(x - Math.sin(i) * 1.5, h);
    ctx.stroke();
  }
  for (let j = 0; j <= cells / 4; j++) {
    const y = (j * h) / (cells / 4);
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(j * 2) * 1.2);
    ctx.lineTo(size, y - Math.sin(j * 2) * 1.2);
    ctx.stroke();
  }
  return canvasTexture(c, { srgb: true });
}

/** Puffy cloud billboard with soft alpha edges. */
export function cloudCard(tint = '#ffffff', size = 512): Texture {
  const [c, ctx] = makeCanvas(size, size / 2);
  ctx.clearRect(0, 0, size, size / 2);
  const col = new Color(tint);
  for (let i = 0; i < 26; i++) {
    const x = size * R(0.15, 0.85);
    const y = (size / 2) * R(0.35, 0.75);
    const r = R(20, 64);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
    g.addColorStop(0, `rgba(${rgb},0.85)`);
    g.addColorStop(0.7, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(c, { srgb: true });
}

/** Soft radial glow sprite (lantern halos, ember light pools). */
export function glowSprite(tint = '#ffcf8a', size = 128): Texture {
  const [c, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const col = new Color(tint);
  const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},0.9)`);
  g.addColorStop(0.4, `rgba(${rgb},0.32)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(c, { srgb: true });
}

/** Vertical white water streaks with alpha — scroll it for a live waterfall. */
export function fallStreaks(size = 256): Texture {
  const [c, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const x = R(0, size);
    const w = R(1.5, 6);
    const len = R(size * 0.25, size * 0.9);
    const y = R(-size * 0.2, size);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    const a = R(0.25, 0.7);
    g.addColorStop(0, `rgba(238,246,248,0)`);
    g.addColorStop(0.3, `rgba(238,246,248,${a})`);
    g.addColorStop(0.7, `rgba(224,238,242,${a * 0.8})`);
    g.addColorStop(1, `rgba(238,246,248,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, len);
    // wrap
    ctx.fillRect(x, y - size, w, len);
    ctx.fillRect(x, y + size, w, len);
  }
  return canvasTexture(c, { srgb: true });
}

// ----------------------------------------------------------------------------
// Water
// ----------------------------------------------------------------------------

/** Tiling ripple normal map (scrolled at runtime for living water). */
export function waterNormal(size = 512): Texture {
  const [hc, hctx] = makeCanvas(size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);
  addNoise(hctx, size, size, 12, 0.5);
  addNoise(hctx, size, size, 36, 0.35);
  addNoise(hctx, size, size, 90, 0.2);
  // Squash vertically (2x tile) so ripples read as wind-blown cat's paws.
  const [sc, sctx] = makeCanvas(size);
  sctx.drawImage(hc, 0, 0, size, size / 2);
  sctx.drawImage(hc, 0, size / 2, size, size / 2);
  return canvasTexture(normalFromHeight(sc, 1.1));
}

// ----------------------------------------------------------------------------
// Graphic design: banners, screens, wall murals
// ----------------------------------------------------------------------------

/** Vertical sports banner with dynamic swoosh art. */
export function bannerArt(accent = '#e86a1d', accent2 = '#f2c22e', size = 256): Texture {
  const [c, ctx] = makeCanvas(size, size * 2);
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, size, size * 2);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.5);
  ctx.quadraticCurveTo(size * 0.7, size * 0.62, size, size * 0.32);
  ctx.lineTo(size, size * 0.62);
  ctx.quadraticCurveTo(size * 0.5, size * 0.9, 0, size * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent2;
  ctx.beginPath();
  ctx.moveTo(0, size * 1.15);
  ctx.quadraticCurveTo(size * 0.6, size * 1.32, size, size * 1.05);
  ctx.lineTo(size, size * 1.2);
  ctx.quadraticCurveTo(size * 0.5, size * 1.48, 0, size * 1.32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#20444c';
  ctx.fillRect(0, size * 1.82, size, size * 0.18);
  ctx.fillStyle = '#f4f2ec';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(size * (0.3 + i * 0.2), size * 1.91, size * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(c, { srgb: true });
}

/** Big-screen graphic (used as map + emissiveMap so it glows like an LED). */
export function screenArt(size = 512): Texture {
  const [c, ctx] = makeCanvas(size, size / 2);
  const g = ctx.createLinearGradient(0, 0, size, size / 2);
  g.addColorStop(0, '#123a54');
  g.addColorStop(1, '#0b2436');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size / 2);
  // Score panels.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(size * 0.06, size * 0.05, size * 0.38, size * 0.28);
  ctx.fillRect(size * 0.56, size * 0.05, size * 0.38, size * 0.28);
  ctx.fillStyle = '#ffd23e';
  ctx.font = `bold ${size * 0.16}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('11', size * 0.25, size * 0.26);
  ctx.fillStyle = '#4ed0e8';
  ctx.fillText('9', size * 0.75, size * 0.26);
  ctx.fillStyle = '#f4f2ec';
  ctx.font = `bold ${size * 0.06}px sans-serif`;
  ctx.fillText('HOME', size * 0.25, size * 0.42);
  ctx.fillText('GUEST', size * 0.75, size * 0.42);
  ctx.fillStyle = '#e86a1d';
  ctx.fillRect(size * 0.3, size * 0.455, size * 0.4, size * 0.012);
  return canvasTexture(c, { srgb: true });
}

/** White kicker-wall panel with a painted teal wave mural. */
export function muralWall(size = 1024): TextureSet {
  const [c, ctx] = makeCanvas(size, size / 4);
  ctx.fillStyle = '#eef0ee';
  ctx.fillRect(0, 0, size, size / 4);
  const h = size / 4;
  // Integer wave cycles so the texture tiles seamlessly along a wall.
  const wave = (
    amp: number,
    yBase: number,
    color: string,
    alpha: number,
    thick: number,
    cycles: number,
    phase: number,
  ) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = thick;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const y = yBase + Math.sin((x / size) * Math.PI * 2 * cycles + phase) * amp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  wave(h * 0.16, h * 0.42, '#2e97a8', 0.9, h * 0.13, 2, 0.4);
  wave(h * 0.13, h * 0.6, '#63bfcc', 0.8, h * 0.09, 3, 2.2);
  wave(h * 0.1, h * 0.75, '#1e7482', 0.7, h * 0.06, 2, 4.1);
  addFbm(ctx, size, h, 48, 0.05);
  const [rc, rctx] = makeCanvas(256, 64);
  rctx.fillStyle = '#a8a8a8';
  rctx.fillRect(0, 0, 256, 64);
  return {
    map: canvasTexture(c, { srgb: true }),
    roughnessMap: canvasTexture(rc),
  };
}

/** Painted / powder-coated metal with slight tone variation. */
export function paintedMetal(color: string, size = 256): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  addFbm(ctx, size, size, 20, 0.07);
  const [rc, rctx] = makeCanvas(size);
  rctx.fillStyle = '#6f6f6f';
  rctx.fillRect(0, 0, size, size);
  addFbm(rctx, size, size, 16, 0.15);
  return {
    map: canvasTexture(c, { srgb: true }),
    roughnessMap: canvasTexture(rc),
  };
}

/** Poured concrete / pavers. */
export function concreteTexture(base = '#b5b1a6', size = 512): TextureSet {
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  addFbm(ctx, size, size, 20, 0.14, '#8d897e', '#cfcabd');
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(R(0, size), R(0, size), 1.5, 1.5);
  }
  // Expansion joints.
  ctx.strokeStyle = 'rgba(60,58,52,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size / 2 - 2, size / 2 - 2);
  ctx.strokeRect(size / 2 + 1, 1, size / 2 - 2, size / 2 - 2);
  ctx.strokeRect(1, size / 2 + 1, size / 2 - 2, size / 2 - 2);
  ctx.strokeRect(size / 2 + 1, size / 2 + 1, size / 2 - 2, size / 2 - 2);
  const [hc, hctx] = makeCanvas(256);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, 256, 256);
  addFbm(hctx, 256, 256, 24, 0.3);
  return {
    map: canvasTexture(c, { srgb: true }),
    normalMap: canvasTexture(normalFromHeight(hc, 0.7)),
  };
}

/** Striped hot-air-balloon envelope fabric. */
export function balloonFabric(a: string, b: string, size = 512): Texture {
  const [c, ctx] = makeCanvas(size);
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? a : b;
    ctx.fillRect((i * size) / stripes, 0, size / stripes + 1, size);
  }
  // Panel seams.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= stripes; i++) {
    ctx.beginPath();
    ctx.moveTo((i * size) / stripes, 0);
    ctx.lineTo((i * size) / stripes, size);
    ctx.stroke();
  }
  for (let j = 1; j < 6; j++) {
    ctx.beginPath();
    ctx.moveTo(0, (j * size) / 6);
    ctx.lineTo(size, (j * size) / 6);
    ctx.stroke();
  }
  addFbm(ctx, size, size, 40, 0.05);
  return canvasTexture(c, { srgb: true });
}
