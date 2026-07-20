/**
 * Everything the goal decides. Works in ARENA-LOCAL space (goal-line at
 * z = 0, mouth toward +z) no matter where the arena has been re-anchored:
 *
 *  - SHOT FLAGGING: after every live strike, predict whether the ball's
 *    trajectory crosses the goal plane soon. If so, that strike was a SHOT —
 *    stat it, tell the keeper where it's arriving (aimX), let the HUD shout.
 *  - CROSSING: prev-frame z > 0, this-frame z <= 0. Inside the frame while
 *    LIVE = GOAL (bank the combo); inside while not live = playground rules,
 *    no goal, dead ball. The post band bounces it back out with a ping.
 *  - NET DRAG: anything flying around inside the net cage gets caught.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { app } from '../menu/appState.js';
import { FENCE, GOAL, PUNISH, RALLY } from '../config.js';
import { lineup, playerById } from '../game/roster.js';
import { ball, gravityNow, keeperId, persist, rally, setMessage, twotLetters } from '../game/state.js';
import { arenaRefs, arenaToWorld, worldToArena } from '../arena/arena.js';
import { twotBoard } from '../arena/banner.js';
import { spawnFireImpact, spawnRisingText, spawnTouchPop } from '../fx/effects.js';
import * as sfx from '../audio/sfx.js';

const _pop = new Vector3();

const _local = new Vector3();
const _prev = new Vector3();
const _vLocal = new Vector3();
const _qInv = new Quaternion();

/** Woodwork bounciness — a ringing frame, not a cushion. */
const POST_REST = 0.72;

interface SweptHit {
  /** Segment parameter of closest approach (0..1). */
  t: number;
  /** Contact normal (unit, from the post axis toward the ball's path). */
  nx: number;
  nz: number;
}

/**
 * Swept segment-vs-circle in 2D: where does the ball's path a→b first
 * ENTER the circle of radius `rr` around (px, pz)? The contact normal is
 * taken at the entry point — NOT at closest approach, which is always
 * perpendicular to the travel and would never reflect anything. Returns
 * null for a clean miss. (Exported for the dev bench.)
 */
export function sweptCircle(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  rr: number,
): SweptHit | null {
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - px;
  const fz = az - pz;
  const A = dx * dx + dz * dz;
  const C = fx * fx + fz * fz - rr * rr;
  if (C <= 0) {
    // Frame started overlapping the post — push out along the radial.
    const d = Math.hypot(fx, fz);
    if (d > 1e-5) return { t: 0, nx: fx / d, nz: fz / d };
    const l = Math.sqrt(A) || 1;
    return { t: 0, nx: -dx / l, nz: -dz / l };
  }
  if (A < 1e-8) return null; // not moving, not overlapping
  const B = 2 * (fx * dx + fz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  if (s < 0 || s > 1) return null; // entry outside this frame's travel
  const cx = fx + dx * s;
  const cz = fz + dz * s;
  return { t: s, nx: cx / rr, nz: cz / rr };
}

export class GoalSystem extends createSystem({}) {
  private hasPrev = false;
  /** rally.time of the last strike we've already classified. */
  private checkedHitAt = -1;

  update(delta: number): void {
    // Track the ball in EVERY in-play phase so the serve→rally transition
    // never leaves a one-frame blind spot at the plane; only rally frames
    // get a verdict.
    if (app.state !== 'playing' || rally.phase === 'idle' || rally.phase === 'punish') {
      this.hasPrev = false;
      return;
    }

    worldToArena(ball.pos, _local);
    _qInv.copy(arenaRefs.root.quaternion).invert();
    _vLocal.copy(ball.vel).applyQuaternion(_qInv);

    // The net catches anything flapping about inside the cage — strictly
    // BEHIND the line (so it can't snag an incoming shot), and damped
    // exponentially so low frame rates can't freeze the ball dead.
    if (
      _local.z < 0 &&
      _local.z > -GOAL.depth - 0.3 &&
      Math.abs(_local.x) < GOAL.width / 2 + 0.3 &&
      _local.y < GOAL.height + 0.3
    ) {
      ball.vel.multiplyScalar(Math.exp(-6 * delta));
    }

    this.resolvePosts();
    if (rally.phase === 'rally') {
      this.flagShots();
      this.resolveCrossing();
    }
    this.resolveFence();

    _prev.copy(_local);
    this.hasPrev = true;
  }

  /**
   * The woodwork, for real: both posts and the crossbar are CYLINDERS the
   * ball reflects off — swept segment-vs-circle so fast shots can't tunnel.
   * Catch the inner half of a post and the ball deflects IN: post-and-in
   * is quite common in football. The shot flag survives contact for
   * exactly that reason.
   */
  private resolvePosts(): void {
    if (!this.hasPrev) return;
    const rr = ball.radius + GOAL.postRadius;

    // Posts: vertical cylinders at x = ±W/2, z = 0 — collide in the xz plane.
    if (_local.y - ball.radius <= GOAL.height) {
      for (const px of [-GOAL.width / 2, GOAL.width / 2]) {
        const hit = sweptCircle(px, 0, _prev.x, _prev.z, _local.x, _local.z, rr);
        if (!hit) continue;
        const vn = _vLocal.x * hit.nx + _vLocal.z * hit.nz;
        if (vn >= 0) continue; // already separating
        _vLocal.x -= (1 + POST_REST) * vn * hit.nx;
        _vLocal.z -= (1 + POST_REST) * vn * hit.nz;
        const cy = _prev.y + (_local.y - _prev.y) * hit.t;
        this.postContact(px + hit.nx * rr * 1.02, cy, hit.nz * rr * 1.02, 'OFF THE POST!');
        return;
      }
    }

    // Crossbar: a horizontal cylinder along x at y = H, z = 0 — the yz plane.
    if (Math.abs(_local.x) <= GOAL.width / 2 + GOAL.postRadius) {
      const hit = sweptCircle(GOAL.height, 0, _prev.y, _prev.z, _local.y, _local.z, rr);
      if (!hit) return;
      const vn = _vLocal.y * hit.nx + _vLocal.z * hit.nz;
      if (vn >= 0) return;
      _vLocal.y -= (1 + POST_REST) * vn * hit.nx;
      _vLocal.z -= (1 + POST_REST) * vn * hit.nz;
      const cx = _prev.x + (_local.x - _prev.x) * hit.t;
      this.postContact(cx, GOAL.height + hit.nx * rr * 1.02, hit.nz * rr * 1.02, 'OFF THE BAR!');
    }
  }

  /** Shared woodwork aftermath: park the ball at contact, ping, shout. */
  private postContact(x: number, y: number, z: number, shout: string): void {
    ball.vel.copy(_vLocal).applyQuaternion(arenaRefs.root.quaternion);
    arenaToWorld(x, y, z, ball.pos);
    ball.spin.multiplyScalar(0.6);
    sfx.postPing();
    spawnTouchPop(this.world, ball.pos, 0xf7fbff, 1.1);
    // Only shout when it's clearly coming back OUT — a post-and-in gets
    // its own (louder) headline a few frames later.
    if (rally.phase === 'rally' && _vLocal.z > 0.5) setMessage(shout, '#ffb226', 1.6);
    // Refresh the arena-local trackers so this frame's crossing verdict
    // runs on the post-contact state, not the pre-contact one.
    worldToArena(ball.pos, _local);
    _qInv.copy(arenaRefs.root.quaternion).invert();
    _vLocal.copy(ball.vel).applyQuaternion(_qInv);
  }

  /**
   * The chain-link fence behind the goal. Hitting it is fine — the ball
   * rattles off and the rally STAYS ALIVE. Putting it over the top (or
   * wide past the edge) is not fine: whoever hit it goes in goal.
   */
  private resolveFence(): void {
    if (!this.hasPrev || !(_prev.z > FENCE.z && _local.z <= FENCE.z)) return;

    const cleared = _local.y >= FENCE.height || Math.abs(_local.x) >= FENCE.halfWidth;
    if (!cleared) {
      // Rattle and back into play.
      _vLocal.z = Math.abs(_vLocal.z) * FENCE.restitution;
      _vLocal.x *= 0.9;
      ball.vel.copy(_vLocal).applyQuaternion(arenaRefs.root.quaternion);
      arenaToWorld(_local.x, _local.y, FENCE.z + 0.03, ball.pos);
      sfx.chainRattle();
      spawnTouchPop(this.world, ball.pos, 0xd2dee8, 0.9);
      return;
    }

    if (rally.phase !== 'rally') return; // dead balls may sail, nobody cares
    const offender = ball.lastHitBy;
    rally.shot = null;
    sfx.overFence();
    spawnRisingText(this.world, ball.pos, 'OVER!', '#ff5252', 1.0);
    if (offender && offender !== keeperId()) {
      setMessage(`${playerById(offender).name} PUT IT OVER THE FENCE!`, '#ff5252', 2.4);
      rally.pendingSwap = { newKeeper: offender, reason: 'over' };
    } else {
      // The keeper hoofing it over their own fence is just a dead ball.
      rally.combo = 0;
      rally.phase = 'dead';
      rally.serveTimer = RALLY.serveDelay;
      rally.server = keeperId();
      setMessage('OVER THE FENCE — dead ball', '#ff5252', 2.2);
    }
  }

  /** Classify the latest strike: is this thing arriving at the goal? */
  private flagShots(): void {
    if (ball.lastHitAt === this.checkedHitAt) return;
    this.checkedHitAt = ball.lastHitAt;
    if (!rally.live || !ball.lastHitBy || ball.lastHitBy === keeperId()) return;
    if (_vLocal.z >= -1.0) return; // not travelling at the goal

    const t = _local.z / -_vLocal.z;
    if (t <= 0 || t > 1.6) return;
    const x = _local.x + _vLocal.x * t;
    const y = _local.y + _vLocal.y * t - 0.5 * gravityNow() * t * t;
    // A predicted-underground arrival isn't a miss — it's a BOUNCE shot
    // (the ball skips off the turf en route), and those count now: flag
    // it so the keeper reacts and the first bounce rides free.
    if (Math.abs(x) > GOAL.width / 2 + GOAL.missMargin || y > GOAL.height + GOAL.missMargin) {
      return;
    }

    const shooter = playerById(ball.lastHitBy);
    shooter.stats.shots += 1;
    rally.shot = {
      shooter: shooter.id,
      assistFrom:
        ball.lastHitPrevBy && ball.lastHitPrevBy !== shooter.id ? ball.lastHitPrevBy : null,
      power: ball.lastHitPower,
      halfVolley: ball.lastHitHalfVolley,
      aimX: x,
      aimY: Math.max(0.1, y),
    };
    sfx.shotWhoosh();
    setMessage(`${shooter.name} SHOOTS!`, '#ffb226', 1.4);
  }

  /** The plane of truth. */
  private resolveCrossing(): void {
    if (!this.hasPrev || !(_prev.z > 0 && _local.z <= 0)) return;

    const x = _local.x;
    const y = _local.y;
    // The woodwork itself is handled physically in resolvePosts — the
    // crossing verdict only needs the opening between the cylinders.
    const inFrame =
      Math.abs(x) <= GOAL.width / 2 - GOAL.postRadius && y <= GOAL.height - GOAL.postRadius;

    if (inFrame && rally.live) {
      this.goal();
      return;
    }
    if (inFrame && !rally.live) {
      // Playground law: not live, doesn't count — and jumping the gun costs
      // you the gloves.
      const offender = ball.lastHitBy;
      rally.shot = null;
      sfx.overFence();
      spawnRisingText(this.world, ball.pos, 'NOT LIVE!', '#ff5252', 0.9);
      if (offender && offender !== keeperId()) {
        setMessage(`NOT LIVE, ${playerById(offender).name} — get in goal!`, '#ff5252', 2.4);
        rally.pendingSwap = { newKeeper: offender, reason: 'notlive' };
      } else {
        setMessage('NOT LIVE — no goal!', '#ff5252', 2.2);
        rally.combo = 0;
        rally.phase = 'dead';
        rally.serveTimer = RALLY.serveDelay;
        rally.server = keeperId();
      }
      return;
    }
    // Sailed wide/high.
    if (rally.shot) {
      setMessage('OFF TARGET', '#ff5252', 1.6);
      rally.shot = null;
    }
  }

  private goal(): void {
    const shot = rally.shot;
    const scorerId = shot?.shooter ?? ball.lastHitBy ?? 'you';
    const scorer = playerById(scorerId);
    scorer.stats.goals += 1;
    rally.goals[scorerId] = (rally.goals[scorerId] ?? 0) + 1;

    // --- THE ASSIST LAW: whoever teed it up gets the mark — a pass buried
    // with the very next touch. Keepers can assist (a clearance hammered
    // home next touch counts).
    const assisterId =
      shot?.assistFrom ??
      (ball.lastHitPrevBy && ball.lastHitPrevBy !== scorerId ? ball.lastHitPrevBy : null);
    if (assisterId) {
      playerById(assisterId).stats.assists += 1;
      spawnRisingText(this.world, ball.pos, `ASSIST — ${playerById(assisterId).name}`, '#7ed6ff', 0.9);
    }

    let flavour = '';
    if (shot?.power) flavour = 'POWER ';
    if (shot?.halfVolley) flavour = 'HALF-VOLLEY ';

    // --- THE TWOT LAW: light the keeper's next letter, big enough for all. ---
    // FULL HOUSE: every attacker touched this sequence before it went in —
    // a team goal, and the keeper eats TWO letters for letting it brew.
    const fullHouse = lineup.arc.every((id) => rally.touched.includes(id));
    rally.conceded = Math.min(PUNISH.letters, rally.conceded + (fullHouse ? 2 : 1));
    const letters = twotLetters();
    const complete = rally.conceded >= PUNISH.letters;
    twotBoard?.setLit(rally.conceded, true);
    sfx.twotLetter(rally.conceded);
    // The letter pop rises out of the goal mouth where everyone's looking.
    arenaToWorld(0, GOAL.height * 0.75, 0.6, _pop);
    spawnRisingText(this.world, _pop, `${letters}!`, complete ? '#ff5252' : '#ffffff', 1.6 + rally.conceded * 0.3);

    sfx.goalHorn();
    spawnFireImpact(this.world, ball.pos);
    spawnRisingText(this.world, ball.pos, 'GOAL!', '#9be82a', 1.3);
    if (fullHouse) {
      arenaToWorld(0, GOAL.height * 0.45, 0.9, _pop);
      spawnRisingText(this.world, _pop, 'FULL HOUSE ×2!', '#ffb226', 1.4);
    }

    const gk = playerById(keeperId());
    if (complete) {
      sfx.twotComplete();
      setMessage(`T·W·O·T! ${gk.name} IS TWOT — form the line!`, '#ff5252', PUNISH.intro + 1);
      rally.pendingTwot = true;
    } else if (fullHouse) {
      setMessage(`FULL HOUSE ${flavour}GOAL! all five touched — TWO letters: "${letters}"`, '#ffb226', 3.4);
    } else {
      setMessage(`${flavour}GOAL! ${scorer.name} — that's "${letters}"`, '#9be82a', 3.2);
    }

    rally.shot = null;
    rally.savedShooter = null; // a goal clears any deferred half-volley-save debt
    rally.combo = 0;
    rally.phase = 'dead';
    rally.serveTimer = complete ? PUNISH.intro : RALLY.serveDelay + 1.4;
    rally.server = keeperId(); // keeper digs it out of the net and restarts
    persist();
  }
}
