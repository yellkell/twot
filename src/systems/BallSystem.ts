/**
 * THE BALL — physics + presentation for the one ball everybody shares.
 *
 * Physics (world space, integrated here from the `ball` bus that the strike
 * resolver writes into): gravity that gets meaner as the ball shrinks, air
 * drag, and a Magnus term (spin × velocity) so slapped-in spin visibly
 * CURVES flight. The floor is fatal: the first bounce starts the half-volley
 * clock; GameFlowSystem calls time of death when the window shuts.
 *
 * Presentation: a glossy black-and-white football that shrinks as the combo
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

/**
 * A geometrically CORRECT football, computed per-texel: the 12 black
 * pentagons sit at the vertices of an icosahedron projected onto the
 * sphere (exactly where a truncated-icosahedron ball puts them), so the
 * pattern reads right from every angle — no smeared equirect rows.
 */
function soccerBallTexture(): CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);

  // The 12 icosahedron vertex directions (normalized (0, ±1, ±φ) cycles).
  const PHI = (1 + Math.sqrt(5)) / 2;
  const raw: Array<[number, number, number]> = [];
  for (const a of [-1, 1]) {
    for (const b of [-PHI, PHI]) {
      raw.push([0, a, b], [a, b, 0], [b, 0, a]);
    }
  }
  const inv = 1 / Math.hypot(1, PHI);
  const centers = raw.map(([x, y, z]) => [x * inv, y * inv, z * inv] as const);
  // Per-centre tangent frames for a stable pentagon orientation.
  const frames = centers.map(([cx, cy, cz]) => {
    const upx = Math.abs(cy) > 0.9 ? 1 : 0;
    const upy = Math.abs(cy) > 0.9 ? 0 : 1;
    let t1x = upy * cz - 0 * cy;
    let t1y = 0 * cx - upx * cz;
    let t1z = upx * cy - upy * cx;
    const l = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= l; t1y /= l; t1z /= l;
    const t2x = cy * t1z - cz * t1y;
    const t2y = cz * t1x - cx * t1z;
    const t2z = cx * t1y - cy * t1x;
    return { t1x, t1y, t1z, t2x, t2y, t2z };
  });

  const PENT_R = 0.31; // angular in-radius of each pentagon (radians)
  const SEAM = 0.035; // grey seam ring width around the pentagon edge
  const FIVE = (Math.PI * 2) / 5;

  for (let py = 0; py < H; py++) {
    const lat = Math.PI * (0.5 - (py + 0.5) / H);
    const cl = Math.cos(lat);
    const y = Math.sin(lat);
    for (let px = 0; px < W; px++) {
      const lon = ((px + 0.5) / W) * Math.PI * 2 - Math.PI;
      const x = cl * Math.sin(lon);
      const z = cl * Math.cos(lon);

      // Leather base with soft shading.
      let r = 246;
      let g = 250;
      let b = 253;
      for (let i = 0; i < 12; i++) {
        const c = centers[i];
        const dot = x * c[0] + y * c[1] + z * c[2];
        if (dot < 0.9) continue; // > ~25° away — can't be this pentagon
        const ang = Math.acos(Math.min(1, dot));
        if (ang > PENT_R / Math.cos(Math.PI / 5) + SEAM) continue;
        // Azimuth about the centre → five-fold polygon radius.
        const f = frames[i];
        const u = x * f.t1x + y * f.t1y + z * f.t1z;
        const v = x * f.t2x + y * f.t2y + z * f.t2z;
        const az = Math.atan2(v, u);
        const edge = PENT_R / Math.cos(((az % FIVE) + FIVE + FIVE / 2) % FIVE - FIVE / 2);
        if (ang <= edge) {
          r = 18; g = 22; b = 28; // the pentagon
        } else if (ang <= edge + SEAM) {
          r = 150; g = 162; b = 172; // stitched seam ring
        }
        break;
      }
      const o = (py * W + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

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
      map: soccerBallTexture(),
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
    // The ball sits out the TWOT ceremony — all eyes on the keeper.
    const show = app.state === 'playing' && rally.phase !== 'idle' && rally.phase !== 'punish';
    this.group.visible = show;
    if (!show) return;

    switch (rally.phase) {
      case 'serve':
        this.settleAtServer(delta);
        break;
      case 'rally':
      case 'dead':
      case 'rotate': {
        // Substep long frames so a fast ball can't tunnel the floor or the
        // goal plane when the frame rate hiccups.
        let remaining = delta;
        while (remaining > 0) {
          const dt = Math.min(remaining, 1 / 45);
          this.integrate(dt, rally.phase === 'rally');
          remaining -= dt;
        }
        break;
      }
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

    // A generous invisible sports hall keeps the ball in the room. The
    // ceiling sits well above the fence so clearing it stays possible, and
    // the side walls beyond the fence's 16 m span wherever it's anchored.
    const WALL = 14;
    const CEIL = 14;
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

    // Burn crossfade: the leather CHARS under the flames instead of fading
    // out — the shell always keeps solid, alpha-writing pixels, so the ball
    // never vanishes against raw passthrough (additive fire alone writes no
    // alpha, which is exactly how it used to disappear overhead).
    const burn = Math.min(1, Math.max(0, (ball.heat - 0.25) / 0.9));
    this.shellMat.opacity = 1 - burn * 0.35;
    const char = 1 - burn * 0.82;
    this.shellMat.color.setRGB(char, char * 0.92, char * 0.85);
    this.shell.visible = true;
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
