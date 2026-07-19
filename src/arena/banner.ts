/**
 * The TWOT board — the title sign above the goal IS the scoreline of shame.
 * The word TWOT hangs there in aero glass with the O drawn as a football;
 * all four letters start ghosted, and every goal the current keeper concedes
 * LIGHTS the next one (T… TW… TWO… TWOT) with a big pop everyone can see.
 * Four letters = the keeper loses and the slap line forms.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
} from 'three';
import { GOAL } from '../config.js';
import { aeroFont, boardPanel } from '../ui/aero.js';

const W = 1024;
const H = 300;

export interface TwotBoard {
  mesh: Mesh;
  /** Light the first `n` letters; `pop` punches the board scale. */
  setLit(n: number, pop?: boolean): void;
  /** Advance the pop animation — call every frame. */
  tick(dt: number): void;
}

/** Module singleton so GoalSystem/HudSystem can reach the board. */
export let twotBoard: TwotBoard | null = null;

/** A cartoon football: white ball, black centre pentagon, rim patches. */
export function drawFootball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const sphere = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  sphere.addColorStop(0, '#ffffff');
  sphere.addColorStop(1, '#c9d8e4');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = sphere;
  ctx.fill();
  ctx.lineWidth = r * 0.09;
  ctx.strokeStyle = '#0e2233';
  ctx.stroke();

  // Centre pentagon.
  const pent = (radius: number, rot: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * Math.PI * 2) / 5;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = '#0e2233';
  pent(r * 0.38, -Math.PI / 2);
  ctx.fill();

  // Spokes + rim patches.
  ctx.lineWidth = r * 0.07;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const x1 = cx + Math.cos(a) * r * 0.38;
    const y1 = cy + Math.sin(a) * r * 0.38;
    const x2 = cx + Math.cos(a) * r * 0.92;
    const y2 = cy + Math.sin(a) * r * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.985, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(x2 + Math.cos(a) * r * 0.22, y2 + Math.sin(a) * r * 0.22, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = '#0e2233';
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function createTitleBanner(parent: Object3D): Mesh {
  const canvas = document.createElement('canvas');
  // 2× supersample for crisp letters + tagline from the arc.
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.colorSpace = SRGBColorSpace; // keep the dark board face dark

  let lit = 0;
  let pop = 0;

  const draw = (): void => {
    ctx.clearRect(0, 0, W, H);
    boardPanel(ctx, 8, 8, W - 16, H - 16, 44);

    // T W ⚽ T — letters ghost dark until the keeper concedes them ALIGHT.
    const y = 152;
    const px = 210;
    const xs = [190, 402, 618, 834];
    const word = ['T', 'W', 'O', 'T'];
    for (let i = 0; i < 4; i++) {
      const isLit = i < lit;
      if (i === 2) {
        if (isLit) {
          // The football burns on its red halo when its letter is conceded.
          ctx.save();
          ctx.shadowColor = '#ff2617';
          ctx.shadowBlur = 42;
          ctx.beginPath();
          ctx.arc(xs[i], y, 96, 0, Math.PI * 2);
          ctx.fillStyle = '#e02b1d';
          ctx.fill();
          ctx.restore();
        }
        drawFootball(ctx, xs[i], y, 92, isLit ? 1 : 0.22);
        continue;
      }
      ctx.font = aeroFont(px, 900);
      if (isLit) {
        ctx.save();
        ctx.shadowColor = '#ff2617';
        ctx.shadowBlur = 34;
        ctx.fillStyle = '#ff4030';
        ctx.fillText(word[i], xs[i], y);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = aeroFont(px, 900);
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillText(word[i], xs[i], y - 3);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillText(word[i], xs[i], y);
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = 3;
        ctx.strokeText(word[i], xs[i], y);
      }
    }
    texture.needsUpdate = true;
  };

  const mesh = new Mesh(
    new PlaneGeometry(2.6, 0.76),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = 'title-banner';
  mesh.position.set(0, GOAL.height + 1.68, -0.4);
  mesh.rotation.x = -0.08;
  parent.add(mesh);
  draw();

  twotBoard = {
    mesh,
    setLit(n, doPop = false) {
      lit = Math.max(0, Math.min(4, n));
      if (doPop) pop = 1;
      draw();
    },
    tick(dt) {
      if (pop <= 0) return;
      pop = Math.max(0, pop - dt * 2.6);
      // Punch out and settle: 1 → ~1.3 → 1.
      const s = 1 + Math.sin(pop * Math.PI) * 0.3;
      mesh.scale.setScalar(s);
      if (pop === 0) mesh.scale.setScalar(1);
    },
  };
  return mesh;
}
