/**
 * The chain-link fence behind the goal — no sports centre is complete
 * without one. A diamond-lattice canvas texture tiled across a translucent
 * plane, gloss-white posts with an aqua top rail, standing at the back of
 * the net, wider than the goal and about two goals high.
 *
 * The BOUNCE and the over-the-top law live in GoalSystem; this is just the
 * steel.
 */

import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearMipMapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
} from 'three';
import { FENCE, PALETTE } from '../config.js';

/** One tile of chain-link: two diagonal wire runs forming diamonds. */
function chainLinkTexture(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // Silvery wire with a bright top edge so it catches the light.
  for (const [color, off] of [
    ['rgba(210,222,232,0.95)', 0],
    ['rgba(120,138,152,0.9)', 2.5],
  ] as const) {
    ctx.strokeStyle = color;
    for (const dir of [1, -1]) {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        if (dir === 1) {
          ctx.moveTo(i * S - S / 2 + off, 0);
          ctx.lineTo(i * S + S / 2 + off, S);
        } else {
          ctx.moveTo(i * S + S / 2 + off, 0);
          ctx.lineTo(i * S - S / 2 + off, S);
        }
        ctx.stroke();
      }
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipMapLinearFilter;
  // ~4 diamonds per metre reads as sports-centre gauge at a distance.
  tex.repeat.set(FENCE.halfWidth * 2 * 2, FENCE.height * 2);
  return tex;
}

export function buildFence(): Group {
  const group = new Group();
  group.name = 'chain-fence';

  const mesh = new Mesh(
    new PlaneGeometry(FENCE.halfWidth * 2, FENCE.height),
    new MeshBasicMaterial({
      map: chainLinkTexture(),
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, FENCE.height / 2, FENCE.z);
  group.add(mesh);

  // Gloss-white posts along the run…
  const postMat = new MeshStandardMaterial({
    color: PALETTE.white,
    metalness: 0.35,
    roughness: 0.2,
  });
  const postGeo = new CylinderGeometry(0.045, 0.045, FENCE.height, 12);
  const n = Math.round((FENCE.halfWidth * 2) / FENCE.postGap);
  for (let i = 0; i <= n; i++) {
    const x = -FENCE.halfWidth + (i * FENCE.halfWidth * 2) / n;
    const post = new Mesh(postGeo, postMat);
    post.position.set(x, FENCE.height / 2, FENCE.z);
    group.add(post);
  }

  // …and an aqua top rail so "over" reads at a glance.
  const rail = new Mesh(
    new CylinderGeometry(0.04, 0.04, FENCE.halfWidth * 2 + 0.1, 12),
    new MeshStandardMaterial({
      color: PALETTE.aqua,
      emissive: PALETTE.aqua,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.25,
    }),
  );
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, FENCE.height, FENCE.z);
  group.add(rail);

  return group;
}
