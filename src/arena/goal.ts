/**
 * The five-a-side goal — glossy sports-centre steel: fat white round posts
 * and crossbar with aqua trim rings, a net cage of soft white lines behind,
 * and a lime kick-plate skirt. Built in goal-local coordinates: the goal
 * LINE runs along x at z = 0 and the mouth opens toward +z (the arc);
 * the net bulges back into -z.
 */

import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { GOAL, PALETTE } from '../config.js';

function glossWhite(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.white,
    metalness: 0.35,
    roughness: 0.18,
    emissive: PALETTE.glassWhite,
    emissiveIntensity: 0.06,
  });
}

function accentMat(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.7,
    metalness: 0.3,
    roughness: 0.25,
  });
}

export interface GoalRig {
  group: Group;
}

export function buildGoal(): GoalRig {
  const group = new Group();
  group.name = 'goal';

  const { width, height, postRadius } = GOAL;
  const postGeo = new CylinderGeometry(postRadius, postRadius, height, 16);
  for (const side of [-1, 1]) {
    const post = new Mesh(postGeo, glossWhite());
    post.position.set((side * width) / 2, height / 2, 0);
    group.add(post);
    // Aqua trim rings, top and boot.
    for (const y of [0.16, height - 0.14]) {
      const ring = new Mesh(new TorusGeometry(postRadius + 0.012, 0.016, 10, 24), accentMat(PALETTE.aqua));
      ring.rotation.x = Math.PI / 2;
      ring.position.set((side * width) / 2, y, 0);
      group.add(ring);
    }
  }

  const bar = new Mesh(new CylinderGeometry(postRadius, postRadius, width + postRadius * 2, 16), glossWhite());
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, height, 0);
  group.add(bar);
  const barTrim = new Mesh(new TorusGeometry(postRadius + 0.012, 0.016, 10, 24), accentMat(PALETTE.lime));
  barTrim.rotation.y = Math.PI / 2;
  barTrim.position.set(0, height, 0);
  group.add(barTrim);

  group.add(buildNetLines());

  // Goal-line paint: a lime strip between the posts.
  const line = new Line(
    new BufferGeometry().setFromPoints([
      new Vector3(-width / 2, 0.012, 0),
      new Vector3(width / 2, 0.012, 0),
    ]),
    new LineBasicMaterial({ color: PALETTE.lime, transparent: true, opacity: 0.9 }),
  );
  group.add(line);

  return { group };
}

/** Soft white net: a curved grid of line segments from bar to floor. */
function buildNetLines(): LineSegments {
  const { width, height, depth } = GOAL;
  const cols = 16;
  const rows = 8;
  const at = (u: number, v: number, out: Vector3): Vector3 => {
    const x = (u - 0.5) * (width - 0.1);
    const y = (1 - v) * (height - 0.05);
    const z = -0.12 - (depth - 0.12) * Math.pow(v, 1.4);
    return out.set(x, y, z);
  };
  const a = new Vector3();
  const b = new Vector3();
  const pts: Vector3[] = [];
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j < rows; j++) {
      pts.push(at(i / cols, j / rows, a).clone(), at(i / cols, (j + 1) / rows, b).clone());
    }
  }
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < cols; i++) {
      pts.push(at(i / cols, j / rows, a).clone(), at((i + 1) / cols, j / rows, b).clone());
    }
  }
  const geo = new BufferGeometry().setFromPoints(pts);
  const net = new LineSegments(
    geo,
    new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
  );
  net.name = 'goal-net';
  return net;
}
