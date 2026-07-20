/**
 * The wire protocol. Two channels per peer pair (the reference pattern):
 *
 *  - `evt`  — reliable ordered, JSON. Identity, and (from the shared-rally
 *             round on) every game event: touches, shots, verdicts, phases.
 *  - `pose` — unordered, no retransmits, BINARY. The 30 Hz stream of every
 *             player's head + hands. A lost pose frame is worthless a frame
 *             later; it must never head-of-line-block an event.
 *
 * ALL spatial data travels in ARENA-LOCAL coordinates (goal-line at the
 * origin, mouth toward +z). Every peer re-anchors the arena around
 * themselves, but arena-local space is canonical and identical on all
 * peers — so a pose needs no sender-frame juggling, just worldToArena on
 * the way out and arenaToWorld on the way in.
 */

// --- The binary pose frame -------------------------------------------------
// Float32Array layout, 24 floats (96 bytes):
//   [0] seat  [1] station (0-4 arc, 5 keeper)  [2] flags (bit0 L, bit1 R valid)
//   [3..9]   head  pos xyz + quat xyzw
//   [10..16] left  pos xyz + quat xyzw
//   [17..23] right pos xyz + quat xyzw

export const POSE_FLOATS = 24;

export interface PoseMsg {
  k: 'pose';
  seat: number;
  station: number;
  leftValid: boolean;
  rightValid: boolean;
  /** 21 floats: head, left, right — each pos xyz + quat xyzw, arena-local. */
  f: Float32Array;
}

const _pack = new Float32Array(POSE_FLOATS);

/** Pack a pose frame. `body` is the 21 floats laid out as documented. */
export function packPose(
  seat: number,
  station: number,
  leftValid: boolean,
  rightValid: boolean,
  body: Float32Array,
): ArrayBuffer {
  _pack[0] = seat;
  _pack[1] = station;
  _pack[2] = (leftValid ? 1 : 0) | (rightValid ? 2 : 0);
  _pack.set(body, 3);
  // Slice: the send path may outlive this scratch buffer's next reuse.
  return _pack.slice().buffer;
}

export function unpackPose(buf: ArrayBuffer): PoseMsg | null {
  if (buf.byteLength !== POSE_FLOATS * 4) return null;
  const f = new Float32Array(buf);
  const flags = f[2];
  return {
    k: 'pose',
    seat: f[0],
    station: f[1],
    leftValid: (flags & 1) !== 0,
    rightValid: (flags & 2) !== 0,
    f: f.slice(3),
  };
}

// --- The JSON event channel ------------------------------------------------

export interface IamMsg {
  k: 'iam';
  seat: number;
  uid: string;
  callsign: string;
  accent: number;
}

export interface ByeMsg {
  k: 'bye';
  seat: number;
}

export type EvtMessage = IamMsg | ByeMsg;

/** Everything a system can drain from the mesh inbox. */
export type PeerMessage = EvtMessage | PoseMsg;
