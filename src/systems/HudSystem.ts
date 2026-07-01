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
import { AERO, aeroFont, glassPanel } from '../ui/aero.js';

const W = 1024;
const H = 288;

export class HudSystem extends createSystem({}) {
  private mesh!: Mesh;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private redrawTimer = 0;

  init(): void {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
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
    glassPanel(ctx, 6, 6, W - 12, H - 12, { radius: 40, bubbles: 0 });

    // Score, left.
    ctx.textAlign = 'left';
    ctx.font = aeroFont(30, 800);
    ctx.fillStyle = AERO.textDim;
    ctx.fillText('SCORE', 52, 66);
    ctx.font = aeroFont(58, 900);
    ctx.fillStyle = AERO.text;
    ctx.fillText(String(rally.score), 52, 122);

    // Combo, centre — warms with the ball.
    const combo = rally.combo;
    const hot = Math.min(1, ball.heat / 1.2);
    const comboColor = hot > 0.05
      ? `rgb(255,${Math.round(200 - hot * 120)},${Math.round(80 - hot * 60)})`
      : AERO.text;
    ctx.textAlign = 'center';
    ctx.font = aeroFont(34, 800);
    ctx.fillStyle = AERO.textDim;
    ctx.fillText('COMBO', W / 2, 58);
    ctx.font = aeroFont(84, 900);
    ctx.fillStyle = comboColor;
    ctx.fillText(`×${combo}`, W / 2, 128);

    // LIVE lamp.
    if (rally.live && rally.phase === 'rally') {
      ctx.font = aeroFont(30, 900);
      ctx.fillStyle = AERO.lime;
      ctx.fillText('● LIVE', W / 2 + 190, 58);
    }

    // Keeper, right.
    const gk = playerById(keeperId());
    ctx.textAlign = 'right';
    ctx.font = aeroFont(30, 800);
    ctx.fillStyle = AERO.textDim;
    ctx.fillText('IN GOAL', W - 52, 66);
    ctx.font = aeroFont(44, 900);
    ctx.fillStyle = `#${gk.accent.toString(16).padStart(6, '0')}`;
    ctx.fillText(`${gk.name} · ${Math.floor(rally.keeperClock)}s`, W - 52, 122);

    // Message line.
    if (rally.message) {
      ctx.textAlign = 'center';
      ctx.font = aeroFont(44, 900);
      ctx.fillStyle = rally.messageColor;
      ctx.fillText(rally.message, W / 2, 218);
    } else {
      ctx.textAlign = 'center';
      ctx.font = aeroFont(30, 700);
      ctx.fillStyle = AERO.textDim;
      const goals = Object.entries(rally.goals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${playerById(id).name} ${n}`)
        .join('   ·   ');
      ctx.fillText(goals ? `GOALS  ${goals}` : 'first to three touches makes it LIVE', W / 2, 218);
    }

    this.texture.needsUpdate = true;
  }
}
