/**
 * THE BIG SPORTS HANDS — the whole game.
 *
 * Each hand is an oversized foam-glove descendant rendered as thick glossy
 * rubber: a squashed blobby palm, four fat capsule fingers on knuckle pivots,
 * a chunky thumb, and an accent sweatband at the wrist. What sells the
 * rubber is the MOTION, all handled in update():
 *
 *  - the hand chases its controller through a position spring — it lags,
 *    overshoots and settles like something heavy and elastic;
 *  - rotation follows through a slow slerp, so a wrist flick whips the hand
 *    around a beat late;
 *  - the fingers flop AWAY from the motion on knuckle springs — swing
 *    through a ball and they trail back, stop dead and they waggle forward;
 *  - impacts squash the palm flat along its normal and it boings back.
 *
 * Bots wear the same hands at 0.8 scale, so the club looks like a club.
 */

import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { HANDS } from '../config.js';
import { glowSprite } from '../materials/glow.js';

/** Thick glossy rubber. */
function rubberMat(color: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.22,
  });
}

export interface SportsHand {
  group: Group;
  /** World-space palm contact centre — refreshed every update(). */
  palmWorld: Vector3;
  /** Spring-follow toward the target pose; drives all the flop. */
  update(dt: number, targetPos: Vector3, targetQuat: Quaternion, handVel: Vector3): void;
  /** Punch the squash — call when this hand slaps the ball. */
  impact(strength: number): void;
  /** Park the hand instantly (teleports, resets). */
  snapTo(pos: Vector3, quat: Quaternion): void;
  setVisible(v: boolean): void;
}

const _localVel = new Vector3();
const _q = new Quaternion();

/**
 * Build one hand. `isLeft` mirrors the thumb. Local frame: fingers point
 * down -z, palm faces -y (a flat hand held palm-down), wrist at +z.
 */
export function buildSportsHand(accent: number, isLeft: boolean, scale = HANDS.scale): SportsHand {
  const group = new Group();
  group.name = `sports-hand-${isLeft ? 'left' : 'right'}`;

  const white = rubberMat(0xf4f9ff);
  const tint = rubberMat(accent);

  // The palm: a generously squashed blob.
  const palm = new Mesh(new SphereGeometry(0.055, 24, 18), white);
  palm.scale.set(1.0, 0.42, 1.25);
  group.add(palm);

  // Heel of the hand — a second blob toward the wrist.
  const heel = new Mesh(new SphereGeometry(0.04, 18, 14), white);
  heel.scale.set(1.0, 0.5, 0.9);
  heel.position.set(0, -0.004, 0.045);
  group.add(heel);

  // Four fat fingers on knuckle pivots along the palm's front edge.
  const fingers: Group[] = [];
  const fingerGeo = new CapsuleGeometry(0.017, 0.062, 6, 12);
  for (let i = 0; i < 4; i++) {
    const pivot = new Group();
    const x = -0.036 + i * 0.024;
    pivot.position.set(x, 0.002, -0.052);
    const len = i === 0 || i === 3 ? 0.88 : 1.0; // shorter index + pinky
    const finger = new Mesh(fingerGeo, white);
    finger.scale.setScalar(len);
    finger.rotation.x = Math.PI / 2; // capsule long axis down -z
    finger.position.z = -0.045 * len;
    pivot.add(finger);
    // Accent fingertip.
    const tip = new Mesh(new SphereGeometry(0.0175 * len, 12, 10), tint);
    tip.position.z = -0.085 * len;
    pivot.add(tip);
    group.add(pivot);
    fingers.push(pivot);
  }

  // Thumb: angled off the side, mirrored for the left hand.
  const side = isLeft ? 1 : -1;
  const thumbPivot = new Group();
  thumbPivot.position.set(side * 0.052, 0, -0.005);
  const thumb = new Mesh(new CapsuleGeometry(0.019, 0.05, 6, 12), white);
  thumb.rotation.x = Math.PI / 2;
  thumb.position.z = -0.036;
  thumbPivot.rotation.y = side * -0.7;
  thumbPivot.rotation.z = side * 0.25;
  thumbPivot.add(thumb);
  const thumbTip = new Mesh(new SphereGeometry(0.02, 12, 10), tint);
  thumbTip.position.z = -0.068;
  thumbPivot.add(thumbTip);
  group.add(thumbPivot);

  // Accent sweatband at the wrist.
  const band = new Mesh(new CylinderGeometry(0.037, 0.041, 0.045, 16), tint);
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 0, 0.095);
  group.add(band);

  // Sweet-spot glow on the palm face.
  const spot = glowSprite(accent, 0.07, 0.5);
  spot.position.set(0, -0.028, -0.01);
  group.add(spot);

  group.scale.setScalar(scale);

  // --- flop state ---
  const pos = new Vector3();
  const vel = new Vector3();
  const palmWorld = new Vector3();
  let squash = 0;
  let fingerBend = 0;
  let fingerSway = 0;
  let started = false;

  const api: SportsHand = {
    group,
    palmWorld,

    update(dt, targetPos, targetQuat, handVel) {
      if (!started) {
        api.snapTo(targetPos, targetQuat);
        started = true;
      }
      const clamped = Math.min(dt, 1 / 30);

      // Position spring: heavy rubber chasing the controller.
      const k = HANDS.posStiffness;
      const d = HANDS.posDamping;
      vel.x += (k * (targetPos.x - pos.x) - d * vel.x) * clamped;
      vel.y += (k * (targetPos.y - pos.y) - d * vel.y) * clamped;
      vel.z += (k * (targetPos.z - pos.z) - d * vel.z) * clamped;
      pos.addScaledVector(vel, clamped);
      group.position.copy(pos);

      // Rotation follows late.
      const t = 1 - Math.exp(-HANDS.rotLag * clamped);
      group.quaternion.slerp(targetQuat, t);

      // Fingers flop away from local motion: forward swing bends them back.
      _q.copy(group.quaternion).invert();
      _localVel.copy(handVel).applyQuaternion(_q);
      const bendTarget = Math.max(-0.5, Math.min(1, -_localVel.z * 0.22)) * HANDS.fingerFlop;
      const swayTarget = Math.max(-0.6, Math.min(0.6, _localVel.x * 0.12));
      const fk = 1 - Math.exp(-HANDS.fingerSpring * clamped);
      fingerBend += (bendTarget - fingerBend) * fk;
      fingerSway += (swayTarget - fingerSway) * fk;
      for (let i = 0; i < fingers.length; i++) {
        // Slight per-finger stagger so the flop ripples instead of hinging.
        const lag = 1 - i * 0.12;
        fingers[i].rotation.x = fingerBend * lag;
        fingers[i].rotation.z = fingerSway * lag * 0.6;
      }
      thumbPivot.rotation.x = fingerBend * 0.5;

      // Impact squash boings back.
      squash = Math.max(0, squash - HANDS.squashRecover * clamped * squash - clamped * 0.5);
      const s = 1 - squash * (1 - HANDS.squash);
      group.scale.set(scale * (2 - s), scale * s, scale * (2 - s) * 0.5 + scale * 0.5);

      // Palm contact centre in world space.
      palmWorld.set(0, -0.02 * scale, -0.015 * scale).applyQuaternion(group.quaternion).add(pos);
    },

    impact(strength) {
      squash = Math.min(1, 0.55 + strength * 0.45);
      fingerBend = Math.min(1, fingerBend + strength * 0.6);
    },

    snapTo(p, q) {
      pos.copy(p);
      vel.set(0, 0, 0);
      group.position.copy(p);
      group.quaternion.copy(q);
      started = true;
    },

    setVisible(v) {
      group.visible = v;
    },
  };

  return api;
}
