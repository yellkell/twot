/**
 * Shared, mutable game state — the same bus pattern Iron Balls used for its
 * match/opponent state, grown for a six-player rally.
 *
 * `clock` ticks once per frame (GameFlowSystem, registered first). The BALL
 * is a singleton, so its body lives here as plain vectors: BallSystem
 * integrates it and paints the entity; HandsSystem, the bots and the keeper
 * all strike it by writing `vel`/`spin` through `strikeBall()`.
 */

import { Vector3 } from 'three';
import { BALL, RALLY } from '../config.js';
import { lineup, playerById, saveClub } from './roster.js';

export type RallyPhase =
  | 'idle' // lobby — no ball in play
  | 'serve' // dead ball hovering at the server, waiting for the first slap
  | 'rally' // in the air, being kept up
  | 'dead' // it bounced (and nobody half-volleyed it) — brief shame pause
  | 'rotate' // save ceremony: keeper swap + teleports
  | 'punish'; // the TWOT ceremony: keeper marched down the slap line

/** The TWOT ceremony, while `rally.phase === 'punish'`. */
export interface PunishState {
  /** The keeper who conceded the word. */
  victim: string;
  /** Attackers in arc order — each gets a window with the victim. */
  queue: string[];
  index: number;
  /** Seconds left in the current attacker's window. */
  timer: number;
  /** Whether the current attacker has landed their slap. */
  slapped: boolean;
  /** World position of the victim's chest — where slaps aim. */
  victimPos: Vector3;
  /** Counts down after a slap lands (FX/haptics consumers watch this). */
  slapPulse: number;
}

/** The one ball. World-space kinematic body + presentation scalars. */
export const ball = {
  pos: new Vector3(0, 1.2, -2),
  vel: new Vector3(),
  /** Angular velocity (rad/s); Magnus force curls flight (ω × v). */
  spin: new Vector3(),
  radius: BALL.startRadius,
  /** 0 = cold sports ball … 1.5 = white-hot fireball (drives fx/fire.ts). */
  heat: 0,
  /** Time of first floor contact this rally, or -1 — the half-volley clock. */
  bouncedAt: -1,
  /** Who last struck it, and when (rehit windows, attribution). */
  lastHitBy: '',
  lastHitAt: -1000,
  /** Whether the last strike was a power slap (shot flavour + FX). */
  lastHitPower: false,
  /** Whether the last strike was a half volley (shot flavour + bonuses). */
  lastHitHalfVolley: false,
  /** Time of the last touch by ANYONE — lost-ball watchdog. */
  lastTouchAt: 0,
};

export interface ShotFlag {
  shooter: string;
  power: boolean;
  halfVolley: boolean;
  /** Predicted arena-local x where it crosses the goal plane (keeper AI). */
  aimX: number;
  aimY: number;
}

export const rally = {
  phase: 'idle' as RallyPhase,
  time: 0, // session clock, seconds (GameFlowSystem advances)
  /** Current rally chain — the number that shrinks the ball. */
  combo: 0,
  /** Distinct players who have touched THIS ball since the serve. */
  touched: [] as string[],
  /** True once liveAfterTouches distinct players have had it. */
  live: false,
  /** Session running score (rally points + banked goals). */
  score: 0,
  bestCombo: 0,
  /** Session goal tally per player id (the scoreboard column). */
  goals: {} as Record<string, number>,
  /** Set while a struck ball is tracking toward the goal plane. */
  shot: null as ShotFlag | null,
  /** A save just happened — GameFlowSystem runs the rotation ceremony. */
  pendingSave: null as { keeper: string; shooter: string } | null,
  /** Goals conceded by the CURRENT keeper — lights the T·W·O·T letters. */
  conceded: 0,
  /** The word is complete — GameFlowSystem starts the ceremony. */
  pendingTwot: false,
  /** Live ceremony state while phase === 'punish'. */
  punish: null as PunishState | null,
  /** Who serves next / is serving. */
  server: 'you',
  serveTimer: 0,
  rotateTimer: 0,
  /** Seconds the current keeper has held the gloves (this stint). */
  keeperClock: 0,
  /** Headline + accent for the HUD; timer counts it down. */
  message: '',
  messageColor: '#eaf6ff',
  messageTimer: 0,
  /** Bumped whenever the lineup changes so scenery re-anchors. */
  lineupVersion: 0,
};

export function setMessage(text: string, color = '#eaf6ff', hold = 2.2): void {
  rally.message = text;
  rally.messageColor = color;
  rally.messageTimer = hold;
}

/** Ball size follows the combo: big and friendly → small and furious. */
export function radiusForCombo(combo: number): number {
  const t = Math.min(1, combo / BALL.shrinkCombos);
  return BALL.startRadius + (BALL.minRadius - BALL.startRadius) * t;
}

/** Fire heat follows the combo: nothing until igniteAt, inferno by infernoAt. */
export function heatForCombo(combo: number): number {
  if (combo < BALL.igniteAt) return 0;
  const t = Math.min(1, (combo - BALL.igniteAt) / Math.max(1, BALL.infernoAt - BALL.igniteAt));
  return 0.45 + t * 1.05;
}

/** Current gravity: floatier while the ball is big. */
export function gravityNow(): number {
  const t =
    (BALL.startRadius - ball.radius) / Math.max(1e-4, BALL.startRadius - BALL.minRadius);
  return BALL.gravityBig + (BALL.gravitySmall - BALL.gravityBig) * Math.min(1, Math.max(0, t));
}

export interface TouchResult {
  /** True if this touch extended the rally chain (a completed pass). */
  passCompleted: boolean;
  /** True if this touch flipped the ball LIVE. */
  wentLive: boolean;
  halfVolley: boolean;
  combo: number;
}

/**
 * Rally bookkeeping for a strike that already happened physically. Combo
 * only climbs when the ball moves BETWEEN players — juggling it to yourself
 * keeps it alive but builds nothing. The previous toucher is credited with a
 * completed pass. A half volley pays bonus combo on top.
 */
export function registerTouch(playerId: string, halfVolley: boolean): TouchResult {
  const prev = ball.lastHitBy;
  const p = playerById(playerId);
  p.stats.touches += 1;

  let passCompleted = false;
  if (prev && prev !== playerId) {
    passCompleted = true;
    playerById(prev).stats.passes += 1;
    rally.combo += 1;
    rally.score += rally.combo * RALLY.passPoints;
  }
  if (halfVolley) {
    p.stats.halfVolleys += 1;
    rally.combo += RALLY.halfVolleyBonus;
  }
  if (rally.combo > rally.bestCombo) rally.bestCombo = rally.combo;
  if (rally.combo > p.stats.bestCombo) {
    p.stats.bestCombo = rally.combo;
  }

  let wentLive = false;
  if (!rally.touched.includes(playerId)) {
    rally.touched.push(playerId);
    if (!rally.live && rally.touched.length >= RALLY.liveAfterTouches) {
      rally.live = true;
      wentLive = true;
    }
  }

  ball.lastHitBy = playerId;
  ball.lastHitAt = rally.time;
  ball.lastTouchAt = rally.time;
  ball.bouncedAt = -1; // a clean touch clears the bounce clock
  rally.shot = null; // any new touch supersedes a tracked shot

  return { passCompleted, wentLive, halfVolley, combo: rally.combo };
}

/** Fresh serve state (ball size/heat reset happens via combo = 0). */
export function resetRally(server: string): void {
  rally.combo = 0;
  rally.touched = [];
  rally.live = false;
  rally.shot = null;
  rally.server = server;
  ball.lastHitBy = '';
  ball.bouncedAt = -1;
  ball.spin.set(0, 0, 0);
  ball.vel.set(0, 0, 0);
  ball.heat = 0;
  ball.radius = radiusForCombo(0);
  ball.lastTouchAt = rally.time;
}

/** Keeper of record right now. */
export function keeperId(): string {
  return lineup.keeper;
}

/** The lit letters for the current keeper's shame: '', 'T', 'TW', 'TWO', 'TWOT'. */
export function twotLetters(): string {
  return 'TWOT'.slice(0, Math.min(4, rally.conceded));
}

/**
 * The current attacker lands their ceremony slap: aura flows from the
 * victim to the slapper, forever. Returns the pair for the caller's FX.
 */
export function landPunishSlap(): { slapper: string; victim: string } | null {
  const p = rally.punish;
  if (!p || p.slapped) return null;
  const slapper = p.queue[p.index];
  if (!slapper) return null;
  playerById(slapper).stats.aura += 1;
  playerById(p.victim).stats.aura -= 1;
  p.slapped = true;
  p.slapPulse = 0.25;
  persist();
  return { slapper, victim: p.victim };
}

/** Persist the club sheet — cheap, so call it on every scoring event. */
export function persist(): void {
  saveClub();
}
