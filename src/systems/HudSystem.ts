/**
 * The scoreboard — a strip of aero glass bolted under the title banner above
 * the goal: session score, the big combo counter (which warms up as the ball
 * does), the LIVE lamp, who's in goal and how long they've held the gloves,
 * and the headline message line ("HALF VOLLEY!", "BAZZA TAKES THE GLOVES…").
 */

import { createSystem } from '@iwsdk/core';
import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { app } from '../menu/appState.js';
import { GOAL } from '../config.js';
import { playerById } from '../game/roster.js';
import { ball, keeperId, rally } from '../game/state.js';
import { arenaRefs } from '../arena/arena.js';
import { twotBoard } from '../arena/banner.js';
import {
  aeroFont,
  BOARD,
  boardGlow,
  boardLabel,
  boardPanel,
  heatBar,
  letterTrack,
  liveLamp,
  roundPath,
} from '../ui/aero.js';

/** Accent hex lifted toward white so team colours read on the dark board. */
export function boardAccent(accent: number, lift = 0.35): string {
  const r = Math.round(((accent >> 16) & 0xff) * (1 - lift) + 255 * lift);
  const g = Math.round(((accent >> 8) & 0xff) * (1 - lift) + 255 * lift);
  const b = Math.round((accent & 0xff) * (1 - lift) + 255 * lift);
  return `rgb(${r},${g},${b})`;
}

const W = 1024;
const H = 288;

export class HudSystem extends createSystem({}) {
  private mesh!: Mesh;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private redrawTimer = 0;

  init(): void {
    const canvas = document.createElement('canvas');
    // 2× supersample so the message line reads from the arc.
    canvas.width = W * 2;
    canvas.height = H * 2;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(2, 2);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.texture = new CanvasTexture(canvas);
    this.texture.minFilter = LinearFilter;
    this.mesh = new Mesh(
      new PlaneGeometry(2.3, 0.65),
      new MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    this.mesh.name = 'scoreboard';
    this.mesh.position.set(0, GOAL.height + 0.78, -0.36);
    this.mesh.rotation.x = -0.06;
    this.mesh.visible = false;
    arenaRefs.root.add(this.mesh);
  }

  update(delta: number): void {
    twotBoard?.tick(delta); // the letter-pop punch runs every frame
    const show = app.state === 'playing';
    this.mesh.visible = show;
    if (!show) return;
    this.redrawTimer -= delta;
    if (this.redrawTimer > 0) return;
    this.redrawTimer = 0.12;
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    boardPanel(ctx, 6, 6, W - 12, H - 12, 34);

    // Column dividers.
    ctx.fillStyle = BOARD.hairline;
    ctx.fillRect(330, 30, 1.5, 162);
    ctx.fillRect(700, 30, 1.5, 162);

    // --- SCORE, left. ---
    boardLabel(ctx, 'SCORE', 42, 50);
    boardGlow(ctx, String(rally.score), 42, 126, 76, BOARD.value);

    // --- COMBO, centre — digits warm with the ball, heat bar underneath. ---
    const hot = Math.min(1, ball.heat / 1.5);
    const comboColor = hot > 0.05
      ? `rgb(255,${Math.round(212 - hot * 130)},${Math.round(110 - hot * 90)})`
      : BOARD.value;
    boardLabel(ctx, 'COMBO', 515, 50, 'center');
    boardGlow(ctx, `×${rally.combo}`, 515, 118, 82, comboColor, 'center');
    heatBar(ctx, 425, 154, 180, 11, hot);
    liveLamp(ctx, 515, 182, 150, 30, rally.live && rally.phase === 'rally');

    // --- IN GOAL, right — keeper, stint clock, letter track. ---
    const gk = playerById(keeperId());
    boardLabel(ctx, `IN GOAL · ${Math.floor(rally.keeperClock)}s`, W - 42, 50, 'right');
    boardGlow(ctx, gk.name, W - 42, 112, 42, boardAccent(gk.accent), 'right');
    letterTrack(ctx, W - 42, 148, 36, 44, 8, rally.conceded);

    // --- Message band. ---
    roundPath(ctx, 16, 206, W - 32, 68, 16);
    ctx.fillStyle = BOARD.inset;
    ctx.fill();
    roundPath(ctx, 16, 206, W - 32, 68, 16);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = BOARD.hairline;
    ctx.stroke();
    if (rally.message) {
      boardGlow(ctx, rally.message, W / 2, 241, 40, rally.messageColor, 'center');
    } else {
      const goals = Object.entries(rally.goals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${playerById(id).name} ${n}`)
        .join('   ·   ');
      ctx.font = aeroFont(26, 700);
      ctx.textAlign = 'center';
      ctx.fillStyle = BOARD.slate;
      ctx.fillText(goals ? `GOALS   ${goals}` : 'first to three touches makes it LIVE', W / 2, 241);
    }

    this.texture.needsUpdate = true;
  }
}
