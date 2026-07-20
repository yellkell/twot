/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, and runs the actions (play, difficulty, reset).
 * During a kickabout the menu hides and the pointers disappear — your hands
 * are for slapping — EXCEPT when you press A (or X): that summons the pause
 * panel (resume / leave), and the pointers come back to click it.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import { app, saveDifficulty, saveView, type AppState } from '../menu/appState.js';
import { createMenu, createPausePanel, type Menu, type MenuAction, type MenuPanel, type PanelId } from '../menu/menu.js';
import { resetClub } from '../game/roster.js';
import { joinPark, leavePark, park, rerollCallsign } from '../net/parkState.js';
import * as sfx from '../audio/sfx.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private menu!: Menu;
  private ray = new Raycaster();
  private hovered: PanelId | null = null;
  private lastState: AppState | null = null;
  private pointers: Record<'left' | 'right', Pointer> = {} as Record<'left' | 'right', Pointer>;
  private redrawTimer = 0;

  private pause!: MenuPanel;
  private pauseOpen = false;
  private pauseHover = false;

  init(): void {
    this.menu = createMenu(this.scene);
    this.pause = createPausePanel();
    this.scene.add(this.pause.mesh);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    this.applyState();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();

    if (app.state === 'playing') {
      this.updatePauseMenu();
      return;
    }

    // Lobby: hover + click the panels.
    let hover: PanelId | null = null;
    const meshes = this.menu.panels.map((p) => p.mesh);
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, meshes);
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      hover = panel.id;
      if (hit.uv && this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        const action = panel.hitTest(hit.uv.x, hit.uv.y);
        if (action) this.run(action);
      }
    }
    if (hover !== this.hovered) {
      this.hovered = hover;
      this.menu.redrawAll(hover);
    }

    // Periodic redraw so the club sheet stays fresh after a session.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.75;
      this.menu.redrawAll(this.hovered);
    }
  }

  /** In-game: A (or X) summons/dismisses the pause panel; lasers click it. */
  private updatePauseMenu(): void {
    const pads = this.input.xr.gamepads;
    const toggled =
      (pads.right?.getButtonDown(InputComponent.A_Button) ?? false) ||
      (pads.left?.getButtonDown(InputComponent.X_Button) ?? false);
    if (toggled) {
      this.pauseOpen = !this.pauseOpen;
      sfx.ensureAudio();
      sfx.uiClick();
      this.pause.mesh.visible = this.pauseOpen;
      if (this.pauseOpen) this.pause.redraw(false);
    }
    if (!this.pauseOpen) {
      this.hidePointers();
      return;
    }

    let hover = false;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.pause.mesh]);
      if (!hit) continue;
      hover = true;
      if (hit.uv && pads[hand]?.getButtonDown(InputComponent.Trigger)) {
        const action = this.pause.hitTest(hit.uv.x, hit.uv.y);
        if (action === 'resume') this.closePause();
        else if (action === 'toggle-view') {
          sfx.uiClick();
          app.view = app.view === 'pavilion' ? 'passthrough' : 'pavilion';
          saveView();
          this.pause.redraw(true);
        } else if (action === 'leave') {
          sfx.uiClick();
          this.closePause();
          app.state = 'menu';
        }
      }
    }
    if (hover !== this.pauseHover) {
      this.pauseHover = hover;
      this.pause.redraw(hover);
    }
  }

  private closePause(): void {
    this.pauseOpen = false;
    this.pause.mesh.visible = false;
    this.hidePointers();
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    switch (action) {
      case 'play':
        app.state = 'playing';
        break;
      case 'toggle-difficulty':
        app.difficulty = app.difficulty === 'pro' ? 'casual' : 'pro';
        saveDifficulty();
        break;
      case 'toggle-view':
        // PavilionSystem watches app.view and swaps the world over.
        app.view = app.view === 'pavilion' ? 'passthrough' : 'pavilion';
        saveView();
        break;
      case 'reset-stats':
        resetClub();
        break;
      case 'join-park':
        // Async: the periodic redraw keeps the status label honest while
        // the lazy Firebase chunk loads and the seat claim lands. The park
        // IS the game — a successful join drops you straight into a bot
        // kickabout (humans take over bot slots when the shared rally
        // lands next round).
        void joinPark().then(() => {
          if (park.status === 'in-park') app.state = 'playing';
          this.applyState();
          this.menu.redrawAll(this.hovered);
        });
        break;
      case 'leave-park':
        void leavePark().then(() => this.menu.redrawAll(this.hovered));
        break;
      case 'reroll-callsign':
        rerollCallsign();
        break;
    }
    this.applyState();
    this.menu.redrawAll(this.hovered);
  }

  // --- controller pointers -------------------------------------------------

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.85 }));
    line.name = 'menu-pointer';
    line.frustumCulled = false;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0x9be82a }));
    dot.visible = false;
    this.scene.add(line);
    this.scene.add(dot);
    return { line, dot };
  }

  /** Point the laser down the hand's ray, snap its end + dot to any hit. */
  private updatePointer(hand: 'left' | 'right', targets: Object3D[]): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
    if (!rayObj) {
      p.line.visible = false;
      p.dot.visible = false;
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
    this.ray.set(_origin, _dir);
    const hit = this.ray.intersectObjects(targets, false)[0];
    _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.6));
    const pos = p.line.geometry.getAttribute('position');
    pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
    pos.setXYZ(1, _end.x, _end.y, _end.z);
    pos.needsUpdate = true;
    p.line.visible = true;
    if (hit) {
      p.dot.position.copy(hit.point);
      p.dot.visible = true;
    } else {
      p.dot.visible = false;
    }
    return hit;
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  private applyState(): void {
    this.menu.setVisible(app.state === 'menu');
    this.closePause();
    if (app.state === 'menu') this.menu.redrawAll(this.hovered);
    this.lastState = app.state;
  }
}
