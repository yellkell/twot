/**
 * Top-level app state — the lobby vs. a live kickabout. MenuSystem owns the
 * transitions; the game systems read `state` to know when to simulate.
 */

import type { Difficulty } from '../config.js';

export type AppState = 'menu' | 'playing';

/** Backdrop: your real room (AR), or the lakeside pavilion (VR). */
export type ViewMode = 'passthrough' | 'pavilion';

export const app: {
  state: AppState;
  difficulty: Difficulty;
  view: ViewMode;
} = {
  state: 'menu',
  difficulty: (localStorage.getItem('kiu-difficulty') as Difficulty) || 'casual',
  view: (localStorage.getItem('twot-view') as ViewMode) || 'passthrough',
};

export function saveDifficulty(): void {
  try {
    localStorage.setItem('kiu-difficulty', app.difficulty);
  } catch {
    /* ignore */
  }
}

export function saveView(): void {
  try {
    localStorage.setItem('twot-view', app.view);
  } catch {
    /* ignore */
  }
}
