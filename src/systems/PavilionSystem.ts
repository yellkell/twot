/**
 * Owns the lakeside pavilion: builds it once (hidden) into arena-root so it
 * re-anchors with the court, applies the persisted view choice, animates
 * the ambient life (water, boats, clouds) while visible, and keeps the LED
 * scoreboard running its live TWOT feed — score, combo, the letters of
 * shame, top scorers and the aura king.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { app, type ViewMode } from '../menu/appState.js';
import { playerById, roster } from '../game/roster.js';
import { keeperId, rally, twotLetters } from '../game/state.js';
import { arenaRefs } from '../arena/arena.js';
import { buildPavilion, setPavilionView, tickPavilion, type PavilionRig } from '../pavilion/pavilion.js';

const _head = new Vector3();

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

    const head = this.playerHeadEntity?.object3D;
    if (head) head.getWorldPosition(_head);
    tickPavilion(delta, this.time, head ? _head : null);

    this.boardTimer -= delta;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      this.drawBoard();
    }
  }

  /** The LED feed: dark glass, lime digits, the word of shame in red. */
  private drawBoard(): void {
    const canvas = this.rig.scoreCanvas;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#04070c';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    const led = (px: number, weight = 900) => `${weight} ${px}px 'Trebuchet MS', Verdana, monospace`;

    // Header strip.
    ctx.textAlign = 'left';
    ctx.font = led(44);
    ctx.fillStyle = '#9be82a';
    ctx.fillText('TW⚽T', 24, 36);
    ctx.textAlign = 'right';
    ctx.font = led(26, 700);
    ctx.fillStyle = '#4fb7ff';
    const gk = playerById(keeperId());
    ctx.fillText(`GK ${gk.name} ${Math.floor(rally.keeperClock)}s`, W - 24, 36);
    ctx.strokeStyle = '#12324a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, 64);
    ctx.lineTo(W - 16, 64);
    ctx.stroke();

    // Score + combo + letters.
    ctx.textAlign = 'left';
    ctx.font = led(24, 700);
    ctx.fillStyle = '#6a86a0';
    ctx.fillText('SCORE', 24, 96);
    ctx.fillText('COMBO', 24, 168);
    ctx.font = led(52);
    ctx.fillStyle = '#eaffea';
    ctx.fillText(String(rally.score), 140, 96);
    ctx.fillStyle = rally.live ? '#9be82a' : '#eaffea';
    ctx.fillText(`×${rally.combo}`, 140, 168);
    const letters = twotLetters();
    ctx.textAlign = 'right';
    ctx.font = led(64);
    ctx.fillStyle = '#ff4040';
    ctx.fillText(letters || '····', W - 24, 132);

    // Ticker: top scorers this session + the aura king of all time.
    const goals = Object.entries(rally.goals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => `${playerById(id).name} ${n}`)
      .join('  ·  ');
    const auraKing = [...roster].sort((a, b) => b.stats.aura - a.stats.aura)[0];
    ctx.textAlign = 'left';
    ctx.font = led(22, 700);
    ctx.fillStyle = '#3d5a72';
    ctx.fillText('GOALS', 24, 232);
    ctx.fillStyle = '#cfe6ff';
    ctx.fillText(goals || '— none yet —', 130, 232);
    ctx.fillStyle = '#3d5a72';
    ctx.fillText('AURA KING', 24, 280);
    ctx.fillStyle = '#ffd700';
    ctx.fillText(
      auraKing.stats.aura > 0 ? `${auraKing.name} +${auraKing.stats.aura}` : '— vacant —',
      160,
      280,
    );

    this.rig.scoreTexture.needsUpdate = true;
  }
}
