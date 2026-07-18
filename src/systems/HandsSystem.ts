/**
 * YOUR big floppy sports hands: one per controller, spring-following the
 * grips so they read as heavy thick rubber (see avatar/hands.ts for the
 * flop). This system also owns YOUR contact with the ball: when a palm
 * touches it with intent, the shared strike resolver plays it — slap,
 * power shot, curve, half volley or save — and the hand squashes + buzzes.
 *
 * Hand velocity comes from a short ring buffer of grip positions (the same
 * smoothed-punch trick Iron Balls used for throws), so haptics and shot
 * power track your real swing, not the sprung visual.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { Euler, type Sprite } from 'three';
import { app } from '../menu/appState.js';
import { HANDS, PALETTE } from '../config.js';
import { human } from '../game/roster.js';
import { ball, landPunishSlap, rally } from '../game/state.js';
import { strikeBall } from '../game/strike.js';
import { buildSportsHand, type SportsHand } from '../avatar/hands.js';
import { glowSprite } from '../materials/glow.js';
import { spawnRisingText, spawnTouchPop } from '../fx/effects.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';

const HAND_NAMES = ['left', 'right'] as const;

/** Ring buffer of recent hand positions → smoothed swing velocity. */
class VelocityTracker {
  private samples: { pos: Vector3; t: number }[] = [];

  push(pos: Vector3, t: number): void {
    this.samples.push({ pos: pos.clone(), t });
    while (this.samples.length > 12) this.samples.shift();
  }

  velocity(out: Vector3, now: number): Vector3 {
    out.set(0, 0, 0);
    const newest = this.samples[this.samples.length - 1];
    if (!newest) return out;
    let oldest = newest;
    for (const s of this.samples) {
      if (now - s.t <= 0.11) {
        oldest = s;
        break;
      }
    }
    const dt = newest.t - oldest.t;
    if (dt < 1e-3) return out;
    return out.copy(newest.pos).sub(oldest.pos).multiplyScalar(1 / dt);
  }

  reset(): void {
    this.samples.length = 0;
  }
}

/** Hand-local pose offset: tips the paddle so fingers lead the swing. */
const GRIP_OFFSET = new Quaternion().setFromEuler(new Euler(-0.45, 0, 0));

const _grip = new Vector3();
const _gripQ = new Quaternion();
const _targetQ = new Quaternion();
const _vel = new Vector3();

export class HandsSystem extends createSystem({}) {
  private hands: [SportsHand, SportsHand] | null = null;
  private auras: Sprite[] = [];
  private trackers: [VelocityTracker, VelocityTracker] = [new VelocityTracker(), new VelocityTracker()];
  private time = 0;

  init(): void {
    const left = buildSportsHand(human.accent, true);
    const right = buildSportsHand(human.accent, false);
    this.scene.add(left.group, right.group);
    this.hands = [left, right];
    // Golden ceremony auras — lit only when it's YOUR turn to slap.
    for (const hand of this.hands) {
      const aura = glowSprite(PALETTE.auraPlus, 0.5, 0.55);
      aura.visible = false;
      hand.group.add(aura);
      this.auras.push(aura);
    }
  }

  update(delta: number): void {
    this.time += delta;
    if (!this.hands) return;
    const show = app.state === 'playing';

    for (let h = 0; h < 2; h++) {
      const hand = this.hands[h];
      hand.setVisible(show);
      const grip = this.world.playerSpaceEntities.gripSpaces[HAND_NAMES[h]]?.object3D;
      if (!grip || !show) continue;

      grip.getWorldPosition(_grip);
      grip.getWorldQuaternion(_gripQ);
      _targetQ.copy(_gripQ).multiply(GRIP_OFFSET);

      const tracker = this.trackers[h];
      tracker.push(_grip, this.time);
      tracker.velocity(_vel, this.time);

      hand.update(delta, _grip, _targetQ, _vel);

      // Palm vs ball — the entire input model of this game.
      if (rally.phase === 'serve' || rally.phase === 'rally') {
        const reach = HANDS.contactRadius + ball.radius;
        if (hand.palmWorld.distanceToSquared(ball.pos) <= reach * reach) {
          const outcome = strikeBall(this.world, human.id, hand.palmWorld, _vel);
          if (outcome) {
            hand.impact(outcome.strength);
            pulseHand(
              this.world.session,
              HAND_NAMES[h],
              outcome.power || outcome.saved ? 0.95 : 0.45 + outcome.strength * 0.4,
              outcome.power ? 130 : 70,
            );
          }
        }
      }

      this.updateCeremony(hand, h);
    }
  }

  /** Your turn in the slap line: golden hands, and the slap itself. */
  private updateCeremony(hand: SportsHand, h: number): void {
    const p = rally.punish;
    const myTurn = rally.phase === 'punish' && !!p && p.queue[p.index] === human.id;
    const aura = this.auras[h];
    if (aura) {
      aura.visible = myTurn && !p!.slapped;
      if (aura.visible) {
        aura.material.opacity = 0.45 + Math.sin(this.time * 6 + h) * 0.15;
        aura.scale.setScalar(0.5 + Math.sin(this.time * 6 + h) * 0.08);
      }
    }
    if (!myTurn || p!.slapped) return;

    const reach = HANDS.contactRadius + 0.3; // the keeper's whole sorry torso
    if (hand.palmWorld.distanceToSquared(p!.victimPos) > reach * reach) return;
    if (_vel.length() < HANDS.minSlapSpeed) return;

    const res = landPunishSlap();
    if (!res) return;
    hand.impact(1);
    sfx.punishSlap();
    pulseHand(this.world.session, HAND_NAMES[h], 1, 160);
    spawnTouchPop(this.world, p!.victimPos, PALETTE.auraPlus, 1.6);
    _vel.set(0, 0.55, 0).add(p!.victimPos);
    spawnRisingText(this.world, _vel, '-1 AURA', '#c86bff', 0.7);
    const head = this.playerHeadEntity?.object3D;
    if (head) {
      head.getWorldPosition(_vel);
      _vel.y += 0.5;
      spawnRisingText(this.world, _vel, '+1 AURA', '#ffd700', 0.7);
    }
  }
}
