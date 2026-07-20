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
  SRGBColorSpace,
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
  boardAccent,
  boardGlow,
  boardLabel,
  boardPanel,
  heatBar,
  letterTrack,
  liveLamp,
  roundPath,
} from '../ui/aero.js';

const W = 1024;
const H = 320;

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
    this.texture.colorSpace = SRGBColorSpace; // keep the dark board face dark
    this.mesh = new Mesh(
      new PlaneGeometry(2.55, 0.797),
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

    // Column divider — two columns now: the combo IS the score.
    ctx.fillStyle = BOARD.hairline;
    ctx.fillRect(560, 36, 1.5, 178);

    // --- COMBO, left — digits warm with the ball, heat bar underneath. ---
    const hot = Math.min(1, ball.heat / 1.5);
    const comboColor = hot > 0.05
      ? `rgb(255,${Math.round(212 - hot * 130)},${Math.round(110 - hot * 90)})`
      : BOARD.value;
    boardLabel(ctx, 'COMBO', 280, 58, 'center');
    boardGlow(ctx, `×${rally.combo}`, 280, 132, 92, comboColor, 'center');
    heatBar(ctx, 160, 180, 240, 12, hot);
    liveLamp(ctx, 280, 212, 156, 32, rally.live && rally.phase === 'rally');

    // --- IN GOAL, right — keeper, stint clock, letter track. ---
    const gk = playerById(keeperId());
    boardLabel(ctx, `IN GOAL · ${Math.floor(rally.keeperClock)}s`, W - 44, 58, 'right');
    boardGlow(ctx, gk.name, W - 44, 124, 44, boardAccent(gk.accent), 'right');
    letterTrack(ctx, W - 44, 162, 38, 48, 9, rally.conceded);

    // --- Message band. ---
    roundPath(ctx, 18, 238, W - 36, 68, 16);
    ctx.fillStyle = BOARD.inset;
    ctx.fill();
    roundPath(ctx, 18, 238, W - 36, 68, 16);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = BOARD.hairline;
    ctx.stroke();
    // Shrink to fit the band so nothing ever runs off the edge.
    const bandMaxW = W - 84;
    const fitPx = (text: string, target: number, weight: number): number => {
      ctx.font = aeroFont(target, weight);
      const w = ctx.measureText(text).width;
      return w > bandMaxW ? Math.floor(target * (bandMaxW / w)) : target;
    };
    if (rally.message) {
      boardGlow(ctx, rally.message, W / 2, 273, fitPx(rally.message, 40, 900), rally.messageColor, 'center');
    } else {
      const goals = Object.entries(rally.goals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${playerById(id).name} ${n}`)
        .join('   ·   ');
      const line = goals ? `GOALS   ${goals}` : 'three touches make the ball LIVE';
      ctx.font = aeroFont(fitPx(line, 26, 700), 700);
      ctx.textAlign = 'center';
      ctx.fillStyle = BOARD.slate;
      ctx.fillText(line, W / 2, 273);
    }

    this.texture.needsUpdate = true;
  }
}
