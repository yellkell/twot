/**
 * Remote punters, made visible: each occupied park seat gets a club-regular
 * rig (the same visor mannequin the bots wear, wearing THEIR callsign and
 * accent) standing on its ring slot behind the arc.
 *
 * THE REBASE: everyone streams poses in arena-local space, but in the
 * co-presence round each player orbits their OWN station in their OWN
 * rally. So incoming poses are re-based — from the sender's current
 * station frame onto their display slot on the ring — and nobody piles up
 * on centre arc. When the shared rally lands, lineup members' display
 * slots become the real arc stations and this same math keeps working.
 *
 * Heads and hands are exponentially smoothed toward the 30 Hz targets
 * (NET.smoothing, the reference's constant); hands ride the SportsHand
 * spring rig, so remote slaps flop exactly like local ones.
 */

import { createSystem } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import { buildBotAvatar, type BotAvatar } from '../avatar/bots.js';
import { NET } from '../net/config.js';
import { mesh, type PeerSlot, type PoseTarget } from '../net/mesh.js';
import { displayStationPose, park } from '../net/parkState.js';
import { stationPose, type StationPose } from '../game/roster.js';
import { arenaRefs, arenaToWorld } from '../arena/arena.js';

interface HandTrack {
  target: Vector3;
  quat: Quaternion;
  lastTarget: Vector3;
  vel: Vector3;
}

interface Rig {
  avatar: BotAvatar;
  callsign: string;
  accent: number;
  headPos: Vector3;
  headQuat: Quaternion;
  hands: [HandTrack, HandTrack];
  /** False until the first pose lands (snap instead of easing from origin). */
  warm: boolean;
}

const _pos = new Vector3();
const _quat = new Quaternion();
const _dq = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3();

export class RemotePlayersSystem extends createSystem({}) {
  private rigs = new Map<number, Rig>();

  update(delta: number): void {
    if (park.status !== 'in-park') {
      if (this.rigs.size > 0) this.teardownAll();
      return;
    }

    // Rigs for the seated, gone for the vacated.
    for (const [seat] of this.rigs) {
      if (!mesh.peers.has(seat)) this.teardown(seat);
    }
    for (const [seat, peer] of mesh.peers) {
      if (seat === mesh.seat || !peer.callsign) continue;
      let rig = this.rigs.get(seat);
      if (rig && (rig.callsign !== peer.callsign || rig.accent !== peer.accent)) {
        this.teardown(seat); // rerolled identity — rebuild the kit
        rig = undefined;
      }
      if (!rig) rig = this.build(seat, peer);
      this.drive(rig, seat, peer, delta);
    }
  }

  private build(seat: number, peer: PeerSlot): Rig {
    const avatar = buildBotAvatar(peer.accent, peer.callsign);
    this.scene.add(avatar.group);
    for (const hand of avatar.hands) this.scene.add(hand.group);
    const track = (): HandTrack => ({
      target: new Vector3(),
      quat: new Quaternion(),
      lastTarget: new Vector3(),
      vel: new Vector3(),
    });
    const rig: Rig = {
      avatar,
      callsign: peer.callsign,
      accent: peer.accent,
      headPos: new Vector3(),
      headQuat: new Quaternion(),
      hands: [track(), track()],
      warm: false,
    };
    this.rigs.set(seat, rig);
    return rig;
  }

  private drive(rig: Rig, seat: number, peer: PeerSlot, delta: number): void {
    const show = peer.hasPose;
    rig.avatar.group.visible = show;
    if (!show) {
      for (const hand of rig.avatar.hands) hand.setVisible(false);
      rig.warm = false;
      return;
    }

    // Rebase: sender's current station frame → their ring slot.
    const base = peer.station === 5 ? stationPose('keeper')
      : stationPose(Math.max(0, Math.min(4, Math.round(peer.station))));
    const disp = displayStationPose(seat);
    const dYaw = Math.atan2(disp.fx, disp.fz) - Math.atan2(base.fx, base.fz);
    _dq.setFromAxisAngle(_up, dYaw);
    const k = 1 - Math.exp(-NET.smoothing * delta);

    // Head.
    this.rebase(peer.head, base, disp, dYaw, _pos, _quat);
    if (!rig.warm) {
      rig.headPos.copy(_pos);
      rig.headQuat.copy(_quat);
    } else {
      rig.headPos.lerp(_pos, k);
      rig.headQuat.slerp(_quat, k);
    }

    // Body plants under the head; the rig faces where the head looks.
    _fwd.set(0, 0, -1).applyQuaternion(rig.headQuat);
    rig.avatar.group.position.set(rig.headPos.x, 0, rig.headPos.z);
    rig.avatar.group.rotation.set(0, Math.atan2(-_fwd.x, -_fwd.z), 0);
    rig.avatar.head.position.set(0, Math.max(1.2, Math.min(2.0, rig.headPos.y)), 0);
    rig.avatar.head.quaternion
      .copy(rig.avatar.group.quaternion)
      .invert()
      .multiply(rig.headQuat);

    // Hands: feed the spring rig its world-space targets.
    for (const [i, side] of ([peer.left, peer.right] as const).entries()) {
      const hand = rig.avatar.hands[i];
      const trackState = rig.hands[i];
      if (!side.valid) {
        hand.setVisible(false);
        continue;
      }
      hand.setVisible(true);
      this.rebase(side, base, disp, dYaw, trackState.target, trackState.quat);
      if (!rig.warm) {
        hand.snapTo(trackState.target, trackState.quat);
        trackState.lastTarget.copy(trackState.target);
      }
      trackState.vel
        .copy(trackState.target)
        .sub(trackState.lastTarget)
        .divideScalar(Math.max(delta, 1e-4));
      trackState.lastTarget.copy(trackState.target);
      hand.update(delta, trackState.target, trackState.quat, trackState.vel);
    }

    rig.warm = true;
  }

  /** Arena-local pose in the sender's station frame → WORLD pose here. */
  private rebase(
    t: PoseTarget,
    base: StationPose,
    disp: StationPose,
    dYaw: number,
    outPos: Vector3,
    outQuat: Quaternion,
  ): void {
    const dx = t.pos.x - base.x;
    const dz = t.pos.z - base.z;
    const cos = Math.cos(dYaw);
    const sin = Math.sin(dYaw);
    const x = disp.x + dx * cos + dz * sin;
    const z = disp.z - dx * sin + dz * cos;
    arenaToWorld(x, t.pos.y, z, outPos);
    outQuat.copy(arenaRefs.root.quaternion).multiply(_dq).multiply(t.quat);
  }

  private teardown(seat: number): void {
    const rig = this.rigs.get(seat);
    if (!rig) return;
    this.scene.remove(rig.avatar.group);
    for (const hand of rig.avatar.hands) this.scene.remove(hand.group);
    this.rigs.delete(seat);
  }

  private teardownAll(): void {
    for (const [seat] of this.rigs) this.teardown(seat);
  }
}
