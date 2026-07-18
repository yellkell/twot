/**
 * Spawners for transient visual effects: glossy touch pops (flash + expanding
 * shockwave ring), fiery impact bursts for the hot ball, and rising combo
 * number sprites. Cheap, self-destructing entities the FXSystem animates.
 */

import {
  CanvasTexture,
  Color,
  IcosahedronGeometry,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type World,
} from '@iwsdk/core';
import { Effect, EffectKind } from '../components/Effect.js';
import { glowSprite } from '../materials/glow.js';
import { emberBurst } from './fire.js';
import { PALETTE } from '../config.js';

const SHARD_GEO = new IcosahedronGeometry(0.025, 0);

/** Every slap: a candy flash + shockwave in the toucher's accent colour. */
export function spawnTouchPop(world: World, pos: Vector3, color: number, strength = 1): void {
  const flash = glowSprite(color, 0.4 * strength);
  const fe = world.createTransformEntity(flash);
  fe.object3D!.position.copy(pos);
  fe.addComponent(Effect, { kind: EffectKind.Flash, life: 0.16, baseScale: 0.4 * strength });

  const ring = glowSprite(PALETTE.white, 0.28 * strength, 0.8);
  const re = world.createTransformEntity(ring);
  re.object3D!.position.copy(pos);
  re.addComponent(Effect, { kind: EffectKind.Ring, life: 0.3 + 0.1 * strength, baseScale: 0.28 * strength });
}

/** A fiery burst — goals, saves, and slaps once the ball is burning. */
export function spawnFireImpact(world: World, pos: Vector3, color: number = PALETTE.ember): void {
  const flash = glowSprite(color, 0.5);
  const fe = world.createTransformEntity(flash);
  fe.object3D!.position.copy(pos);
  fe.addComponent(Effect, { kind: EffectKind.Flash, life: 0.16, baseScale: 0.5 });

  const ring = glowSprite(PALETTE.whiteHot, 0.3, 0.8);
  const re = world.createTransformEntity(ring);
  re.object3D!.position.copy(pos);
  re.addComponent(Effect, { kind: EffectKind.Ring, life: 0.35, baseScale: 0.3 });

  emberBurst(pos, 16);

  const tint = new Color(color);
  for (let i = 0; i < 6; i++) {
    const mat = new MeshStandardMaterial({
      color: 0x1a1208,
      emissive: tint,
      emissiveIntensity: 1.4,
      transparent: true,
      roughness: 0.6,
    });
    const shard = new Mesh(SHARD_GEO, mat);
    const e = world.createTransformEntity(shard);
    e.object3D!.position.copy(pos);
    const dir = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const speed = 1.4 + Math.random() * 1.8;
    e.addComponent(Effect, {
      kind: EffectKind.Shard,
      life: 0.5 + Math.random() * 0.35,
      baseScale: 0.7 + Math.random() * 0.8,
      velocity: [dir.x * speed, dir.y * speed + 0.6, dir.z * speed],
      spin: (Math.random() - 0.5) * 12,
    });
  }
}

/** Short-lived text on a sprite — combo numbers, "LIVE!", "HALF VOLLEY!". */
export function spawnRisingText(
  world: World,
  pos: Vector3,
  text: string,
  cssColor: string,
  scale = 0.5,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${text.length > 4 ? 52 : 84}px 'Trebuchet MS', Verdana, sans-serif`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(8,40,66,0.85)';
  ctx.strokeText(text, 128, 66);
  ctx.fillStyle = cssColor;
  ctx.fillText(text, 128, 64);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(scale, scale * 0.5, 1);
  const e = world.createTransformEntity(sprite);
  e.object3D!.position.copy(pos);
  e.addComponent(Effect, {
    kind: EffectKind.Rise,
    life: 0.9,
    baseScale: scale,
    velocity: [0, 0.9, 0],
  });
}
