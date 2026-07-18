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
import { drawFootball } from '../arena/banner.js';
import { AERO, aeroFont, glassPanel, headline, pillButton, swoosh } from '../ui/aero.js';

export type PanelId = 'play' | 'stats' | 'howto' | 'pause';

export type MenuAction = 'play' | 'toggle-difficulty' | 'toggle-view' | 'reset-stats' | 'resume' | 'leave';

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

/** Centre — the marquee (the O is a football, obviously) + the PLAY pill. */
function drawPlay(ctx: CanvasRenderingContext2D, hover: boolean): void {
  glassPanel(ctx, 8, 8, PW - 16, PH - 16, { radius: 34, bubbles: 8, stroke: hover ? AERO.lime : AERO.stroke });
  swoosh(ctx, 30, 96, PW - 120, 46);
  headline(ctx, 'TW', PW / 2 - 92, 66, 84, AERO.aqua);
  drawFootball(ctx, PW / 2 + 46, 64, 38, 1);
  headline(ctx, 'T', PW / 2 + 138, 66, 84, AERO.aqua);

  pillButton(ctx, 86, 118, PW - 172, 80, 'PLAY', AERO.lime, hover);

  pillButton(
    ctx,
    116,
    212,
    PW - 232,
    50,
    `BOTS: ${app.difficulty === 'pro' ? 'PRO' : 'CASUAL'}`,
    app.difficulty === 'pro' ? AERO.sun : AERO.aqua,
    hover,
  );
  pillButton(
    ctx,
    116,
    274,
    PW - 232,
    50,
    app.view === 'pavilion' ? 'VIEW: PAVILION' : 'VIEW: PASSTHROUGH',
    app.view === 'pavilion' ? AERO.violet : AERO.aqua,
    hover,
  );

  ctx.font = aeroFont(21, 700);
  ctx.fillStyle = AERO.text;
  ctx.fillText('press A in-game to pause or leave', PW / 2, 346);
  if (rally.score > 0 || rally.bestCombo > 0) {
    ctx.fillStyle = AERO.aquaDeep;
    ctx.fillText(`last session — score ${rally.score} · best combo ×${rally.bestCombo}`, PW / 2, 376);
  }
}

function hitPlay(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PH;
  if (x >= 86 && x <= PW - 86 && y >= 118 && y <= 198) return 'play';
  if (x >= 116 && x <= PW - 116 && y >= 212 && y <= 262) return 'toggle-difficulty';
  if (x >= 116 && x <= PW - 116 && y >= 274 && y <= 324) return 'toggle-view';
  return null;
}

/** Left — the CLUB SHEET: lifetime numbers for every player, both jobs. */
function drawStats(ctx: CanvasRenderingContext2D, hover: boolean): void {
  const W = 640;
  const H = 480;
  glassPanel(ctx, 8, 8, W - 16, H - 16, { radius: 34, stroke: hover ? AERO.aqua : AERO.stroke });
  headline(ctx, 'CLUB SHEET', W / 2, 52, 44, AERO.aqua);

  const cols = [100, 182, 238, 294, 356, 418, 476, 534, 592];
  const heads = ['', 'GLS', 'SHT', 'SAV', 'GK⌀', 'PAS', 'H-V', 'CMB', 'AURA'];
  ctx.font = aeroFont(19, 800);
  ctx.fillStyle = AERO.textDim;
  heads.forEach((h, i) => {
    if (h) ctx.fillText(h, cols[i], 104);
  });

  let y = 146;
  for (const p of roster) {
    ctx.textAlign = 'left';
    ctx.font = aeroFont(21, 900);
    ctx.fillStyle = `#${p.accent.toString(16).padStart(6, '0')}`;
    ctx.fillText('●', 26, y);
    ctx.fillStyle = AERO.text;
    ctx.fillText(p.name, 52, y);
    ctx.textAlign = 'center';
    ctx.font = aeroFont(20, 700);
    const s = p.stats;
    const row = [s.goals, s.shots, s.saves, avgKeeperTime(p), s.passes, s.halfVolleys, s.bestCombo];
    row.forEach((val, i) => {
      ctx.fillText(String(val), cols[i + 1], y);
    });
    // Aura, signed and coloured — the number everybody actually checks.
    ctx.font = aeroFont(20, 900);
    ctx.fillStyle = s.aura > 0 ? '#c99700' : s.aura < 0 ? '#9b30d0' : AERO.textDim;
    ctx.fillText(s.aura > 0 ? `+${s.aura}` : String(s.aura), cols[8], y);
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
    ['NOT LIVE?', 'score too soon and YOU go in goal'],
    ['ONE BOUNCE', 'dead — unless you hit it AS it lands'],
    ['THE FENCE', 'bounce off it fine — over it, in goal'],
    ['SAVED?', 'shooter goes in goal. keeper goes wide'],
    ['T·W·O·T', 'concede 4 and face the slap line: ±AURA'],
  ];
  let y = 98;
  for (const [head, body] of lines) {
    ctx.textAlign = 'left';
    ctx.font = aeroFont(19, 900);
    ctx.fillStyle = AERO.aquaDeep;
    ctx.fillText(head, 36, y);
    ctx.font = aeroFont(17, 700);
    ctx.fillStyle = AERO.text;
    ctx.fillText(body, 172, y);
    y += 33;
  }
  ctx.textAlign = 'center';
}

/**
 * The in-game pause panel — press A (or X) to summon/dismiss it.
 * Two pills: back to the ball, or back to the lobby.
 */
function drawPause(ctx: CanvasRenderingContext2D, hover: boolean): void {
  glassPanel(ctx, 8, 8, PW - 16, PH - 16, { radius: 34, bubbles: 4, stroke: hover ? AERO.lime : AERO.stroke });
  headline(ctx, 'PAUSED', PW / 2, 60, 52, AERO.aqua);
  pillButton(ctx, 96, 104, PW - 192, 70, 'RESUME', AERO.lime, hover);
  pillButton(
    ctx,
    96,
    190,
    PW - 192,
    70,
    app.view === 'pavilion' ? 'VIEW: PAVILION' : 'VIEW: PASSTHROUGH',
    app.view === 'pavilion' ? AERO.violet : AERO.aqua,
    hover,
  );
  pillButton(ctx, 96, 276, PW - 192, 70, 'LEAVE — LOBBY', AERO.bubblegum, hover);
  ctx.font = aeroFont(19, 700);
  ctx.fillStyle = AERO.textDim;
  ctx.fillText('press A to dismiss', PW / 2, 372);
}

function hitPause(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PH;
  if (x >= 96 && x <= PW - 96 && y >= 104 && y <= 174) return 'resume';
  if (x >= 96 && x <= PW - 96 && y >= 190 && y <= 260) return 'toggle-view';
  if (x >= 96 && x <= PW - 96 && y >= 276 && y <= 346) return 'leave';
  return null;
}

/** Standalone pause panel (not part of the lobby group). */
export function createPausePanel(): MenuPanel {
  const panel = makePanel('pause', 0.62, 0.48, drawPause, hitPause);
  panel.mesh.position.set(0, 1.45, -0.95);
  panel.mesh.visible = false;
  return panel;
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
