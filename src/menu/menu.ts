/**
 * The lobby: three panes of aero glass floating in front of you.
 * Centre = the big PLAY pill + difficulty; left = the CLUB SHEET (persistent
 * stats for all six of you, both positions); right = how to play. Each panel
 * is a canvas texture on a plane; MenuSystem raycasts the controllers for
 * hover + click and maps the hit UV to an action zone (the exact mechanism
 * Iron Balls used — it was too good not to harvest).
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { app } from './appState.js';
import { avgKeeperTime, roster } from '../game/roster.js';
import { rally } from '../game/state.js';
import { AERO, aeroFont, glassPanel, headline, pillButton, swoosh } from '../ui/aero.js';

export type PanelId = 'play' | 'stats' | 'howto';

export type MenuAction = 'play' | 'toggle-difficulty' | 'reset-stats';

const PW = 512;
const PH = 400;

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hover: boolean) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null) => void;
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hover: boolean) => void,
  hitTest: MenuPanel['hitTest'],
  canvasW = PW,
  canvasH = PH,
): MenuPanel {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = `menu-panel:${id}`;
  const redraw = (hover: boolean): void => {
    ctx.clearRect(0, 0, canvasW, canvasH);
    draw(ctx, hover);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest };
}

/** Centre — the marquee and the big friendly PLAY pill. */
function drawPlay(ctx: CanvasRenderingContext2D, hover: boolean): void {
  glassPanel(ctx, 8, 8, PW - 16, PH - 16, { radius: 34, bubbles: 8, stroke: hover ? AERO.lime : AERO.stroke });
  swoosh(ctx, 30, 96, PW - 120, 46);
  headline(ctx, 'KEEP IT UP', PW / 2, 66, 64, AERO.aqua);

  pillButton(ctx, 86, 130, PW - 172, 92, 'PLAY', AERO.lime, hover);

  pillButton(
    ctx,
    116,
    248,
    PW - 232,
    56,
    `BOTS: ${app.difficulty === 'pro' ? 'PRO' : 'CASUAL'}`,
    app.difficulty === 'pro' ? AERO.sun : AERO.aqua,
    hover,
  );

  ctx.font = aeroFont(22, 700);
  ctx.fillStyle = AERO.text;
  ctx.fillText('hold BOTH grips in-game to come back', PW / 2, 340);
  if (rally.score > 0 || rally.bestCombo > 0) {
    ctx.fillStyle = AERO.aquaDeep;
    ctx.fillText(`last session — score ${rally.score} · best combo ×${rally.bestCombo}`, PW / 2, 372);
  }
}

function hitPlay(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PH;
  if (x >= 86 && x <= PW - 86 && y >= 130 && y <= 222) return 'play';
  if (x >= 116 && x <= PW - 116 && y >= 248 && y <= 304) return 'toggle-difficulty';
  return null;
}

/** Left — the CLUB SHEET: lifetime numbers for every player, both jobs. */
function drawStats(ctx: CanvasRenderingContext2D, hover: boolean): void {
  const W = 640;
  const H = 480;
  glassPanel(ctx, 8, 8, W - 16, H - 16, { radius: 34, stroke: hover ? AERO.aqua : AERO.stroke });
  headline(ctx, 'CLUB SHEET', W / 2, 52, 44, AERO.aqua);

  const cols = [110, 208, 268, 328, 396, 464, 524, 584];
  const heads = ['', 'GLS', 'SHT', 'SAV', 'GK⌀', 'PAS', 'H-V', 'CMB'];
  ctx.font = aeroFont(20, 800);
  ctx.fillStyle = AERO.textDim;
  heads.forEach((h, i) => {
    if (h) ctx.fillText(h, cols[i], 104);
  });

  let y = 146;
  for (const p of roster) {
    ctx.textAlign = 'left';
    ctx.font = aeroFont(22, 900);
    ctx.fillStyle = `#${p.accent.toString(16).padStart(6, '0')}`;
    ctx.fillText('●', 34, y);
    ctx.fillStyle = AERO.text;
    ctx.fillText(p.name, 62, y);
    ctx.textAlign = 'center';
    ctx.font = aeroFont(21, 700);
    const s = p.stats;
    const row = [s.goals, s.shots, s.saves, avgKeeperTime(p), s.passes, s.halfVolleys, s.bestCombo];
    row.forEach((val, i) => {
      ctx.fillText(String(val), cols[i + 1], y);
    });
    y += 46;
  }

  pillButton(ctx, W / 2 - 110, H - 62, 220, 42, 'reset sheet', AERO.bubblegum, hover);
}

function hitStats(u: number, v: number): MenuAction | null {
  const x = u * 640;
  const y = (1 - v) * 480;
  if (x >= 210 && x <= 430 && y >= 418 && y <= 460) return 'reset-stats';
  return null;
}

/** Right — how to play. */
function drawHowto(ctx: CanvasRenderingContext2D, hover: boolean): void {
  glassPanel(ctx, 8, 8, PW - 16, PH - 16, { radius: 34, bubbles: 5, stroke: hover ? AERO.sun : AERO.stroke });
  headline(ctx, 'THE RULES', PW / 2, 54, 44, AERO.sun);

  const lines: Array<[string, string]> = [
    ['KEEP IT UP', 'slap the ball with your big hands'],
    ['3 TOUCHES', 'three players in — the ball is LIVE'],
    ['COMBO', 'every pass shrinks it… then it burns'],
    ['SHOOT', 'power-slap the live ball at the goal'],
    ['ONE BOUNCE', 'dead — unless you hit it AS it lands'],
    ['HALF VOLLEY', 'that counts. and it counts BIG'],
    ['SAVED?', 'shooter goes in goal. keeper goes wide'],
  ];
  let y = 106;
  for (const [head, body] of lines) {
    ctx.textAlign = 'left';
    ctx.font = aeroFont(21, 900);
    ctx.fillStyle = AERO.aquaDeep;
    ctx.fillText(head, 36, y);
    ctx.font = aeroFont(19, 700);
    ctx.fillStyle = AERO.text;
    ctx.fillText(body, 182, y);
    y += 40;
  }
  ctx.textAlign = 'center';
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const play = makePanel('play', 1.0, 0.78, drawPlay, hitPlay);
  play.mesh.position.set(0, 1.5, -1.55);

  const stats = makePanel('stats', 1.1, 0.83, drawStats, hitStats, 640, 480);
  stats.mesh.position.set(-1.12, 1.48, -1.32);
  stats.mesh.rotation.y = 0.5;

  const howto = makePanel('howto', 1.0, 0.78, drawHowto, () => null);
  howto.mesh.position.set(1.12, 1.48, -1.32);
  howto.mesh.rotation.y = -0.5;

  const panels = [play, stats, howto];
  for (const p of panels) group.add(p.mesh);
  scene.add(group);

  return {
    group,
    panels,
    setVisible(v) {
      group.visible = v;
    },
    redrawAll(hoverId) {
      for (const p of panels) p.redraw(hoverId === p.id);
    },
  };
}
