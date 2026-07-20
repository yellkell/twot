/**
 * Network tunables — one place, like the game's config.ts. Rates and
 * timeouts are lifted from the Iron Balls raid mesh (the reference
 * implementation this park networking is harvested from) and adjusted
 * for a hangout park rather than a boxing bout.
 */

export const NET = {
  /** Pose stream rate (head + both hands), Hz. */
  poseRateHz: 30,
  /** Host ball stream rate, Hz (used from the shared-rally round on). */
  ballRateHz: 20,
  /** Exponential smoothing rate for remote pose targets (per second). */
  smoothing: 24,
  /** Guest ball drift beyond this (m) snaps instead of easing. */
  snapDist: 0.75,
  /** `iam` identity rebroadcast cadence, seconds. */
  iamSec: 2,
  /** A peer streaming no poses for this long is stale (their tab died). */
  stalePeerSec: 7,
  /** Firestore heartbeat cadence, seconds. */
  beatSec: 30,
  /** A seat whose heartbeat is older than this gets janitored. */
  staleSeatSec: 120,
  /** Bounded network inbox — transports push, systems drain per frame. */
  inboxCap: 512,
  /** Park capacity: 6 lineup slots' worth of humans + 2 spectators. */
  capacity: 8,
} as const;
