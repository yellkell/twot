/**
 * The sports-centre regulars — friendly aero mannequins, Mii-adjacent:
 * a glossy white head with a proper FACE (eyes + smile, it watches the
 * ball) under an accent baseball cap, an accent jersey with shoulders,
 * and a deliberate spinning-top hover taper instead of legs — this club
 * floats ON PURPOSE, soft shadow underneath to prove it. Plus the same
 * BIG SPORTS HANDS you have, at 0.8 scale.
 *
 * The rig is deliberately dumb: BotPlayersSystem owns all movement and
 * drives the hands in world space. Forward is -z (FWD in that system),
 * so the face and cap brim live on the -z side of the head.
 */

import {
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
} from 'three';
import { buildSportsHand, type SportsHand } from './hands.js';
import { HANDS } from '../config.js';
import { glowSprite } from '../materials/glow.js';

function glossMat(color: number, emissive = 0, intensity = 0): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
  });
}

function nameTag(name: string, accentCss: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = 30;
  ctx.beginPath();
  ctx.roundRect(8, 10, 240, 60, r);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = accentCss;
  ctx.stroke();
  ctx.font = `900 34px 'Trebuchet MS', Verdana, sans-serif`;
  ctx.fillStyle = '#083a5e';
  ctx.fillText(name, 128, 42);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(0.55, 0.17, 1);
  return sprite;
}

const WHITE = 0xf4f9ff;
const INK = 0x0e2233;

export interface BotAvatar {
  /** Body root (world space) — position at the bot's feet on its station. */
  group: Group;
  head: Group;
  /** World-space sports hands, driven by BotPlayersSystem. */
  hands: [SportsHand, SportsHand];
  /** Ceremony aura halo: gold for a slapper, violet for the TWOTed. */
  aura: Sprite;
}

export function buildBotAvatar(accent: number, name: string): BotAvatar {
  const group = new Group();
  group.name = `bot-${name}`;

  // Jersey: an accent capsule so you can tell BAZZA from CHIPPY across the
  // arc, with round shoulders and a white collar where the head sits.
  const torso = new Mesh(new CapsuleGeometry(0.185, 0.3, 8, 20), glossMat(accent, accent, 0.12));
  torso.position.y = 1.1;
  group.add(torso);
  for (const side of [-1, 1]) {
    const shoulder = new Mesh(new SphereGeometry(0.075, 16, 12), glossMat(accent, accent, 0.12));
    shoulder.position.set(side * 0.2, 1.36, 0);
    group.add(shoulder);
  }
  const collar = new Mesh(new TorusGeometry(0.09, 0.03, 10, 24), glossMat(WHITE));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.44;
  group.add(collar);

  // No legs — a spinning-top taper, so floating reads as the design, not
  // an amputation. White shorts roll into a point.
  const shorts = new Mesh(new SphereGeometry(0.17, 20, 14), glossMat(WHITE));
  shorts.scale.set(1.05, 0.72, 0.95);
  shorts.position.y = 0.84;
  group.add(shorts);
  const taper = new Mesh(new ConeGeometry(0.145, 0.44, 20), glossMat(WHITE));
  taper.rotation.x = Math.PI; // apex down
  taper.position.y = 0.62;
  group.add(taper);
  const shadow = new Mesh(
    new CircleGeometry(0.3, 24),
    new MeshBasicMaterial({ color: 0x06141f, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  group.add(shadow);

  // Head: glossy sphere that watches the ball — so give it a face worth
  // turning. Two ink eyes, a smile, and an accent cap with a brim.
  const head = new Group();
  head.name = 'bot-head';
  const dome = new Mesh(new SphereGeometry(0.145, 24, 18), glossMat(WHITE));
  head.add(dome);
  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(0.022, 12, 10), glossMat(INK));
    eye.scale.set(1, 1.35, 0.55);
    eye.position.set(side * 0.054, 0.022, -0.13);
    head.add(eye);
  }
  // Smile: a torus arc, rotated so the sweep hangs under the eyes.
  const smileArc = Math.PI * 0.75;
  const smile = new Mesh(new TorusGeometry(0.05, 0.011, 8, 16, smileArc), glossMat(INK));
  smile.rotation.z = Math.PI + (Math.PI - smileArc) / 2;
  smile.position.set(0, -0.038, -0.128);
  head.add(smile);
  // The cap: a shell over the crown plus a flattened-sphere brim out front.
  const cap = new Mesh(
    new SphereGeometry(0.152, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
    glossMat(accent, accent, 0.2),
  );
  cap.rotation.x = -0.18; // tip it toward the brim
  cap.position.y = 0.008;
  head.add(cap);
  const brim = new Mesh(new SphereGeometry(0.085, 18, 10), glossMat(accent, accent, 0.2));
  brim.scale.set(1.25, 0.14, 1.5);
  brim.position.set(0, 0.06, -0.135);
  brim.rotation.x = 0.22; // angled down at the front
  head.add(brim);
  head.position.y = 1.63;
  group.add(head);

  const hex = `#${accent.toString(16).padStart(6, '0')}`;
  const tag = nameTag(name, hex);
  tag.position.y = 2.02;
  group.add(tag);

  const hands: [SportsHand, SportsHand] = [
    buildSportsHand(accent, true, HANDS.scale * 0.8),
    buildSportsHand(accent, false, HANDS.scale * 0.8),
  ];

  const aura = glowSprite(0xffd700, 1.7, 0.55);
  aura.position.y = 1.15;
  aura.visible = false;
  group.add(aura);

  return { group, head, hands, aura };
}
