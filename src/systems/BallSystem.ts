/**
 * THE BALL — physics + presentation for the one ball everybody shares.
 *
 * Physics (world space, integrated here from the `ball` bus that the strike
 * resolver writes into): gravity that gets meaner as the ball shrinks, air
 * drag, and a Magnus term (spin × velocity) so slapped-in spin visibly
 * CURVES flight. The floor is fatal: the first bounce starts the half-volley
 * clock; GameFlowSystem calls time of death when the window shuts.
 *
 * Presentation: a glossy six-panel aero beach ball that shrinks as the combo
 * climbs, then progressively burns away into the harvested Iron Balls fire
 * (molten shader core + corona + ember/trail pools) as the rally ignites.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { app } from '../menu/appState.js';
import { BALL } from '../config.js';
import { playerById, stationOf, stationPose } from '../game/roster.js';
import { ball, gravityNow, heatForCombo, radiusForCombo, rally } from '../game/state.js';
import { arenaToWorld } from '../arena/arena.js';
import { createFireVisual, spawnEmber, stampTrail, type FireVisual } from '../fx/fire.js';
import { glowSprite } from '../materials/glow.js';
import * as sfx from '../audio/sfx.js';

/** Classic six-panel beach ball, painted once onto an equirect canvas. */
function beachBallTexture(): CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const panels = ['#f7fbff', '#29b6f6', '#f7fbff', '#9be82a', '#f7fbff', '#ffb226'];
  const seg = W / panels.length;
  panels.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * seg, 0, seg + 1, H);
  });
  // Seam lines + a soft polar cap.
  ctx.strokeStyle = 'rgba(8,58,94,0.25)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= panels.length; i++) {
    ctx.beginPath();
    ctx.moveTo(i * seg, 0);
    ctx.lineTo(i * seg, H);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(247,251,255,0.9)';
  ctx.fillRect(0, 0, W, 12);
  ctx.fillRect(0, H - 12, W, 12);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const _camQ = new Quaternion();
const _anchor = new Vector3();
const _accel = new Vector3();
const _axis = new Vector3();
const _dq = new Quaternion();
const _fwd = new Vector3();

export class BallSystem extends createSystem({}) {
  private group = new Group();
  private shell!: Mesh;
  private shellMat!: MeshPhysicalMaterial;
  private fire!: FireVisual;
  private liveGlow = glowSprite(0x9be82a, 1.6, 0.5);
  private time = 0;
  private trailAcc = 0;
  private emberAcc = 0;

  init(): void {
    this.shellMat = new MeshPhysicalMaterial({
      map: beachBallTexture(),
      roughness: 0.18,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      transparent: true,
    });
    this.shell = new Mesh(new SphereGeometry(BALL.baseRadius, 32, 24), this.shellMat);
    this.group.add(this.shell);

    this.fire = createFireVisual(0);
    this.fire.group.visible = false;
    this.group.add(this.fire.group);

    this.liveGlow.visible = false;
    this.group.add(this.liveGlow);

    this.group.visible = false;
    this.scene.add(this.group);
  }

  update(delta: number): void {
    this.time += delta;
    const show = app.state === 'playing' && rally.phase !== 'idle';
    this.group.visible = show;
    if (!show) return;

    switch (rally.phase) {
      case 'serve':
        this.settleAtServer(delta);
        break;
      case 'rally':
      case 'dead':
      case 'rotate':
        this.integrate(delta, rally.phase === 'rally');
        break;
    }

    this.present(delta);
  }

  /** Dead ball hovering at the server, waiting for the opening slap. */
  private settleAtServer(delta: number): void {
    const server = playerById(rally.server);
    if (server.isHuman) {
      const head = this.playerHeadEntity?.object3D;
      if (head) {
        head.getWorldPosition(_anchor);
        head.getWorldDirection(_fwd);
        _fwd.y = 0;
        if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
        // getWorldDirection points down +z; the player faces -z.
        _fwd.normalize().multiplyScalar(-BALL.serveAhead);
        _anchor.add(_fwd);
        _anchor.y = BALL.serveHeight;
      }
    } else {
      const st = stationOf(server.id);
      const pose = stationPose(st);
      arenaToWorld(
        pose.x + pose.fx * BALL.serveAhead,
        BALL.serveHeight,
        pose.z + pose.fz * BALL.serveAhead,
        _anchor,
      );
    }
    const k = 1 - Math.exp(-BALL.serveLerp * delta);
    ball.pos.lerp(_anchor, k);
    ball.vel.set(0, 0, 0);
    // A gentle bob so it looks alive while it waits.
    ball.pos.y += Math.sin(this.time * 2.2) * 0.012;
  }

  /** Ballistics + Magnus + the fatal floor. */
  private integrate(delta: number, alive: boolean): void {
    ball.vel.y -= gravityNow() * delta;
    // Magnus: spin × velocity curls the path — the curve shot.
    _accel.crossVectors(ball.spin, ball.vel).multiplyScalar(BALL.magnus);
    ball.vel.addScaledVector(_accel, delta);
    const drag = Math.max(0, 1 - BALL.drag * delta);
    ball.vel.multiplyScalar(drag);
    ball.spin.multiplyScalar(Math.max(0, 1 - BALL.spinDecay * delta));
    ball.pos.addScaledVector(ball.vel, delta);

    // Floor.
    if (ball.pos.y - ball.radius <= 0 && ball.vel.y < 0) {
      ball.pos.y = ball.radius;
      const speed = Math.abs(ball.vel.y);
      ball.vel.y = speed * BALL.bounce;
      ball.vel.x *= 0.8;
      ball.vel.z *= 0.8;
      ball.spin.multiplyScalar(0.5);
      if (alive && ball.bouncedAt < 0) {
        // The half-volley clock starts NOW. GameFlowSystem calls the death.
        ball.bouncedAt = rally.time;
        sfx.slap(0.2, 1);
      }
    }

    // A generous invisible sports hall keeps the ball in the room.
    const WALL = 10;
    const CEIL = 8;
    if (Math.abs(ball.pos.x) > WALL) {
      ball.pos.x = Math.sign(ball.pos.x) * WALL;
      ball.vel.x *= -0.4;
    }
    if (Math.abs(ball.pos.z) > WALL) {
      ball.pos.z = Math.sign(ball.pos.z) * WALL;
      ball.vel.z *= -0.4;
    }
    if (ball.pos.y > CEIL) {
      ball.pos.y = CEIL;
      ball.vel.y *= -0.4;
    }
  }

  /** Scale, burn, spin, glow, trail. */
  private present(delta: number): void {
    // Radius/heat chase their combo targets so shrink + ignition feel smooth.
    const k = Math.min(1, delta * 6);
    ball.radius += (radiusForCombo(rally.combo) - ball.radius) * k;
    ball.heat += (heatForCombo(rally.combo) - ball.heat) * k;
    if (rally.phase === 'dead') ball.heat = Math.max(0, ball.heat - delta * 1.5);

    this.group.position.copy(ball.pos);
    this.group.scale.setScalar(ball.radius / BALL.baseRadius);

    // Roll the shell by its spin (plus a lazy tumble from travel).
    const spinMag = ball.spin.length();
    if (spinMag > 0.01) {
      _axis.copy(ball.spin).normalize();
      _dq.setFromAxisAngle(_axis, spinMag * delta);
      this.shell.quaternion.premultiply(_dq);
    }

    // Burn-away crossfade: sports ball → fireball.
    const burn = Math.min(1, Math.max(0, (ball.heat - 0.25) / 0.9));
    this.shellMat.opacity = 1 - burn;
    this.shell.visible = burn < 0.98;
    const fireOn = ball.heat > 0.05;
    this.fire.group.visible = fireOn;
    if (fireOn) {
      this.world.camera.getWorldQuaternion(_camQ);
      this.fire.update(this.time, 0.3 + ball.heat, _camQ);
    }

    // LIVE halo: a slow lime pulse so everyone knows it can be buried.
    this.liveGlow.visible = rally.live && rally.phase === 'rally';
    if (this.liveGlow.visible) {
      const pulse = 1.35 + Math.sin(this.time * 5) * 0.18;
      this.liveGlow.scale.setScalar(pulse);
      this.liveGlow.material.opacity = 0.32 + Math.sin(this.time * 5) * 0.1;
    }

    // Comet trail + drifting embers once it's burning and moving.
    const speed = ball.vel.length();
    if (ball.heat > 0.35 && speed > 2 && rally.phase === 'rally') {
      this.trailAcc += delta;
      if (this.trailAcc >= 0.014) {
        this.trailAcc = 0;
        stampTrail(ball.pos);
      }
    }
    if (ball.heat > 0.25) {
      this.emberAcc += delta;
      if (this.emberAcc >= 0.1) {
        this.emberAcc = 0;
        spawnEmber(ball.pos, 0.5);
      }
    }
  }
}
