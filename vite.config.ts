import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

// IWSDK's dev plugin injects the IWER WebXR emulator so the game can be
// flown in a desktop browser (WASD + mouse) without a headset. On a real
// Quest browser it stays out of the way and the native WebXR session is used.
export default defineConfig({
  base: './',
  plugins: [
    iwsdkDev({
      emulator: {
        // Emulate a Quest 3 device profile.
        device: 'metaQuest3',
        // Bundle the emulator into `vite build` too, and activate it on any
        // host (not just localhost) — so the deployed GitHub Pages site is
        // playable on a plain desktop browser with WASD + mouse.
        injectOnBuild: true,
        activation: 'always',
        // A REAL Quest browser (OculusBrowser UA) skips the emulator and
        // uses native WebXR passthrough. This is the plugin default, stated
        // here for clarity.
        userAgentException: /OculusBrowser/,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'esnext',
  },
});
