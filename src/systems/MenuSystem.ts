/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, and runs the actions (play, difficulty, reset).
 * During a kickabout the menu hides and the pointers disappear — your hands
 * are for slapping.
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
import { app, saveDifficulty, type AppState } from '../menu/appState.js';
import { createMenu, type Menu, type MenuAction, type PanelId } from '../menu/menu.js';
import { resetClub } from '../game/roster.js';
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

  init(): void {
    this.menu = createMenu(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    this.applyState();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();

    if (app.state === 'playing') {
      this.hidePointers();
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
      case 'reset-stats':
        resetClub();
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
    if (app.state === 'menu') this.menu.redrawAll(this.hovered);
    this.lastState = app.state;
  }
}
