/**
 * The network heartbeat of the frame. Registered FIRST so every other
 * system sees this frame's remote state, not last frame's:
 *
 *  - drains the mesh inbox (the ONLY place network messages become game
 *    state — transports just queue);
 *  - streams your pose (head + hands, arena-local) at NET.poseRateHz;
 *  - rebroadcasts `iam` so late-opening channels still learn names;
 *  - sweeps stale peers (a tab that stops streaming for stalePeerSec is
 *    marked poseless and its avatar hides).
 *
 * Cheap when solo: one status check and out.
 */

import { createSystem } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import { NET } from '../net/config.js';
import { ensurePeer, mesh } from '../net/mesh.js';
import { accentFor, park } from '../net/parkState.js';
import { packPose } from '../net/protocol.js';
import { human, stationOf } from '../game/roster.js';
import { arenaRefs, worldToArena } from '../arena/arena.js';

const _pos = new Vector3();
const _quat = new Quaternion();
const _rootInv = new Quaternion();
const _body = new Float32Array(21);

export class NetSystem extends createSystem({}) {
  private sendTimer = 0;
  private iamTimer = 0;

  update(delta: number): void {
    if (park.status !== 'in-park' || mesh.status !== 'in-park') {
      if (mesh.inbox.length > 0) mesh.inbox.length = 0;
      return;
    }
    const now = performance.now() / 1000;
    this.drain(now);
    this.stream(delta);
    this.sweep(now);
  }

  /** Apply every queued message — the single network→game mutation point. */
  private drain(now: number): void {
    for (const msg of mesh.inbox) {
      if (msg.k === 'pose') {
        if (msg.seat === mesh.seat) continue;
        const p = ensurePeer(msg.seat);
        p.station = msg.station;
        const f = msg.f;
        p.head.pos.set(f[0], f[1], f[2]);
        p.head.quat.set(f[3], f[4], f[5], f[6]);
        p.head.valid = true;
        p.left.pos.set(f[7], f[8], f[9]);
        p.left.quat.set(f[10], f[11], f[12], f[13]);
        p.left.valid = msg.leftValid;
        p.right.pos.set(f[14], f[15], f[16]);
        p.right.quat.set(f[17], f[18], f[19], f[20]);
        p.right.valid = msg.rightValid;
        p.lastPoseAt = now;
        p.hasPose = true;
      } else if (msg.k === 'iam') {
        if (msg.seat === mesh.seat) continue;
        const p = ensurePeer(msg.seat);
        p.uid = msg.uid || p.uid;
        p.callsign = msg.callsign || p.callsign;
        p.accent = msg.accent || p.accent;
      } else if (msg.k === 'bye') {
        const p = mesh.peers.get(msg.seat);
        if (p) p.hasPose = false;
      }
    }
    mesh.inbox.length = 0;
  }

  /** Your pose out — arena-local, so every peer's re-anchored arena agrees. */
  private stream(delta: number): void {
    this.sendTimer -= delta;
    this.iamTimer -= delta;
    if (this.sendTimer > 0) return;
    this.sendTimer = 1 / NET.poseRateHz;

    _rootInv.copy(arenaRefs.root.quaternion).invert();

    const head = this.playerHeadEntity.object3D;
    if (!head) return;
    head.getWorldPosition(_pos);
    worldToArena(_pos, _pos);
    head.getWorldQuaternion(_quat).premultiply(_rootInv);
    _body[0] = _pos.x; _body[1] = _pos.y; _body[2] = _pos.z;
    _body[3] = _quat.x; _body[4] = _quat.y; _body[5] = _quat.z; _body[6] = _quat.w;

    const grips = this.world.playerSpaceEntities.gripSpaces;
    let leftValid = false;
    let rightValid = false;
    for (const [hand, base] of [['left', 7], ['right', 14]] as const) {
      const grip = grips[hand]?.object3D;
      if (!grip) continue;
      if (hand === 'left') leftValid = true;
      else rightValid = true;
      grip.getWorldPosition(_pos);
      worldToArena(_pos, _pos);
      grip.getWorldQuaternion(_quat).premultiply(_rootInv);
      _body[base] = _pos.x; _body[base + 1] = _pos.y; _body[base + 2] = _pos.z;
      _body[base + 3] = _quat.x; _body[base + 4] = _quat.y;
      _body[base + 5] = _quat.z; _body[base + 6] = _quat.w;
    }

    const st = stationOf(human.id);
    mesh.sendPose(packPose(mesh.seat, st === 'keeper' ? 5 : st, leftValid, rightValid, _body));

    if (this.iamTimer <= 0) {
      this.iamTimer = NET.iamSec;
      mesh.sendEvt({
        k: 'iam',
        seat: mesh.seat,
        uid: mesh.uid,
        callsign: park.callsign,
        accent: accentFor(park.callsign),
      });
    }
  }

  /** A silent peer is a dead tab (or a broken pair) — hide, don't haunt. */
  private sweep(now: number): void {
    for (const p of mesh.peers.values()) {
      if (p.hasPose && now - p.lastPoseAt > NET.stalePeerSec) p.hasPose = false;
    }
  }
}
