/**
 * Owns the lakeside pavilion: builds it once (hidden) into arena-root so it
 * re-anchors with the court, applies the persisted view choice, animates
 * the ambient life (water, boats, clouds) while visible, and keeps the LED
 * scoreboard running its live TWOT feed — score, combo, the letters of
 * shame, top scorers and the aura king.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { app, type ViewMode } from '../menu/appState.js';
import { playerById, roster } from '../game/roster.js';
import { ball, keeperId, rally } from '../game/state.js';
import { arenaRefs } from '../arena/arena.js';
import { drawFootball } from '../arena/banner.js';
import { boardAccent } from '../ui/aero.js';
import {
  AERO,
  aeroFont,
  BOARD,
  boardGlow,
  boardLabel,
  boardPanel,
  heatBar,
  letterTrack,
  liveLamp,
} from '../ui/aero.js';
import { buildPavilion, setPavilionView, tickPavilion, type PavilionRig } from '../pavilion/pavilion.js';

const _head = new Vector3();
const _rootPos = new Vector3();
const _rootQ = new Quaternion();

export class PavilionSystem extends createSystem({}) {
  private rig!: PavilionRig;
  private time = 0;
  private boardTimer = 0;
  private lastView: ViewMode | null = null;

  init(): void {
    this.rig = buildPavilion(this.world);
    arenaRefs.root.add(this.rig.root);
  }

  update(delta: number): void {
    this.time += delta;

    if (app.view !== this.lastView) {
      this.lastView = app.view;
      setPavilionView(this.world, app.view);
      this.drawBoard();
    }
    if (app.view !== 'pavilion') return;

    // The shadow map is baked once and frozen (static scene, Quest-friendly)
    // — but the whole pavilion rides arena-root, which re-anchors on PLAY and
    // every keeper rotation. A frozen map from the old anchor paints a giant
    // stale shadow edge across the court, so re-bake whenever the root moves.
    if (!_rootPos.equals(arenaRefs.root.position) || !_rootQ.equals(arenaRefs.root.quaternion)) {
      _rootPos.copy(arenaRefs.root.position);
      _rootQ.copy(arenaRefs.root.quaternion);
      this.world.renderer.shadowMap.needsUpdate = true;
    }

    const head = this.playerHeadEntity?.object3D;
    if (head) head.getWorldPosition(_head);
    tickPavilion(delta, this.time, head ? _head : null);

    this.boardTimer -= delta;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      this.drawBoard();
    }
  }

  /** The LED feed — the same arena-board language as the goal HUD. */
  private drawBoard(): void {
    const ctx = this.rig.scoreCanvas.getContext('2d')!;
    const W = 640; // logical size — the canvas carries 2× pixels
    const H = 320;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#02060b'; // dead-pixel black behind the panel
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    boardPanel(ctx, 4, 4, W - 8, H - 8, 20);

    // Header: the wordmark (the O is a football, obviously) + who's in goal.
    boardGlow(ctx, 'TW', 26, 34, 40, AERO.lime, 'left');
    const twW = ctx.measureText('TW').width;
    drawFootball(ctx, 26 + twW + 21, 34, 18, 1);
    boardGlow(ctx, 'T', 26 + twW + 43, 34, 40, AERO.lime, 'left');
    const gk = playerById(keeperId());
    boardGlow(ctx, `${gk.name} · ${Math.floor(rally.keeperClock)}s`, W - 26, 34, 26, boardAccent(gk.accent), 'right');
    const gkW = ctx.measureText(`${gk.name} · ${Math.floor(rally.keeperClock)}s`).width;
    boardLabel(ctx, 'GK', W - 26 - gkW - 12, 34, 'right', 20);
    ctx.fillStyle = BOARD.hairline;
    ctx.fillRect(18, 60, W - 36, 1.5);

    // Main row: score | combo + heat + lamp | the letter track.
    boardLabel(ctx, 'SCORE', 28, 92);
    boardGlow(ctx, String(rally.score), 28, 148, 58, BOARD.value);

    const hot = Math.min(1, ball.heat / 1.5);
    const comboColor = hot > 0.05
      ? `rgb(255,${Math.round(212 - hot * 130)},${Math.round(110 - hot * 90)})`
      : BOARD.value;
    boardLabel(ctx, 'COMBO', 320, 92, 'center');
    boardGlow(ctx, `×${rally.combo}`, 320, 146, 58, comboColor, 'center');
    heatBar(ctx, 262, 182, 116, 9, hot);
    liveLamp(ctx, 320, 207, 116, 25, rally.live && rally.phase === 'rally');

    letterTrack(ctx, W - 26, 96, 44, 56, 9, rally.conceded);

    // Ticker: top scorers this session + the aura king of all time.
    ctx.fillStyle = BOARD.hairline;
    ctx.fillRect(18, 232, W - 36, 1.5);
    const goals = Object.entries(rally.goals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => `${playerById(id).name} ${n}`)
      .join('  ·  ');
    boardLabel(ctx, 'GOALS', 28, 262, 'left', 20);
    ctx.font = aeroFont(22, 800);
    ctx.textAlign = 'left';
    ctx.fillStyle = BOARD.value;
    ctx.fillText(goals || '— none yet —', 126, 262);
    const auraKing = [...roster].sort((a, b) => b.stats.aura - a.stats.aura)[0];
    boardLabel(ctx, 'AURA KING', 28, 296, 'left', 20);
    boardGlow(
      ctx,
      auraKing.stats.aura > 0 ? `${auraKing.name} +${auraKing.stats.aura}` : '— vacant —',
      172, 296, 22, '#ffd700', 'left', 800,
    );

    this.rig.scoreTexture.needsUpdate = true;
  }
}
