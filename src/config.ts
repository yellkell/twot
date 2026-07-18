/**
 * KEEP IT UP tunables — the game is a British playground classic reborn in a
 * frutiger-aero sports centre: one goalkeeper, five attackers arced around the
 * goal like a basketball three-point line, and a great big ball you keep off
 * the floor with GREAT BIG RUBBER SPORTS HANDS.
 *
 * The loop: keep it up between you. After the THIRD different player touches
 * it the ball is LIVE — anyone can slap it at the goal, or keep rallying to
 * build the combo. Every rally pass shrinks the ball a step; rally long
 * enough and it catches fire (we kept the fire). One bounce kills it — unless
 * somebody slaps it THE MOMENT it lands: a half volley, and it counts.
 * A saved shot swaps the shooter into goal.
 *
 * Numbers the gameplay feel depends on live here. Dimensions in metres.
 */

import type { Vector2Tuple } from 'three';

export const GAME_TITLE = 'TWOT';

/**
 * THE TWOT LAW. Every goal a keeper concedes lights a letter: T… TW… TWO…
 * TWOT. Four letters and the keeper LOSES — they're marched down the line
 * and every attacker gets a window to slap them with the big floppy hands.
 * Slapper +aura, keeper −aura (aura is forever). Then the game resets with
 * the SAME keeper still in goal.
 */
export const PUNISH = {
  /** Goals conceded to complete the word and trigger the ceremony. */
  letters: 4,
  /** Seconds each attacker gets with the keeper in front of them. */
  window: 2.6,
  /** How far into their window a BOT swings the slap. */
  botSlapAt: 1.1,
  /** How far in front of the attacker the keeper is presented (m). */
  standoff: 1.15,
  /** Aura transferred per landed slap. */
  aura: 1,
  /** Pause after the 4th goal before the march begins. */
  intro: 2.2,
};

/**
 * Every player stands on an octagonal pedestal (same silhouette as the Iron
 * Balls pads — they were too good not to harvest). Vertices are clockwise in
 * the floor plane, centred on the player.
 */
export const OCTAGON_HALF_WIDTH = 0.86;
export const OCTAGON_HALF_DEPTH = 0.75;
const EDGE_HALF = 0.375;
const CHAMFER = 0.375;

/** Octagon outline (clockwise), centred on a player station. */
export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH],
  [EDGE_HALF, -OCTAGON_HALF_DEPTH],
  [OCTAGON_HALF_WIDTH, -CHAMFER],
  [OCTAGON_HALF_WIDTH, CHAMFER],
  [EDGE_HALF, OCTAGON_HALF_DEPTH],
  [-EDGE_HALF, OCTAGON_HALF_DEPTH],
  [-OCTAGON_HALF_WIDTH, CHAMFER],
  [-OCTAGON_HALF_WIDTH, -CHAMFER],
];

/** The visible platform slab under each player. */
export const PLATFORM = {
  thickness: 0.14, // slab depth below the floor line — reads as a pedestal
  rimLift: 0.012, // glow rim line height above the floor
  /** Bot pedestals are scaled down a touch so YOURS reads as the big stage. */
  botScale: 0.82,
};

/**
 * The court. Arena-local coordinates put the goal-line at the origin with the
 * goal opening toward +z; the five attacker stations sit on an arc around it
 * — the "three-point line". Station 0 is the far LEFT of the arc (looking at
 * the goal), station 4 the far right, station 2 dead centre.
 */
export const COURT = {
  /** Arc radius from the goal mouth to the attacker stations. */
  arcRadius: 4.2,
  /** Half-spread of the arc in radians (stations at ±spread … evenly). */
  arcHalfSpread: (60 * Math.PI) / 180,
  /** Attacker stations on the arc (goalie makes six players total). */
  attackers: 5,
  /** The keeper's station: just inside the goal mouth, facing the arc. */
  keeperPos: [0, 0.45] as Vector2Tuple, // arena-local [x, z]
  /** A painted three-point line on the floor connecting the stations. */
  lineWidth: 0.06,
};

/** Five-a-side goal, sports-centre spec: 3 m wide, 2 m tall. */
export const GOAL = {
  width: 3.0,
  height: 2.0,
  depth: 1.1, // net cage depth behind the line
  postRadius: 0.055,
  /** Shots crossing the plane within this margin outside the frame = "off target" but still a shot. */
  missMargin: 0.9,
};

/**
 * The chain-link fence behind the goal — every sports centre has one.
 * It stands at the back of the net, runs WIDER than the whole platform arc
 * and FOUR GOALS high. Balls bounce off it and the rally stays alive; put
 * one over it (or wide past its edge) and YOU'RE in goal — and at this
 * size, that takes a genuinely disgraceful slap.
 */
export const FENCE = {
  /** Arena-local z of the fence plane (just behind the net cage). */
  z: -1.35,
  /** 11 m wide — the far arc stations sit at ±3.6, platforms end ~±4.5. */
  halfWidth: 5.5,
  height: 8.0, // four goals high
  restitution: 0.72,
  /** Post spacing for the visual frame. */
  postGap: 1.85,
};

/**
 * THE BALL. Starts beach-ball big and stone cold; every rally pass shrinks it
 * a step and stokes it hotter — deep in a combo it is a small roaring
 * fireball (fx/fire.ts, proudly harvested from Iron Balls).
 */
export const BALL = {
  /** Base radius the fire shader/geometry are authored at — do not change. */
  baseRadius: 0.09,
  /** Fresh serve: really big, really friendly. */
  startRadius: 0.36,
  /** Fully rallied: small, fast, on fire. */
  minRadius: 0.115,
  /** Combo steps to shrink from start to min. */
  shrinkCombos: 10,
  /** Combo at which the fire starts licking… */
  igniteAt: 4,
  /** …and the combo where it burns white-hot (heat maxes). */
  infernoAt: 12,

  /** Gravity is floaty while the ball is big, meaner as it shrinks. */
  gravityBig: 3.6,
  gravitySmall: 6.4,
  /** Linear air drag per second. */
  drag: 0.10,
  /** Magnus lift: spin × velocity → curve. This is the curve-shot dial. */
  magnus: 0.30,
  /** Spin bleeds off at this fraction per second. */
  spinDecay: 0.6,
  maxSpin: 18, // rad/s cap
  maxSpeed: 11, // m/s hard cap, keeps saves humanly possible

  /** Floor contact: restitution of the (single, fatal) bounce. */
  bounce: 0.5,
  /** Slap it within this window of the bounce and it's a HALF VOLLEY. */
  halfVolleyWindow: 0.24,

  /** Serve: the ball hovers here in front of the server, waiting for a slap. */
  serveHeight: 1.15,
  serveAhead: 0.55,
  serveLerp: 10, // exponential settle rate toward the serve anchor
};

/**
 * THE HANDS — the whole game. Two enormous foam-finger-ancestry sports hands,
 * thick glossy rubber, locked to your controllers but always half a beat
 * behind: they lag, they overshoot, they wobble, the fingers flop back when
 * you whip a slap through the ball.
 */
export const HANDS = {
  /** Overall scale of the hand rig (a real palm is ~0.09 m across…). */
  scale: 2.7,
  /** Contact sphere radius (world m, post-scale) centred on the palm. */
  contactRadius: 0.21,
  /** Hand must be moving at least this fast (m/s) for a touch to be a slap. */
  minSlapSpeed: 0.55,
  /** Relative speed above this = a POWER SHOT (extra gain, big thwack). */
  powerSpeed: 3.4,
  /** Hand speed → ball speed multiplier. */
  slapGain: 1.5,
  powerGain: 1.9,
  /** Restitution of ball-vs-rubber. */
  restitution: 0.55,
  /** Tangential hand motion → ball spin (the curve-shot coupling). */
  spinGain: 9.0,
  /** Seconds before the same hand can strike the ball again. */
  rehitCooldown: 0.18,
  /**
   * JUGGLE ASSIST. A gentle, mostly-UPWARD slap is you keeping it up for
   * yourself — so the more vertical the swing (and the softer it is), the
   * harder we damp the sideways drift and spin that would carry it off to
   * a team-mate. Power slaps are exempt: a smashed ball goes where physics
   * says. 0 = off, 1 = a straight-up slap goes dead straight up.
   */
  juggleAssist: 0.7,
  /** Swing verticality (|vy|/speed) where the assist starts blending in. */
  juggleFrom: 0.55,

  // The FLOP. Position/rotation follow the grip through a spring — thick
  // rubber, not rigid plastic. Higher stiffness = tighter follow.
  posStiffness: 260, // spring k for position (crit-damped-ish)
  posDamping: 26,
  rotLag: 14, // exponential slerp rate for rotation (lower = floppier)
  /** Finger flop: how far back the fingers bend at full swing (radians). */
  fingerFlop: 0.85,
  fingerSpring: 24, // return rate of the finger bend
  /** Impact squash: scale dip on a slap, springs back. */
  squash: 0.82,
  squashRecover: 9,
};

/** Rally / combo law. */
export const RALLY = {
  /** Distinct players who must touch the serve before the ball is LIVE. */
  liveAfterTouches: 3,
  /** Bonus combo steps for a half volley (it counts, and then some). */
  halfVolleyBonus: 2,
  /** Points: each rally pass pays combo × this. */
  passPoints: 10,
  /** A goal banks combo × this. */
  goalPoints: 50,
  /** Extra for scoring with a power shot / half volley. */
  powerGoalBonus: 100,
  halfVolleyGoalBonus: 150,
  /** Dead-ball pause before the closest player serves. */
  serveDelay: 1.6,
  /** Rotation ceremony length after a save (keeper swap + teleports). */
  rotateTime: 2.2,
};

/** The five bots you share the sports centre with. */
export const BOT = {
  /** Reach: they can play a ball this far from their station centre. */
  reach: 1.35,
  /** Seconds of "seeing it" before they can strike. */
  reactTime: { casual: 0.34, pro: 0.22 },
  /** Aim slop (m at the target) when passing / shooting. */
  passError: { casual: 0.5, pro: 0.3 },
  shotError: { casual: 0.55, pro: 0.28 },
  /** Chance a LIVE touch becomes a shot instead of another pass. */
  shootChance: { casual: 0.3, pro: 0.4 },
  /** Chance a shot gets deliberate curve on it. */
  curveChance: 0.45,
  /** Pass flight-time per metre of range (slower = lazier lobs). */
  passPace: 0.24,
  minFlight: 0.75,
  maxFlight: 1.5,
  /** How often they pick you as the pass target (you're the guest of honour). */
  passToHumanBias: 0.42,
  /** Keeper: lateral reach either side of goal centre they can cover. */
  keeperReach: { casual: 0.95, pro: 1.25 },
  keeperReactTime: { casual: 0.30, pro: 0.20 },
  /** Idle bounce of their hands while they wait. */
  idleBobAmp: 0.05,
  idleBobRate: 1.8,
};

/** How long the ball can fly without ANY touch before we call it lost. */
export const LOST_BALL_TIMEOUT = 8;

/**
 * Frutiger-aero sports centre palette: gloss white, swimming-pool aqua, lime
 * energy, one warm accent — plus the fire ramp riding underneath it all.
 */
export const PALETTE = {
  sky: 0x7ec9f5,
  aqua: 0x29b6f6,
  aquaDeep: 0x0b62a8,
  lime: 0x9be82a,
  sun: 0xffb226,
  bubblegum: 0xff7ac8,
  violet: 0x9a7bff,
  white: 0xf7fbff,
  glassWhite: 0xeaf6ff,
  courtBlue: 0x1e7fc4,
  ember: 0xff7a18, // the fire keeps its Iron Balls soul
  flame: 0xffc04d,
  whiteHot: 0xfff3cf,
  charcoal: 0x191b22,
  auraPlus: 0xffd700, // golden glow on the slapper
  auraMinus: 0x8b2dc4, // the shameful violet of a TWOTed keeper
};

/** Difficulty switch (lobby toggle). */
export type Difficulty = 'casual' | 'pro';
