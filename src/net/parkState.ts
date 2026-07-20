/**
 * Park session state — the main-chunk bus the menu and systems read.
 * Firebase-free: joinPark() lazy-imports meshImpl (which drags the SDK in
 * as its own chunk), so the solo game never loads any of it.
 *
 * Also home of your CALLSIGN — the name other punters see. No DOM UI and
 * no keyboards in headsets, so callsigns come off a wordlist: reroll the
 * die until one makes you laugh. Your accent colour hashes off it.
 */

import { COURT, PALETTE } from '../config.js';
import type { StationPose } from '../game/roster.js';
import { NET } from './config.js';

export type ParkStatus = 'idle' | 'connecting' | 'in-park' | 'error';

// --- Callsigns -------------------------------------------------------------

const ADJ = [
  'MEGA', 'SLICK', 'RAPID', 'CRAFTY', 'GOLDEN', 'RUBBER', 'FLYING', 'CHEEKY',
  'TIDY', 'SWEATY', 'BLAZING', 'WONKY', 'PRIME', 'HUMBLE', 'DINKED', 'FERAL',
];
const NOUN = [
  'VOLLEY', 'KEEPER', 'WORLDIE', 'NUTMEG', 'TOEPOKE', 'SCORPION', 'RABONA',
  'HOWLER', 'SCREAMER', 'DINK', 'BICYCLE', 'PALM', 'MITTEN', 'GLOVE',
];

const CALLSIGN_KEY = 'twot-callsign';

function generateCallsign(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a} ${n}`;
}

function loadCallsign(): string {
  try {
    const saved = localStorage.getItem(CALLSIGN_KEY);
    if (saved) return saved;
  } catch {
    /* storage unavailable — a fresh name each visit, so be it */
  }
  const fresh = generateCallsign();
  saveCallsign(fresh);
  return fresh;
}

function saveCallsign(name: string): void {
  try {
    localStorage.setItem(CALLSIGN_KEY, name);
  } catch {
    /* see above */
  }
}

/** Accent hashes off the callsign, so a reroll re-kits you too. */
export function accentFor(callsign: string): number {
  const kit = [
    PALETTE.aqua, PALETTE.lime, PALETTE.sun, PALETTE.bubblegum,
    PALETTE.violet, PALETTE.courtBlue, PALETTE.ember, PALETTE.auraPlus,
  ];
  let h = 0;
  for (let i = 0; i < callsign.length; i++) h = (h * 31 + callsign.charCodeAt(i)) >>> 0;
  return kit[h % kit.length];
}

// --- The bus ---------------------------------------------------------------

export const park = {
  status: 'idle' as ParkStatus,
  /** Occupied seats including you (mirrored from the mesh by meshImpl). */
  count: 0,
  capacity: NET.capacity as number,
  callsign: loadCallsign(),
  error: '',
};

export function rerollCallsign(): string {
  let next = generateCallsign();
  // A reroll that lands on the same name feels broken — roll off it.
  while (next === park.callsign) next = generateCallsign();
  park.callsign = next;
  saveCallsign(next);
  return next;
}

// --- Joining and leaving ---------------------------------------------------

export async function joinPark(): Promise<void> {
  if (park.status === 'connecting' || park.status === 'in-park') return;
  park.status = 'connecting';
  park.error = '';
  try {
    // The lazy boundary: everything Firebase lives behind this import.
    const impl = await import('./meshImpl.js');
    await impl.join(park.callsign, accentFor(park.callsign));
  } catch (e) {
    park.status = 'error';
    park.error = e instanceof Error ? e.message : String(e);
  }
}

export async function leavePark(): Promise<void> {
  if (park.status !== 'in-park' && park.status !== 'error') return;
  const impl = await import('./meshImpl.js');
  await impl.leave();
  park.status = 'idle';
  park.count = 0;
}

// --- Where remote punters stand --------------------------------------------

/**
 * Display stations: a wider fan RING behind the arc, one slot per park
 * seat. In the co-presence round everyone plays their own rally, so a
 * remote punter's streamed pose (which orbits THEIR local station) is
 * re-based onto their ring slot here — nobody overlaps, everyone's visible.
 * From the shared-rally round on, lineup members stand on the real arc and
 * this ring keeps serving the overflow: the spectators.
 */
export function displayStationPose(seat: number): StationPose {
  const n = NET.capacity;
  const t = n <= 1 ? 0.5 : seat / (n - 1);
  const spread = COURT.arcHalfSpread * 1.35;
  const ang = -spread + t * spread * 2;
  const radius = COURT.arcRadius + 1.5;
  const x = Math.sin(ang) * radius;
  const z = Math.cos(ang) * radius;
  const len = Math.hypot(x, z) || 1;
  return { x, z, fx: -x / len, fz: -z / len };
}
