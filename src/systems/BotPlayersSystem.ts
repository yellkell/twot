/**
 * The five sports-centre regulars. Each bot idles on its pedestal, watches
 * the ball, and plays it through the SAME strike resolver you use — with a
 * synthetic "hand swing" whose speed matches the pass or shot it wants, so
 * power shots, half-volley rescues and saves all emerge from one law.
 *
 * Decisions:
 *  - serving  → lob it to another attacker (the human gets first dibs often);
 *  - rallying → keep it up: pass around the arc, occasionally to themselves;
 *  - LIVE     → shootChance says have a dig (sometimes with deliberate curve),
 *               otherwise keep the combo cooking;
 *  - keeper   → shuffle along the line toward the predicted shot, and stuff
 *               it if it's within reach — which arms the rotation ceremony.
 *
 * Bodies live in world space; every frame they glide toward their CURRENT
 * station (so a lineup rotation naturally becomes a little teleport-shuffle
 * as the arena re-anchors around the human).
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { app } from '../menu/appState.js';
import { BOT, GOAL, HANDS } from '../config.js';
import { lineup, roster, stationPose, type RosterPlayer } from '../game/roster.js';
import { ball, gravityNow, keeperId, rally } from '../game/state.js';
import { strikeBall } from '../game/strike.js';
import { arenaToWorld } from '../arena/arena.js';
import { buildBotAvatar, type BotAvatar } from '../avatar/bots.js';

interface BotState {
  player: RosterPlayer;
  avatar: BotAvatar;
  /** Seconds until this bot is allowed to strike again. */
  cooldown: number;
  /** Countdown started when the ball becomes playable for this bot. */
  react: number;
  /** Brief window where the hands chase the strike point. */
  strikePose: number;
  strikePoint: Vector3;
  bobPhase: number;
  /** Keeper: current shuffle offset along the goal line. */
  keeperX: number;
}

const _base = new Vector3();
const _target = new Vector3();
const _vout = new Vector3();
const _palm = new Vector3();
const _handVel = new Vector3();
const _look = new Vector3();
const _handTarget = new Vector3();
const _q = new Quaternion();

const DOWN = new Vector3(0, -1, 0);
const FWD = new Vector3(0, 0, -1);

export class BotPlayersSystem extends createSystem({}) {
  private bots: BotState[] = [];
  private serveWait = 0;

  init(): void {
    for (const p of roster) {
      if (p.isHuman) continue;
      const avatar = buildBotAvatar(p.accent, p.name);
      this.scene.add(avatar.group, avatar.hands[0].group, avatar.hands[1].group);
      this.bots.push({
        player: p,
        avatar,
        cooldown: 0,
        react: 0,
        strikePose: 0,
        strikePoint: new Vector3(),
        bobPhase: Math.random() * 6,
        keeperX: 0,
      });
    }
  }

  update(delta: number): void {
    const playing = app.state === 'playing';
    for (const bot of this.bots) {
      bot.avatar.group.visible = playing;
      bot.avatar.hands[0].setVisible(playing);
      bot.avatar.hands[1].setVisible(playing);
    }
    if (!playing) return;

    if (rally.phase === 'serve') this.serveWait += delta;
    else this.serveWait = 0;

    for (const bot of this.bots) {
      this.updateBody(bot, delta);
      if (rally.phase === 'serve' || rally.phase === 'rally') this.think(bot, delta);
    }
  }

  // --- body + hands -------------------------------------------------------

  private updateBody(bot: BotState, delta: number): void {
    const station = lineup.keeper === bot.player.id ? 'keeper' : lineup.arc.indexOf(bot.player.id);
    const pose = stationPose(station as 'keeper' | number);
    const isKeeper = station === 'keeper';

    // Keeper shuffles along the goal line toward the incoming shot.
    let ox = 0;
    if (isKeeper) {
      const reach = BOT.keeperReach[app.difficulty];
      const want = rally.shot ? Math.max(-reach, Math.min(reach, rally.shot.aimX)) : 0;
      const k = 1 - Math.exp(-6 * delta);
      bot.keeperX += (want - bot.keeperX) * k;
      ox = bot.keeperX;
    } else {
      bot.keeperX = 0;
    }

    arenaToWorld(pose.x + ox, 0, pose.z, _base);
    // Glide toward the station — rotations become a visible teleport-shuffle.
    const k = 1 - Math.exp(-5 * delta);
    bot.avatar.group.position.lerp(_base, k);

    // Face the ball (or the arc when idle in goal).
    _look.copy(rally.phase === 'idle' ? _base : ball.pos).sub(bot.avatar.group.position);
    _look.y = 0;
    if (_look.lengthSq() > 1e-4) {
      _q.setFromUnitVectors(FWD, _look.normalize());
      bot.avatar.group.quaternion.slerp(_q, Math.min(1, delta * 8));
    }

    // Head watches the ball.
    _look.copy(ball.pos).sub(bot.avatar.head.getWorldPosition(_target));
    if (_look.lengthSq() > 1e-4) {
      _q.setFromUnitVectors(FWD, _look.normalize());
      bot.avatar.head.quaternion.slerp(_q, Math.min(1, delta * 6));
    }

    // Hands: idle bob at the hips, chase the ball when it's close, and jump
    // to the strike point for a beat after a hit.
    bot.bobPhase += delta * BOT.idleBobRate;
    const ballNear = bot.avatar.group.position.distanceTo(ball.pos) < 2.4;
    for (let h = 0; h < 2; h++) {
      const side = h === 0 ? -1 : 1;
      const hand = bot.avatar.hands[h];
      if (bot.strikePose > 0) {
        _handTarget.copy(bot.strikePoint);
      } else if (ballNear && (rally.phase === 'rally' || rally.phase === 'serve')) {
        // Both mitts up toward the ball, split slightly.
        _handTarget.copy(ball.pos).sub(bot.avatar.group.position).multiplyScalar(0.45);
        _handTarget.add(bot.avatar.group.position);
        _handTarget.y = Math.max(0.8, Math.min(2.2, ball.pos.y - 0.15));
        _handTarget.x += side * 0.28;
      } else {
        _handTarget.copy(bot.avatar.group.position);
        _handTarget.x += side * 0.42;
        _handTarget.y = 0.95 + Math.sin(bot.bobPhase + h * 1.7) * BOT.idleBobAmp;
        _handTarget.z += 0.08;
      }
      // Palm faces the ball.
      _look.copy(ball.pos).sub(_handTarget);
      if (_look.lengthSq() > 1e-4) _q.setFromUnitVectors(DOWN, _look.normalize());
      _handVel.copy(_handTarget).sub(hand.group.position).multiplyScalar(4);
      hand.update(delta, _handTarget, _q, _handVel);
    }
    bot.strikePose = Math.max(0, bot.strikePose - delta);
  }

  // --- brains ---------------------------------------------------------------

  private think(bot: BotState, delta: number): void {
    bot.cooldown = Math.max(0, bot.cooldown - delta);
    if (bot.cooldown > 0) return;

    const id = bot.player.id;
    const isKeeper = keeperId() === id;
    const serving = rally.phase === 'serve';
    if (serving && rally.server !== id) return;
    if (serving && this.serveWait < 1.0) return; // let the moment breathe

    // Reachable?
    _base.copy(bot.avatar.group.position);
    _base.y = 1.15;
    const dist = _base.distanceTo(ball.pos);
    const reach = (isKeeper ? BOT.keeperReach[app.difficulty] + 0.35 : BOT.reach) + ball.radius;
    if (dist > reach) {
      bot.react = 0;
      return;
    }

    // Seeing-it time before the mitts move.
    const reactTime = isKeeper ? BOT.keeperReactTime[app.difficulty] : BOT.reactTime[app.difficulty];
    bot.react += delta;
    if (bot.react < reactTime && !serving) return;

    if (isKeeper) {
      // Only plays the ball to STOP something (or clear a loose one).
      if (!rally.shot && ball.vel.length() > 3) return;
      this.strike(bot, this.pickPassTarget(bot), false);
      return;
    }

    // Attacker: shoot or keep it up.
    const canShoot = rally.live && !serving;
    if (canShoot && Math.random() < BOT.shootChance[app.difficulty]) {
      this.strike(bot, this.pickShotTarget(), true);
    } else {
      this.strike(bot, this.pickPassTarget(bot), false);
    }
  }

  /** Somewhere above a mate's pedestal (the human gets a healthy bias). */
  private pickPassTarget(bot: BotState): Vector3 {
    const candidates = lineup.arc.filter((id) => id !== bot.player.id);
    let pick: string;
    if (candidates.includes('you') && Math.random() < BOT.passToHumanBias) pick = 'you';
    else pick = candidates[Math.floor(Math.random() * candidates.length)] ?? 'you';
    const st = lineup.arc.indexOf(pick);
    const pose = stationPose(st === -1 ? 'keeper' : st);
    const err = BOT.passError[app.difficulty];
    arenaToWorld(
      pose.x + (Math.random() - 0.5) * 2 * err,
      0,
      pose.z + (Math.random() - 0.5) * 2 * err,
      _target,
    );
    _target.y = 1.5 + Math.random() * 0.4; // drop it onto their mitts
    return _target;
  }

  /** A point inside the goal mouth, corners preferred by better bots. */
  private pickShotTarget(): Vector3 {
    const err = BOT.shotError[app.difficulty];
    const cornerBias = app.difficulty === 'pro' ? 0.8 : 0.5;
    const x =
      (Math.random() < cornerBias ? Math.sign(Math.random() - 0.5) * (GOAL.width / 2 - 0.35) : (Math.random() - 0.5) * GOAL.width * 0.6) +
      (Math.random() - 0.5) * 2 * err;
    const y = 0.3 + Math.random() * (GOAL.height - 0.6) + (Math.random() - 0.5) * err;
    arenaToWorld(x, 0, 0, _target);
    _target.y = y;
    return _target;
  }

  /** Solve a lob/shot to `target` and play it through the shared resolver. */
  private strike(bot: BotState, target: Vector3, shot: boolean): void {
    const isKeeper = keeperId() === bot.player.id;

    if (shot) {
      // Flat and fast: constant-ish speed with a touch of gravity lead.
      _vout.copy(target).sub(ball.pos);
      const d = _vout.length();
      const speed = 7.2 + Math.random() * 2.2;
      _vout.normalize().multiplyScalar(speed);
      _vout.y += 0.5 * gravityNow() * (d / speed);
    } else {
      // A friendly lob: pick a flight time by range, arc it in.
      const tf = Math.max(BOT.minFlight, Math.min(BOT.maxFlight, target.distanceTo(ball.pos) * BOT.passPace));
      _vout.copy(target).sub(ball.pos).multiplyScalar(1 / tf);
      _vout.y += 0.5 * gravityNow() * tf;
    }
    if (isKeeper && rally.shot) {
      // A save is a wall, not a pass: batter it back out toward the arc.
      arenaToWorld(ball.pos.x * 0.3, 0, 3.2, _target);
      _vout.copy(_target).sub(ball.pos).setLength(4.5);
      _vout.y = Math.max(_vout.y, 2.2);
    }

    // Synthetic swing: palm just behind the ball, moving through it.
    _palm.copy(ball.pos).addScaledVector(_vout.clone().normalize(), -(ball.radius * 0.7 + 0.02));
    _handVel.copy(_vout).multiplyScalar(shot ? 0.62 : 0.45);
    const maxHand = shot ? HANDS.powerSpeed * 1.5 : HANDS.powerSpeed * 0.9;
    if (_handVel.length() > maxHand) _handVel.setLength(maxHand);
    if (_handVel.length() < HANDS.minSlapSpeed + 0.2) _handVel.setLength(HANDS.minSlapSpeed + 0.2);

    const spin = shot && Math.random() < BOT.curveChance
      ? new Vector3(0, (Math.random() < 0.5 ? 1 : -1) * (6 + Math.random() * 8), 0)
      : undefined;

    const outcome = strikeBall(this.world, bot.player.id, _palm, _handVel, { forcedVel: _vout, forcedSpin: spin });
    if (outcome) {
      bot.cooldown = 0.5 + Math.random() * 0.4;
      bot.react = 0;
      bot.strikePose = 0.22;
      bot.strikePoint.copy(ball.pos);
      const hand = bot.avatar.hands[ball.pos.x < bot.avatar.group.position.x ? 0 : 1];
      hand.impact(outcome.strength);
    } else {
      bot.react = 0;
    }
  }
}
