/**
 * Builds the sports centre. Everything lives under one `arena-root` group in
 * ARENA-LOCAL coordinates — goal-line at the origin, mouth opening toward
 * +z, five attacker pedestals on the three-point arc — and the whole root is
 * re-anchored so that the HUMAN's current station lands exactly at the world
 * origin (your real floor IS your platform, Iron Balls style). When the
 * rotation law moves you into goal or out to a far platform, we move the
 * sports centre around you instead.
 *
 * The pedestals are the harvested Iron Balls octagon slabs, re-skinned
 * frutiger-aero: gloss white over an under-glow, an accent rim ring naming
 * each occupant.
 */

import {
  BufferGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Vector3,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import { COURT, OCTAGON_VERTICES, PALETTE, PLATFORM } from '../config.js';
import { human, lineup, playerById, stationOf, stationPose, type StationPose } from '../game/roster.js';
import { octagonSlab } from './octagon.js';
import { buildGoal } from './goal.js';
import { buildFence } from './fence.js';
import { createTitleBanner } from './banner.js';

interface StationRig {
  group: Group;
  rim: LineBasicMaterial;
  slab: MeshStandardMaterial;
}

export const arenaRefs: {
  root: Group;
  goal: Group;
  /** Arc pedestals, index 0..attackers-1 (left → right facing the goal). */
  stations: StationRig[];
  keeperStation: StationRig;
} = {
  root: new Group(),
  goal: new Group(),
  stations: [],
  keeperStation: undefined as unknown as StationRig,
};

/** A glowing outline of the platform rim, just above the floor line. */
function makeRimRing(): { line: Line; mat: LineBasicMaterial } {
  const pts = OCTAGON_VERTICES.map(([x, z]) => new Vector3(x, PLATFORM.rimLift, z));
  pts.push(pts[0].clone());
  const geo = new BufferGeometry().setFromPoints(pts);
  const mat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  const line = new Line(geo, mat);
  line.name = 'rim-ring';
  return { line, mat };
}

/**
 * One pedestal: a gloss-white slab sunk so its top face sits at floor level,
 * a coloured under-glow, and an accent rim ring naming its occupant.
 */
function makeStation(accent: number): StationRig {
  const group = new Group();

  const slabMat = new MeshStandardMaterial({
    color: PALETTE.white,
    emissive: accent,
    emissiveIntensity: 0.25,
    metalness: 0.4,
    roughness: 0.16,
  });
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), slabMat);
  slab.position.y = -PLATFORM.thickness; // top face at the real floor
  group.add(slab);

  const rim = makeRimRing();
  rim.mat.color.set(accent);
  group.add(rim.line);

  return { group, rim: rim.mat, slab: slabMat };
}

/** The painted three-point line sweeping through the five stations. */
function makeCourtLine(): Line {
  const pts: Vector3[] = [];
  const over = 0.18; // sweep a little past the end stations
  const from = -COURT.arcHalfSpread - over;
  const to = COURT.arcHalfSpread + over;
  for (let i = 0; i <= 48; i++) {
    const a = from + ((to - from) * i) / 48;
    pts.push(new Vector3(Math.sin(a) * COURT.arcRadius, 0.008, Math.cos(a) * COURT.arcRadius));
  }
  const line = new Line(
    new BufferGeometry().setFromPoints(pts),
    new LineBasicMaterial({ color: PALETTE.aqua, transparent: true, opacity: 0.8 }),
  );
  line.name = 'three-point-line';
  return line;
}

export function buildArena(world: World): Object3D {
  const root = arenaRefs.root;
  root.name = 'arena-root';

  const goal = buildGoal();
  arenaRefs.goal = goal.group;
  root.add(goal.group);

  root.add(buildFence());
  root.add(makeCourtLine());

  // Attacker pedestals along the arc, keeper pedestal in the mouth.
  arenaRefs.stations = [];
  for (let i = 0; i < COURT.attackers; i++) {
    const rig = makeStation(PALETTE.aqua);
    const pose = stationPose(i);
    rig.group.position.set(pose.x, 0, pose.z);
    rig.group.rotation.y = Math.atan2(pose.fx, pose.fz); // face the goal
    rig.group.name = `station-${i}`;
    root.add(rig.group);
    arenaRefs.stations.push(rig);
  }
  const keeper = makeStation(PALETTE.lime);
  const kp = stationPose('keeper');
  keeper.group.position.set(kp.x, 0, kp.z);
  keeper.group.name = 'station-keeper';
  root.add(keeper.group);
  arenaRefs.keeperStation = keeper;

  createTitleBanner(root);

  // --- Lighting: bright, clean sports-centre daylight ---
  root.add(new HemisphereLight(0xdff3ff, 0xbfe6c8, 1.25));
  const key = new PointLight(PALETTE.glassWhite, 6, 16);
  key.position.set(0, 4.2, COURT.arcRadius * 0.5);
  root.add(key);
  const goalGlow = new PointLight(PALETTE.aqua, 2.5, 8);
  goalGlow.position.set(0, 2.4, -0.4);
  root.add(goalGlow);

  world.scene.add(root);
  syncStations();
  anchorToHuman();
  return root;
}

/** Repaint every pedestal for its current occupant (call on lineup change). */
export function syncStations(): void {
  for (let i = 0; i < arenaRefs.stations.length; i++) {
    const rig = arenaRefs.stations[i];
    const occupant = playerById(lineup.arc[i]);
    rig.rim.color.set(occupant.accent);
    rig.slab.emissive.set(occupant.accent);
    rig.group.scale.setScalar(occupant.isHuman ? 1 : PLATFORM.botScale);
  }
  const keeper = playerById(lineup.keeper);
  arenaRefs.keeperStation.rim.color.set(keeper.accent);
  arenaRefs.keeperStation.slab.emissive.set(keeper.accent);
  arenaRefs.keeperStation.group.scale.setScalar(keeper.isHuman ? 1 : PLATFORM.botScale);
}

export interface AnchorTarget {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Where arena-root must sit so an arbitrary arena-local pose lands at the
 * world origin with its facing direction pointing down world -z.
 */
export function anchorTargetFor(pose: StationPose): AnchorTarget {
  // Yaw that turns the pose's arena-local facing onto world -z.
  const yaw = Math.atan2(pose.fx, -pose.fz);
  // Rotate the pose position by yaw, then translate it to the origin.
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const px = pose.x * cos + pose.z * sin;
  const pz = -pose.x * sin + pose.z * cos;
  return { x: -px, z: -pz, yaw };
}

/** The anchor for the human's current station. */
export function anchorTarget(): AnchorTarget {
  return anchorTargetFor(stationPose(stationOf(human.id)));
}

/** Snap the sports centre onto the human's current station. */
export function anchorToHuman(): void {
  const t = anchorTarget();
  const root = arenaRefs.root;
  root.rotation.set(0, t.yaw, 0);
  root.position.set(t.x, 0, t.z);
  root.updateMatrixWorld(true);
}

const _local = new Vector3();

/** Arena-local position of a world point (uses the root's live transform). */
export function worldToArena(world: Vector3, out: Vector3): Vector3 {
  out.copy(world);
  return arenaRefs.root.worldToLocal(out);
}

/** World position of an arena-local point. */
export function arenaToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  _local.set(x, y, z);
  return arenaRefs.root.localToWorld(out.copy(_local));
}
