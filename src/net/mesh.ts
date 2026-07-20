/**
 * The mesh FACADE — the half of the networking the rest of the game is
 * allowed to touch. Firebase-free on purpose (the reference project's
 * facade/impl split): this file rides in the main chunk; meshImpl.ts and
 * the Firebase SDK are lazy-loaded the first time someone joins the park,
 * so solo players never pay for a byte of it.
 *
 * The law carried over from Iron Balls: transports NEVER mutate game
 * state. They push onto the bounded inbox here; NetSystem drains it once
 * per frame inside the ECS loop.
 */

import { Quaternion, Vector3 } from 'three';
import { NET } from './config.js';
import type { EvtMessage, PeerMessage } from './protocol.js';

export type MeshStatus = 'off' | 'connecting' | 'in-park' | 'error';

export interface PoseTarget {
  pos: Vector3;
  quat: Quaternion;
  valid: boolean;
}

/** One remote human, keyed by park seat. */
export interface PeerSlot {
  seat: number;
  clientId: string;
  uid: string;
  callsign: string;
  accent: number;
  /** Their CURRENT station in their own arena (0-4 arc, 5 keeper). */
  station: number;
  /** True once poses are flowing (and not stale). */
  hasPose: boolean;
  /** rally-independent wall clock (performance.now()/1000) of last pose. */
  lastPoseAt: number;
  head: PoseTarget;
  left: PoseTarget;
  right: PoseTarget;
}

function freshTarget(): PoseTarget {
  return { pos: new Vector3(), quat: new Quaternion(), valid: false };
}

export const mesh = {
  status: 'off' as MeshStatus,
  /** Ephemeral per-tab id (the seat claim token). */
  clientId: Math.random().toString(36).slice(2, 10),
  /** Your durable identity (set on join; keys mutes + leaderboards). */
  uid: '',
  seat: -1,
  /** Occupied seats including you. */
  count: 0,
  peers: new Map<number, PeerSlot>(),
  inbox: [] as PeerMessage[],
  /** Injected by meshImpl once channels exist; no-ops until then. */
  sendEvt: (_msg: EvtMessage): void => {},
  sendPose: (_buf: ArrayBuffer): void => {},
};

export function ensurePeer(seat: number): PeerSlot {
  let p = mesh.peers.get(seat);
  if (!p) {
    p = {
      seat,
      clientId: '',
      uid: '',
      callsign: '',
      accent: 0x29b6f6,
      station: 2,
      hasPose: false,
      lastPoseAt: 0,
      head: freshTarget(),
      left: freshTarget(),
      right: freshTarget(),
    };
    mesh.peers.set(seat, p);
  }
  return p;
}

/** Bounded push — transports call this, and ONLY this. */
export function pushInbox(msg: PeerMessage): void {
  if (mesh.inbox.length < NET.inboxCap) mesh.inbox.push(msg);
}

/** Back to a cold facade (leave/error). Keeps the clientId — it's per-tab. */
export function resetMesh(): void {
  mesh.status = 'off';
  mesh.seat = -1;
  mesh.count = 0;
  mesh.peers.clear();
  mesh.inbox.length = 0;
  mesh.sendEvt = () => {};
  mesh.sendPose = () => {};
}
