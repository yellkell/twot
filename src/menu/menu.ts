/**
 * The lobby: three panes of the same smoked arena-board glass the scoreboard
 * wears — the menu speaks the board language now, not the old aero candy.
 * Centre = the wordmark + the PLAY slot; left = the CLUB SHEET (persistent
 * stats for all six of you, both positions, AURA last); right = how to play.
 * Each panel is a canvas texture on a plane; MenuSystem raycasts the
 * controllers for hover + click and maps the hit UV to an action zone (the
 * exact mechanism Iron Balls used — it was too good not to harvest).
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three';
import { app } from './appState.js';
import { avgKeeperTime, roster } from '../game/roster.js';
import { rally } from '../game/state.js';
import { park } from '../net/parkState.js';
import { drawFootball } from '../arena/banner.js';
import {
  AERO,
  aeroFont,
  BOARD,
  boardAccent,
  boardButton,
  boardGlow,
  boardLabel,
  boardPanel,
  letterTrack,
  roundPath,
} from '../ui/aero.js';

export type PanelId = 'play' | 'stats' | 'howto' | 'pause';

export type MenuAction =
  | 'play'
  | 'toggle-difficulty'
  | 'toggle-view'
  | 'reset-stats'
  | 'resume'
  | 'leave'
  | 'join-park'
  | 'leave-park'
  | 'reroll-callsign';

const PW = 512;
const PH = 400;
/** The PLAY pane runs taller — room for the wordmark AND the button stack. */
const PLAY_H = 460;

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
  // Supersample 2×: the draw code keeps its logical coordinates, but the
  // texture carries double the pixels — text stays crisp at arm's length.
  const DPI = 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW * DPI;
  canvas.height = canvasH * DPI;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPI, DPI);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.colorSpace = SRGBColorSpace; // keep the dark board face dark
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

/** Centre — the marquee (the O is a football, obviously) + the PLAY slot. */
function drawPlay(ctx: CanvasRenderingContext2D, hover: boolean): void {
  boardPanel(ctx, 8, 8, PW - 16, PLAY_H - 16, 34);

  ctx.textBaseline = 'middle';
  boardGlow(ctx, 'TW', PW / 2 - 92, 68, 80, BOARD.value, 'center');
  drawFootball(ctx, PW / 2 + 46, 66, 36, 1);
  boardGlow(ctx, 'T', PW / 2 + 134, 68, 80, BOARD.value, 'center');

  // The TWOT-red rule — the letters' colour underlining the name they spell.
  ctx.save();
  ctx.shadowColor = '#ff2617';
  ctx.shadowBlur = 12;
  roundPath(ctx, 116, 110, PW - 232, 5, 2.5);
  ctx.fillStyle = '#e02b1d';
  ctx.fill();
  ctx.restore();

  boardButton(ctx, 86, 126, PW - 172, 68, 'PLAY', AERO.lime, hover);

  // The park slot — its label doubles as the connection status line.
  const parkLabel =
    park.status === 'connecting' ? 'CONNECTING…'
    : park.status === 'in-park' ? `IN THE PARK · ${park.count}/${park.capacity}`
    : park.status === 'error' ? 'PARK OFFLINE — RETRY'
    : 'JOIN PARK';
  boardButton(ctx, 86, 204, PW - 172, 54, parkLabel, '#ffd700', hover);

  boardButton(
    ctx,
    116,
    268,
    PW - 232,
    46,
    `BOTS: ${app.difficulty === 'pro' ? 'PRO' : 'CASUAL'}`,
    app.difficulty === 'pro' ? AERO.sun : AERO.aqua,
    hover,
  );
  boardButton(
    ctx,
    116,
    322,
    PW - 232,
    46,
    app.view === 'pavilion' ? 'VIEW: PAVILION' : 'VIEW: PASSTHROUGH',
    app.view === 'pavilion' ? AERO.violet : AERO.aqua,
    hover,
  );

  // Callsign row: the name other punters see, with the reroll die.
  boardLabel(ctx, 'CALLSIGN', 92, 396, 'left', 16);
  boardGlow(ctx, park.callsign, 196, 396, 20, '#7ed6ff', 'left', 800);
  boardButton(ctx, 368, 382, 48, 28, '⟳', AERO.aqua, hover);

  ctx.font = aeroFont(17, 700);
  ctx.textAlign = 'center';
  ctx.fillStyle = BOARD.slate;
  ctx.fillText(
    rally.score > 0 || rally.bestCombo > 0
      ? `last session — score ${rally.score} · best combo ×${rally.bestCombo}`
      : 'press A in-game to pause or leave',
    PW / 2,
    436,
  );
}

function hitPlay(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PLAY_H;
  if (x >= 86 && x <= PW - 86 && y >= 126 && y <= 194) return 'play';
  if (x >= 86 && x <= PW - 86 && y >= 204 && y <= 258) {
    return park.status === 'in-park' ? 'leave-park' : 'join-park';
  }
  if (x >= 116 && x <= PW - 116 && y >= 268 && y <= 314) return 'toggle-difficulty';
  if (x >= 116 && x <= PW - 116 && y >= 322 && y <= 368) return 'toggle-view';
  if (x >= 368 && x <= 416 && y >= 382 && y <= 410) return 'reroll-callsign';
  return null;
}

/** Left — the CLUB SHEET: lifetime numbers for every player, both jobs. */
function drawStats(ctx: CanvasRenderingContext2D, hover: boolean): void {
  const W = 640;
  const H = 480;
  boardPanel(ctx, 8, 8, W - 16, H - 16, 34);
  ctx.textBaseline = 'middle';
  boardGlow(ctx, 'CLUB SHEET', W / 2, 52, 40, BOARD.value, 'center');

  const cols = [172, 226, 280, 334, 388, 442, 496, 550, 604];
  const heads = ['GLS', 'AST', 'SHT', 'SAV', 'GK⌀', 'PAS', 'H-V', 'CMB', 'AURA'];
  heads.forEach((h, i) => {
    boardLabel(ctx, h, cols[i], 102, 'center', 17);
  });
  ctx.fillStyle = BOARD.hairline;
  ctx.fillRect(26, 118, W - 52, 1.5);

  let y = 150;
  for (const p of roster) {
    ctx.textAlign = 'left';
    ctx.font = aeroFont(19, 900);
    ctx.fillStyle = `#${p.accent.toString(16).padStart(6, '0')}`;
    ctx.fillText('●', 26, y);
    ctx.fillStyle = boardAccent(p.accent);
    ctx.fillText(p.name, 50, y);
    ctx.textAlign = 'center';
    ctx.font = aeroFont(19, 700);
    ctx.fillStyle = BOARD.value;
    const s = p.stats;
    const row = [s.goals, s.assists, s.shots, s.saves, avgKeeperTime(p), s.passes, s.halfVolleys, s.bestCombo];
    row.forEach((val, i) => {
      ctx.fillText(String(val), cols[i], y);
    });
    // Aura, signed and glowing — the number everybody actually checks.
    if (s.aura > 0) boardGlow(ctx, `+${s.aura}`, cols[8], y, 19, '#ffd700', 'center');
    else if (s.aura < 0) boardGlow(ctx, String(s.aura), cols[8], y, 19, '#c86bff', 'center');
    else {
      ctx.font = aeroFont(19, 900);
      ctx.fillStyle = BOARD.slate;
      ctx.fillText('0', cols[8], y);
    }
    y += 44;
  }

  boardButton(ctx, W / 2 - 110, H - 62, 220, 42, 'RESET SHEET', AERO.danger, hover);
}

function hitStats(u: number, v: number): MenuAction | null {
  const x = u * 640;
  const y = (1 - v) * 480;
  if (x >= 210 && x <= 430 && y >= 418 && y <= 460) return 'reset-stats';
  return null;
}

/** Right — how to play. */
function drawHowto(ctx: CanvasRenderingContext2D, _hover: boolean): void {
  boardPanel(ctx, 8, 8, PW - 16, PH - 16, 34);
  ctx.textBaseline = 'middle';
  boardGlow(ctx, 'THE RULES', PW / 2, 52, 40, AERO.sun, 'center');

  const lines: Array<[string, string]> = [
    ['KEEP IT UP', 'slap it — palms, fingers, or HEAD it'],
    ['3 TOUCHES', 'three players in — the ball is LIVE'],
    ['COMBO', 'every pass shrinks it… then it burns'],
    ['SHOOT', 'power-slap the live ball at the goal'],
    ['NOT LIVE?', 'score too soon and YOU go in goal'],
    ['ONE BOUNCE', 'dead — unless you hit it AS it lands'],
    ['THE FENCE', 'bounce off it fine — over it, in goal'],
    ['SAVED?', 'shooter goes in goal. keeper goes wide'],
  ];
  let y = 96;
  for (const [head, body] of lines) {
    ctx.textAlign = 'left';
    ctx.font = aeroFont(18, 900);
    ctx.fillStyle = '#7ed6ff';
    ctx.fillText(head, 36, y);
    ctx.font = aeroFont(17, 700);
    ctx.fillStyle = BOARD.value;
    ctx.fillText(body, 172, y);
    y += 33;
  }
  // The last law gets the real letters: a mini T·W·O·T track, fully lit.
  letterTrack(ctx, 152, y - 13, 24, 26, 5, 4);
  ctx.textAlign = 'left';
  ctx.font = aeroFont(17, 700);
  ctx.fillStyle = BOARD.value;
  ctx.fillText('concede 4 and face the slap line: ±AURA', 172, y);
  ctx.textAlign = 'center';
}

/**
 * The in-game pause panel — press A (or X) to summon/dismiss it.
 * Three slots: back to the ball, flip the view, or back to the lobby.
 */
function drawPause(ctx: CanvasRenderingContext2D, hover: boolean): void {
  boardPanel(ctx, 8, 8, PW - 16, PH - 16, 34);
  ctx.textBaseline = 'middle';
  boardGlow(ctx, 'PAUSED', PW / 2, 56, 46, BOARD.value, 'center');
  boardButton(ctx, 96, 104, PW - 192, 70, 'RESUME', AERO.lime, hover);
  boardButton(
    ctx,
    96,
    190,
    PW - 192,
    70,
    app.view === 'pavilion' ? 'VIEW: PAVILION' : 'VIEW: PASSTHROUGH',
    app.view === 'pavilion' ? AERO.violet : AERO.aqua,
    hover,
  );
  boardButton(ctx, 96, 276, PW - 192, 70, 'LEAVE — LOBBY', AERO.danger, hover);
  ctx.font = aeroFont(19, 700);
  ctx.textAlign = 'center';
  ctx.fillStyle = BOARD.slate;
  ctx.fillText('press A to dismiss', PW / 2, 368);
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

  const play = makePanel('play', 1.0, 0.9, drawPlay, hitPlay, PW, PLAY_H);
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
