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
import { Euler } from 'three';
import { app } from '../menu/appState.js';
import { HANDS } from '../config.js';
import { human } from '../game/roster.js';
import { ball, rally } from '../game/state.js';
import { strikeBall } from '../game/strike.js';
import { buildSportsHand, type SportsHand } from '../avatar/hands.js';
import { pulseHand } from '../input/haptics.js';

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
  private trackers: [VelocityTracker, VelocityTracker] = [new VelocityTracker(), new VelocityTracker()];
  private time = 0;

  init(): void {
    const left = buildSportsHand(human.accent, true);
    const right = buildSportsHand(human.accent, false);
    this.scene.add(left.group, right.group);
    this.hands = [left, right];
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
    }
  }
}
