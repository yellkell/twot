/**
 * The "KEEP IT UP" title sign — a pane of aero glass floating above the goal
 * like sports-centre signage: glossy gradient lettering, a lime swoosh, a
 * one-line pitch. Always on; the live scoreboard hangs beneath it.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Object3D,
} from 'three';
import { GOAL } from '../config.js';
import { AERO, aeroFont, glassPanel, headline, swoosh } from '../ui/aero.js';

const W = 1024;
const H = 400;

export function createTitleBanner(parent: Object3D): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  glassPanel(ctx, 10, 10, W - 20, H - 20, { radius: 60, bubbles: 10 });
  swoosh(ctx, 40, 260, W - 300, 70, AERO.lime);

  headline(ctx, 'KEEP IT UP', W / 2, 150, 150, AERO.aqua);

  ctx.font = aeroFont(40, 700);
  ctx.fillStyle = AERO.text;
  ctx.fillText('big hands · big ball · one bounce and it’s dead', W / 2, 282);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const banner = new Mesh(
    new PlaneGeometry(2.6, 1.02),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  banner.name = 'title-banner';
  // Hung above the goal, tilted a touch down at the arc.
  banner.position.set(0, GOAL.height + 1.55, -0.4);
  banner.rotation.x = -0.08;
  parent.add(banner);
  return banner;
}
