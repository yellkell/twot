/**
 * Top-level app state — the lobby vs. a live kickabout. MenuSystem owns the
 * transitions; the game systems read `state` to know when to simulate.
 */

import type { Difficulty } from '../config.js';

export type AppState = 'menu' | 'playing';

export const app: {
  state: AppState;
  difficulty: Difficulty;
} = {
  state: 'menu',
  difficulty: (localStorage.getItem('kiu-difficulty') as Difficulty) || 'casual',
};

export function saveDifficulty(): void {
  try {
    localStorage.setItem('kiu-difficulty', app.difficulty);
  } catch {
    /* ignore */
  }
}
