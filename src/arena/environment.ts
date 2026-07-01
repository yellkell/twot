/**
 * The look foundation for passthrough KEEP IT UP.
 *
 * In an immersive-AR session the player's real room IS the sports hall, so
 * we do NOT draw a sky dome or a big floor — those would paint over the
 * passthrough feed. We keep neutral tone mapping plus a bright frutiger-aero
 * image-based light: swimming-pool sky above, warm court sheen below, so the
 * gloss white plastic, rubber hands and the ball pick up that
 * sunny-leisure-centre light. If the device can't do AR, IWSDK falls back to
 * a VR session and we paint a deep aqua backdrop.
 */

import { Color, IBLGradient, type World } from '@iwsdk/core';
import { PALETTE } from '../config.js';

/** hex → [r,g,b,a] in 0..1 for Types.Color component fields. */
function rgba(hex: number, a = 1): [number, number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b, a];
}

export function setupEnvironment(world: World): void {
  world.renderer.toneMappingExposure = 1.0;

  // Transparent backdrop so the AR passthrough feed shows through.
  world.scene.background = null;
  world.renderer.setClearColor(new Color(PALETTE.aquaDeep), 0);

  // Aero sky above, sunlit court below — lighting only, never a visible dome.
  const env = world.createTransformEntity(undefined, { persistent: true });
  env.addComponent(IBLGradient, {
    sky: rgba(PALETTE.sky),
    equator: rgba(0xf6fbff),
    ground: rgba(0xd8f0c8),
    intensity: 1.15,
  });
}
