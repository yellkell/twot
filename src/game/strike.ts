/**
 * One slap, one law — the shared strike resolver used by YOUR hands and the
 * bots' hands alike, so a rubber slap feels identical whoever swings it.
 *
 * Physics: the ball reflects off the moving palm (hand treated as infinite
 * mass), inherits a slice of hand velocity, and picks up SPIN from the
 * tangential component of the swing — which the Magnus term in BallSystem
 * turns into visible curve. Fast swings are POWER shots.
 *
 * Bookkeeping: serve → rally transitions, half-volley detection against the
 * bounce clock, keeper SAVE detection (which arms the rotation ceremony),
 * combo/pass/stat updates via registerTouch, and all the touch FX + sounds.
 */

import { Vector3, type World } from '@iwsdk/core';
import { BALL, HANDS, PALETTE, RALLY } from '../config.js';
import { playerById } from './roster.js';
import {
  ball,
  keeperId,
  persist,
  radiusForCombo,
  rally,
  registerTouch,
  setMessage,
} from './state.js';
import { spawnFireImpact, spawnRisingText, spawnTouchPop } from '../fx/effects.js';
import { emberBurst } from '../fx/fire.js';
import * as sfx from '../audio/sfx.js';

const _n = new Vector3();
const _vt = new Vector3();
const _spin = new Vector3();

export interface StrikeOutcome {
  /** True when this was the keeper stuffing a live shot. */
  saved: boolean;
  power: boolean;
  halfVolley: boolean;
  /** 0..1 oomph, for haptics/squash on the striking hand. */
  strength: number;
}

export interface StrikeOpts {
  /** Bots: exact outbound velocity to impose after the bookkeeping. */
  forcedVel?: Vector3;
  /** Bots: deliberate spin (curve shots). */
  forcedSpin?: Vector3;
}

/**
 * Resolve a palm-vs-ball contact. Returns null if the contact doesn't
 * qualify (wrong phase, too slow, same hand spamming). The caller has
 * already established the palm is touching the ball.
 */
export function strikeBall(
  world: World,
  strikerId: string,
  palmPos: Vector3,
  handVel: Vector3,
  opts: StrikeOpts = {},
): StrikeOutcome | null {
  if (rally.phase !== 'serve' && rally.phase !== 'rally') return null;
  // During a serve only the server may play the ball.
  if (rally.phase === 'serve' && strikerId !== rally.server) return null;

  const handSpeed = handVel.length();
  if (handSpeed < HANDS.minSlapSpeed) return null;

  // Rehit window: the same player can't drum on it every frame.
  const since = rally.time - ball.lastHitAt;
  if (ball.lastHitBy === strikerId && since < HANDS.rehitCooldown) return null;
  if (since < 0.05) return null;

  _n.copy(ball.pos).sub(palmPos);
  if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
  _n.normalize();

  // Only strikes that actually push INTO the ball connect.
  const approach = handVel.dot(_n);
  if (approach <= 0.05) return null;

  const power = handSpeed >= HANDS.powerSpeed;

  // Moving-palm reflection + a slice of carried hand velocity.
  const relN = ball.vel.dot(_n) - approach;
  if (relN < 0) ball.vel.addScaledVector(_n, -(1 + HANDS.restitution) * relN);
  ball.vel.addScaledVector(handVel, 0.3);
  if (power) ball.vel.multiplyScalar(HANDS.powerGain / HANDS.slapGain);
  if (ball.vel.length() > BALL.maxSpeed) ball.vel.setLength(BALL.maxSpeed);

  // Spin from the tangential swipe — the curve-shot coupling.
  _vt.copy(handVel).addScaledVector(_n, -approach);
  _spin.crossVectors(_n, _vt).multiplyScalar(HANDS.spinGain / (1 + ball.radius * 6));
  if (_spin.length() > BALL.maxSpin) _spin.setLength(BALL.maxSpin);
  ball.spin.copy(_spin);

  // JUGGLE ASSIST: a soft, mostly-upward slap is a self keep-up — damp the
  // sideways carry (and the spin that would Magnus it away) so the ball
  // stays over YOUR head instead of drifting off to a team-mate. Power
  // slaps are exempt: a smashed ball goes where physics says.
  if (!power && !opts.forcedVel) {
    const upness = Math.abs(handVel.y) / Math.max(1e-4, handSpeed);
    if (upness > HANDS.juggleFrom && ball.vel.y > 0) {
      const t = Math.min(1, (upness - HANDS.juggleFrom) / (1 - HANDS.juggleFrom));
      const keep = 1 - HANDS.juggleAssist * t;
      ball.vel.x *= keep;
      ball.vel.z *= keep;
      ball.spin.multiplyScalar(keep);
    }
  }

  // Bots impose their solved trajectory over the raw reflection.
  if (opts.forcedVel) ball.vel.copy(opts.forcedVel);
  if (opts.forcedSpin) ball.spin.copy(opts.forcedSpin);

  const halfVolley = ball.bouncedAt >= 0 && rally.time - ball.bouncedAt <= BALL.halfVolleyWindow;
  const striker = playerById(strikerId);
  const strength = Math.min(1, handSpeed / (HANDS.powerSpeed * 1.4));
  ball.lastHitPower = power;
  ball.lastHitHalfVolley = halfVolley;

  // --- The keeper stuffing a live shot: a SAVE, not a touch. ---
  const shot = rally.shot;
  if (shot && strikerId === keeperId() && shot.shooter !== strikerId) {
    striker.stats.saves += 1;
    rally.shot = null;
    rally.pendingSwap = { newKeeper: shot.shooter, reason: 'save' };
    ball.lastHitBy = strikerId;
    ball.lastHitAt = rally.time;
    ball.lastTouchAt = rally.time;
    sfx.saveThump();
    spawnTouchPop(world, ball.pos, striker.accent, 1.4);
    if (ball.heat > 0.3) spawnFireImpact(world, ball.pos, PALETTE.ember);
    spawnRisingText(world, ball.pos, 'SAVED!', '#9be82a', 0.8);
    setMessage(`${striker.name} SAVES IT!`, '#9be82a', 2.4);
    persist();
    return { saved: true, power, halfVolley: false, strength: 1 };
  }

  // --- A rally touch. ---
  const wasServe = rally.phase === 'serve';
  if (wasServe) rally.phase = 'rally';

  const igniteBefore = rally.combo >= BALL.igniteAt;
  const result = registerTouch(strikerId, halfVolley);

  sfx.slap(power ? 1 : strength, result.combo);
  spawnTouchPop(world, ball.pos, striker.accent, 0.8 + strength * 0.7);
  if (ball.heat > 0.3) emberBurst(ball.pos, Math.round(6 + ball.heat * 8));

  if (halfVolley) {
    sfx.halfVolley();
    spawnRisingText(world, ball.pos, 'HALF VOLLEY!', '#ffb226', 0.85);
    setMessage(`${striker.name} — HALF VOLLEY! +${RALLY.halfVolleyBonus}`, '#ffb226');
  } else if (result.passCompleted) {
    sfx.comboPop(result.combo);
    spawnRisingText(world, ball.pos, `${result.combo}`, '#ffffff', 0.42 + Math.min(0.5, result.combo * 0.03));
  }

  if (result.wentLive) {
    sfx.liveAlert();
    spawnRisingText(world, ball.pos, 'LIVE!', '#9be82a', 0.9);
    setMessage('BALL IS LIVE — have a dig!', '#9be82a', 2.6);
  }
  if (!igniteBefore && result.combo >= BALL.igniteAt) {
    sfx.ignite();
    setMessage('IT’S COOKING!', '#ff7a18', 2.0);
  }
  if (wasServe) {
    // Serve size snapshots immediately so a fresh serve is visibly huge.
    ball.radius = radiusForCombo(rally.combo);
  }

  return { saved: false, power, halfVolley, strength };
}
