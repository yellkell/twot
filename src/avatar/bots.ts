/**
 * The sports-centre regulars — friendly aero mannequins: a glossy white
 * head with an accent visor, a soft capsule torso wearing an accent bib,
 * a floating name tag, and (of course) the same BIG SPORTS HANDS you have,
 * at 0.8 scale. No legs; this club floats, on brand with Iron Balls.
 *
 * The rig is deliberately dumb: BotPlayersSystem owns all movement and
 * drives the hands in world space.
 */

import {
  CanvasTexture,
  CapsuleGeometry,
  Group,
  LinearFilter,
  Mesh,
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

  // Torso: a soft white capsule with an accent bib ring at the chest.
  const torso = new Mesh(new CapsuleGeometry(0.17, 0.42, 8, 20), glossMat(0xf4f9ff));
  torso.position.y = 1.05;
  group.add(torso);
  const bib = new Mesh(new TorusGeometry(0.175, 0.035, 12, 28), glossMat(accent, accent, 0.35));
  bib.rotation.x = Math.PI / 2;
  bib.position.y = 1.28;
  group.add(bib);

  // Head: glossy dome with an accent visor band.
  const head = new Group();
  head.name = 'bot-head';
  const dome = new Mesh(new SphereGeometry(0.125, 24, 18), glossMat(0xf4f9ff));
  head.add(dome);
  const visor = new Mesh(new TorusGeometry(0.105, 0.028, 12, 28), glossMat(accent, accent, 0.8));
  visor.rotation.x = Math.PI / 2.4;
  visor.position.set(0, 0.015, -0.02);
  head.add(visor);
  head.position.y = 1.62;
  group.add(head);

  const hex = `#${accent.toString(16).padStart(6, '0')}`;
  const tag = nameTag(name, hex);
  tag.position.y = 1.98;
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
