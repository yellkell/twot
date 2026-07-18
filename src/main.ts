/**
 * KEEP IT UP — entry point.
 *
 * Boots an IWSDK World with a WebXR **passthrough** (immersive-AR) session:
 * the goal, the three-point arc of pedestals and five glossy team-mates
 * float in your real room, and your controllers become enormous rubber
 * sports hands. If the device can't do AR, IWSDK falls back to VR.
 *
 * Run `npm run dev` and open the page: on a headset you'll get an "Enter AR"
 * offer; on desktop the IWSDK dev plugin provides a WebXR emulator
 * (WASD + mouse).
 */

import { SessionMode, World } from '@iwsdk/core';
import { buildArena } from './arena/arena.js';
import { setupEnvironment } from './arena/environment.js';
import { GameFlowSystem } from './systems/GameFlowSystem.js';
import { HandsSystem } from './systems/HandsSystem.js';
import { BotPlayersSystem } from './systems/BotPlayersSystem.js';
import { BallSystem } from './systems/BallSystem.js';
import { GoalSystem } from './systems/GoalSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { HudSystem } from './systems/HudSystem.js';
import { FXSystem } from './systems/FXSystem.js';
import { PavilionSystem } from './systems/PavilionSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;

World.create(container, {
  // Offer an immersive-AR (passthrough) session as soon as the page is
  // interacted with — KEEP IT UP plays in your real sports hall.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'always',
  },
  // You stand on your pedestal and slap: no locomotion, no grab system —
  // the ball is never held, only hit.
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // We light the scene ourselves (see setupEnvironment) and let passthrough
    // provide the backdrop, so the default sky is off.
    defaultLighting: false,
    camera: { position: [0, 1.6, 0] },
  },
}).then((world) => {
  setupEnvironment(world);
  buildArena(world);

  // The referee first, so the whole frame shares one clock.
  world.registerSystem(GameFlowSystem);
  // Strikes (yours, then the bots'), then ball physics, then the goal's
  // verdict on wherever the ball ended up.
  world.registerSystem(HandsSystem);
  world.registerSystem(BotPlayersSystem);
  world.registerSystem(BallSystem);
  world.registerSystem(GoalSystem);
  // Lobby, scoreboard, transient FX + fire particle pools.
  world.registerSystem(MenuSystem);
  world.registerSystem(HudSystem);
  world.registerSystem(FXSystem);
  // The lakeside pavilion backdrop (toggled against passthrough).
  world.registerSystem(PavilionSystem);

  // eslint-disable-next-line no-console
  console.info('[TWOT] World ready — hands big, ball up.');
});
