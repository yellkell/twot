/**
 * The referee. Registered FIRST so the whole frame shares one clock.
 *
 *  - Advances `rally.time`, ticks the HUD message and the keeper's stint
 *    clock (that's where "average time as keeper" comes from).
 *  - RALLY: watches the half-volley window after a bounce (window shuts →
 *    dead ball, closest player restarts), the lost-ball watchdog, and any
 *    pending SAVE — which starts the ROTATION CEREMONY: the lineup rotates
 *    (shooter into goal, keeper to a far platform, everyone between shuffles
 *    toward the centre) and the whole sports centre GLIDES around the human
 *    to their new station.
 *  - DEAD: counts down to the next serve. SERVE: waits for the opening slap
 *    (the strike resolver flips the phase).
 *  - Hold both grips ~1.2 s to walk back to the lobby.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import { app, type AppState } from '../menu/appState.js';
import { BALL, LOST_BALL_TIMEOUT, PUNISH, RALLY } from '../config.js';
import {
  applySaveRotation,
  human,
  lineup,
  playerById,
  roster,
  stationOf,
  stationPose,
  type StationPose,
} from '../game/roster.js';
import { ball, keeperId, persist, rally, resetRally, setMessage } from '../game/state.js';
import {
  anchorTarget,
  anchorTargetFor,
  anchorToHuman,
  arenaRefs,
  arenaToWorld,
  syncStations,
  type AnchorTarget,
} from '../arena/arena.js';
import { twotBoard } from '../arena/banner.js';
import { spawnRisingText, spawnTouchPop } from '../fx/effects.js';
import * as sfx from '../audio/sfx.js';

const _p = new Vector3();

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class GameFlowSystem extends createSystem({}) {
  private lastState: AppState | null = null;
  private squeezeHold = 0;
  private glideFrom: AnchorTarget | null = null;
  private glideTo: AnchorTarget | null = null;

  update(delta: number): void {
    if (app.state !== this.lastState) {
      if (app.state === 'playing') this.startSession();
      else this.endSession();
      this.lastState = app.state;
    }
    if (app.state !== 'playing') return;

    rally.time += delta;
    if (rally.messageTimer > 0) {
      rally.messageTimer -= delta;
      if (rally.messageTimer <= 0) rally.message = '';
    }

    // The keeper's stint clock (both positions are on the sheet).
    rally.keeperClock += delta;
    playerById(keeperId()).stats.keeperSeconds += delta;

    this.checkLobbyHold(delta);

    switch (rally.phase) {
      case 'rally':
        if (rally.pendingSave) {
          this.beginRotation();
        } else if (ball.bouncedAt >= 0 && rally.time - ball.bouncedAt > BALL.halfVolleyWindow) {
          this.deadBall('bounce');
        } else if (rally.time - ball.lastTouchAt > LOST_BALL_TIMEOUT) {
          this.deadBall('lost');
        }
        break;
      case 'dead':
        rally.serveTimer -= delta;
        if (rally.serveTimer <= 0) {
          if (rally.pendingTwot) this.beginPunish();
          else this.beginServe();
        }
        break;
      case 'rotate':
        this.tickRotation(delta);
        break;
      case 'punish':
        this.tickPunish(delta);
        break;
    }
  }

  // --- session ---------------------------------------------------------------

  private startSession(): void {
    rally.score = 0;
    rally.bestCombo = 0;
    rally.goals = {};
    rally.keeperClock = 0;
    rally.conceded = 0;
    rally.pendingTwot = false;
    rally.punish = null;
    twotBoard?.setLit(0);
    playerById(keeperId()).stats.keeperStints += 1;
    syncStations();
    anchorToHuman();
    resetRally(human.id); // you serve first — it's your sports centre
    rally.phase = 'serve';
    ball.pos.set(0, BALL.serveHeight, -BALL.serveAhead);
    sfx.kickoffWhistle();
    setMessage('KEEP IT UP — slap the ball to serve!', '#eaf6ff', 3.5);
    persist();
  }

  private endSession(): void {
    rally.phase = 'idle';
    rally.message = '';
    persist();
  }

  /** Hold both grips to concede the session and go back to the lobby. */
  private checkLobbyHold(delta: number): void {
    const left = this.input.xr.gamepads.left?.getButtonPressed(InputComponent.Squeeze) ?? false;
    const right = this.input.xr.gamepads.right?.getButtonPressed(InputComponent.Squeeze) ?? false;
    if (left && right) {
      this.squeezeHold += delta;
      if (this.squeezeHold >= 1.2) {
        this.squeezeHold = 0;
        sfx.uiClick();
        app.state = 'menu';
      }
    } else {
      this.squeezeHold = 0;
    }
  }

  // --- dead balls + serves ---------------------------------------------------

  private deadBall(reason: 'bounce' | 'lost'): void {
    rally.phase = 'dead';
    rally.combo = 0;
    rally.shot = null;
    rally.serveTimer = RALLY.serveDelay;
    rally.server = this.closestPlayer();
    const server = playerById(rally.server);
    if (reason === 'bounce') {
      sfx.bounceDead();
      setMessage(`DEAD BALL — ${server.name} to restart`, '#ff5252', 2.6);
      spawnRisingText(this.world, ball.pos, 'DEAD!', '#ff5252', 0.7);
    } else {
      sfx.bounceDead();
      setMessage(`LOST IT — ${server.name} to restart`, '#ff5252', 2.6);
    }
    persist();
  }

  private beginServe(): void {
    resetRally(rally.server);
    rally.phase = 'serve';
    const server = playerById(rally.server);
    sfx.serveReady();
    setMessage(
      server.isHuman ? 'YOUR SERVE — slap it up!' : `${server.name} to serve`,
      '#eaf6ff',
      2.2,
    );
  }

  /** Dead-ball law: whoever is nearest the body starts it off again. */
  private closestPlayer(): string {
    let best = human.id;
    let bestD = Infinity;
    for (const p of roster) {
      if (p.isHuman) {
        const head = this.playerHeadEntity?.object3D;
        if (head) head.getWorldPosition(_p);
        else _p.set(0, 1.6, 0);
      } else {
        const st = stationOf(p.id);
        const pose = stationPose(st);
        arenaToWorld(pose.x, 1.2, pose.z, _p);
      }
      const d = _p.distanceToSquared(ball.pos);
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  }

  // --- the TWOT ceremony -------------------------------------------------------

  /** Four letters conceded: the keeper is marched down the slap line. */
  private beginPunish(): void {
    rally.pendingTwot = false;
    rally.phase = 'punish';
    rally.punish = {
      victim: keeperId(),
      queue: [...lineup.arc],
      index: 0,
      timer: PUNISH.window,
      slapped: false,
      victimPos: new Vector3(),
      slapPulse: 0,
    };
    sfx.rotateCue();
    const victim = playerById(keeperId());
    setMessage(
      victim.isHuman ? 'YOU ARE TWOT — face the line…' : `${victim.name} IS TWOT — get a slap in!`,
      '#ff5252',
      PUNISH.window,
    );
  }

  /**
   * Presenting-the-victim pose: `standoff` metres in front of the current
   * attacker, facing back at them.
   */
  private punishPose(): StationPose {
    const p = rally.punish!;
    const st = stationOf(p.queue[p.index]);
    const at = stationPose(st);
    return {
      x: at.x + at.fx * PUNISH.standoff,
      z: at.z + at.fz * PUNISH.standoff,
      fx: -at.fx,
      fz: -at.fz,
    };
  }

  private tickPunish(delta: number): void {
    const p = rally.punish;
    if (!p) {
      rally.phase = 'dead';
      return;
    }
    p.slapPulse = Math.max(0, p.slapPulse - delta);
    p.timer -= delta;

    if (playerById(p.victim).isHuman) {
      // YOU lost: the sports centre drags you down the line, slapper by
      // slapper. Glide the arena so you stand presented before each one.
      const t = anchorTargetFor(this.punishPose());
      const root = arenaRefs.root;
      const k = 1 - Math.exp(-4 * delta);
      root.position.x += (t.x - root.position.x) * k;
      root.position.z += (t.z - root.position.z) * k;
      root.rotation.y += shortestAngle(root.rotation.y, t.yaw) * k;
      root.updateMatrixWorld(true);
      const head = this.playerHeadEntity?.object3D;
      if (head) head.getWorldPosition(p.victimPos);
      else p.victimPos.set(0, 1.5, 0);
    }
    // (Bot victims position themselves — BotPlayersSystem owns their bodies.)

    if (p.timer <= 0) {
      p.index += 1;
      if (p.index >= p.queue.length) {
        this.endPunish();
        return;
      }
      p.timer = PUNISH.window;
      p.slapped = false;
      sfx.serveReady();
      const slapper = playerById(p.queue[p.index]);
      setMessage(
        slapper.isHuman ? 'YOUR TURN — slap them with everything' : `${slapper.name} steps up…`,
        '#ffb226',
        PUNISH.window,
      );
    }
  }

  /** Debt paid. Same keeper, fresh word, play on. */
  private endPunish(): void {
    const victim = playerById(rally.punish?.victim ?? keeperId());
    rally.punish = null;
    rally.conceded = 0;
    twotBoard?.setLit(0);
    anchorToHuman();
    rally.phase = 'dead';
    rally.serveTimer = 1.2;
    rally.server = keeperId(); // the same keeper stays in goal
    sfx.kickoffWhistle();
    setMessage(`${victim.name} stays in goal — fresh word, play on`, '#eaf6ff', 2.6);
    persist();
  }

  // --- the rotation ceremony ---------------------------------------------------

  private beginRotation(): void {
    const save = rally.pendingSave!;
    rally.pendingSave = null;
    rally.phase = 'rotate';
    rally.rotateTimer = RALLY.rotateTime;
    rally.combo = 0;
    rally.shot = null;

    this.glideFrom = {
      x: arenaRefs.root.position.x,
      z: arenaRefs.root.position.z,
      yaw: arenaRefs.root.rotation.y,
    };

    const { newKeeper, oldKeeper } = applySaveRotation(save.shooter);
    rally.lineupVersion += 1;
    playerById(newKeeper).stats.keeperStints += 1;
    rally.keeperClock = 0;
    rally.conceded = 0; // new keeper, fresh word
    twotBoard?.setLit(0);
    syncStations();
    this.glideTo = anchorTarget();

    sfx.rotateCue();
    const nk = playerById(newKeeper);
    const ok = playerById(oldKeeper);
    setMessage(`${nk.name} TAKES THE GLOVES — ${ok.name} heads out wide`, '#29b6f6', RALLY.rotateTime + 0.6);

    // A little teleport sparkle on every pedestal that changes hands.
    for (let i = 0; i < lineup.arc.length; i++) {
      const pose = stationPose(i);
      arenaToWorld(pose.x, 1.0, pose.z, _p);
      spawnTouchPop(this.world, _p, playerById(lineup.arc[i]).accent, 0.8);
    }
    persist();
  }

  /** Glide the whole sports centre to the human's new station. */
  private tickRotation(delta: number): void {
    rally.rotateTimer -= delta;
    if (this.glideFrom && this.glideTo) {
      const t = Math.min(1, Math.max(0, 1 - rally.rotateTimer / RALLY.rotateTime));
      const e = t * t * (3 - 2 * t); // smoothstep
      const root = arenaRefs.root;
      root.position.x = this.glideFrom.x + (this.glideTo.x - this.glideFrom.x) * e;
      root.position.z = this.glideFrom.z + (this.glideTo.z - this.glideFrom.z) * e;
      root.rotation.y = this.glideFrom.yaw + shortestAngle(this.glideFrom.yaw, this.glideTo.yaw) * e;
      root.updateMatrixWorld(true);
    }
    if (rally.rotateTimer <= 0) {
      anchorToHuman();
      this.glideFrom = this.glideTo = null;
      rally.phase = 'dead';
      rally.serveTimer = 0.9;
      rally.server = this.closestPlayer();
    }
  }
}
