/**
 * The club roster: YOU plus the five sports-centre regulars, each with a
 * persistent stat sheet covering BOTH positions — outfield (shots, goals,
 * passes, half volleys, best combo) and between the sticks (saves, stints,
 * total seconds in goal → average time as keeper). Stats live in
 * localStorage and survive sessions, exactly like Iron Balls' scrap ledger.
 *
 * The LINEUP is the live arrangement: who is in goal and who stands on which
 * arc station (0 = far left of the arc facing the goal … 4 = far right,
 * 2 = dead centre). A saved shot rotates it: the shooter goes in goal, the
 * old keeper teleports out to a far station at random, and everyone between
 * shuffles one platform toward the centre to close the gap.
 */

import { COURT, PALETTE } from '../config.js';

export interface PlayerStats {
  touches: number;
  passes: number;
  shots: number;
  goals: number;
  /** Passes a team-mate buried with their very next touch. */
  assists: number;
  halfVolleys: number;
  saves: number;
  /** Lifetime seconds spent as the keeper (rally time only). */
  keeperSeconds: number;
  /** Times they've taken the gloves — averages keeperSeconds. */
  keeperStints: number;
  bestCombo: number;
  /**
   * AURA. Earned by slapping a TWOTed keeper (+1 each), lost by being the
   * TWOTed keeper (−1 per slap taken). Can go negative. Aura is forever.
   */
  aura: number;
}

export interface RosterPlayer {
  id: string;
  name: string;
  /** Accent colour: platform rim, hands, stat rows. */
  accent: number;
  isHuman: boolean;
  stats: PlayerStats;
}

function freshStats(): PlayerStats {
  return {
    touches: 0,
    passes: 0,
    shots: 0,
    goals: 0,
    assists: 0, // old saved club sheets pick this up via the freshStats spread
    halfVolleys: 0,
    saves: 0,
    keeperSeconds: 0,
    keeperStints: 0,
    bestCombo: 0,
    aura: 0,
  };
}

/** The six of you. Bot names off the sports-centre league sheet. */
const SEED: Array<Pick<RosterPlayer, 'id' | 'name' | 'accent' | 'isHuman'>> = [
  { id: 'you', name: 'YOU', accent: PALETTE.aqua, isHuman: true },
  { id: 'bazza', name: 'BAZZA', accent: PALETTE.lime, isHuman: false },
  { id: 'chip', name: 'CHIPPY', accent: PALETTE.sun, isHuman: false },
  { id: 'smiffy', name: 'SMIFFY', accent: PALETTE.bubblegum, isHuman: false },
  { id: 'tucker', name: 'TUCKER', accent: PALETTE.violet, isHuman: false },
  { id: 'ledge', name: 'THE LEDGE', accent: PALETTE.courtBlue, isHuman: false },
];

const STORE_KEY = 'kiu-club';

function loadAll(): Record<string, Partial<PlayerStats>> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, Partial<PlayerStats>>;
  } catch {
    /* fresh club */
  }
  return {};
}

export const roster: RosterPlayer[] = (() => {
  const saved = loadAll();
  return SEED.map((p) => ({ ...p, stats: { ...freshStats(), ...(saved[p.id] ?? {}) } }));
})();

export function playerById(id: string): RosterPlayer {
  return roster.find((p) => p.id === id) ?? roster[0];
}

export const human = roster[0];

export function saveClub(): void {
  try {
    const out: Record<string, PlayerStats> = {};
    for (const p of roster) out[p.id] = p.stats;
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable — the league table lives in memory today */
  }
}

export function resetClub(): void {
  for (const p of roster) p.stats = freshStats();
  saveClub();
}

/** Average keeper stint, formatted for the stat board. */
export function avgKeeperTime(p: RosterPlayer): string {
  if (p.stats.keeperStints <= 0) return '—';
  const s = p.stats.keeperSeconds / p.stats.keeperStints;
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// The lineup + the rotation law.
// ---------------------------------------------------------------------------

export interface Lineup {
  keeper: string;
  /** Arc stations left→right; always COURT.attackers long. */
  arc: string[];
}

/** You start dead centre of the arc; THE LEDGE starts in goal. */
export const lineup: Lineup = {
  keeper: 'ledge',
  arc: ['bazza', 'chip', 'you', 'smiffy', 'tucker'],
};

export function stationOf(id: string): 'keeper' | number {
  if (lineup.keeper === id) return 'keeper';
  return lineup.arc.indexOf(id);
}

/**
 * A save happened: the shooter takes the gloves; the old keeper teleports to
 * whichever far end of the arc fate picks, and the players between the far
 * end and the shooter's empty platform each shuffle one station toward the
 * centre to close the gap.
 */
export function applySaveRotation(shooterId: string): { newKeeper: string; oldKeeper: string; farEnd: 0 | 4 } {
  const oldKeeper = lineup.keeper;
  const s = lineup.arc.indexOf(shooterId);
  const arc = lineup.arc.slice();
  if (s >= 0) arc.splice(s, 1);
  const farEnd: 0 | 4 = Math.random() < 0.5 ? 0 : (COURT.attackers - 1) as 4;
  if (farEnd === 0) arc.unshift(oldKeeper);
  else arc.push(oldKeeper);
  lineup.keeper = shooterId;
  lineup.arc = arc;
  return { newKeeper: shooterId, oldKeeper, farEnd };
}

// ---------------------------------------------------------------------------
// Station geometry (arena-local coordinates; the goal-line is at the origin
// and the goal opens toward +z — see arena/arena.ts).
// ---------------------------------------------------------------------------

export interface StationPose {
  /** Arena-local floor position. */
  x: number;
  z: number;
  /** Arena-local facing direction (unit XZ) — attackers face the goal. */
  fx: number;
  fz: number;
}

export function stationPose(station: 'keeper' | number): StationPose {
  if (station === 'keeper') {
    const [x, z] = COURT.keeperPos;
    return { x, z, fx: 0, fz: 1 }; // facing out at the arc
  }
  const n = COURT.attackers;
  const t = n <= 1 ? 0.5 : station / (n - 1);
  const ang = -COURT.arcHalfSpread + t * COURT.arcHalfSpread * 2;
  const x = Math.sin(ang) * COURT.arcRadius;
  const z = Math.cos(ang) * COURT.arcRadius;
  const len = Math.hypot(x, z) || 1;
  return { x, z, fx: -x / len, fz: -z / len }; // facing the goal mouth
}
