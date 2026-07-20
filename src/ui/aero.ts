/**
 * The shared 2D-canvas drawing kit: the AERO palette (swimming-pool blues,
 * lime energy, candy signals — the sports-centre optimism the game was born
 * with) plus THE ARENA BOARD KIT below — the smoked dark scoreboard glass
 * that every surface now wears: the goal HUD, the title banner, the pavilion
 * LED feed and the lobby menu. One visual language, one file (the same job
 * industrial.ts did for Iron Balls).
 */

export const AERO = {
  // The signal palette — on the dark board, colour is used ONLY as signal:
  // lime = live/go, sun = heat, red = danger/letters, violet = the pavilion
  // + shame aura, aqua = the water the whole sports centre swims in.
  aqua: '#29b6f6',
  lime: '#9be82a',
  sun: '#ffb226',
  violet: '#9a7bff',
  danger: '#ff5252',
};

/** Rounded, friendly type — the anti-stencil. */
export function aeroFont(px: number, weight = 800): string {
  return `${weight} ${px}px 'Trebuchet MS', 'Segoe UI', Verdana, system-ui, sans-serif`;
}

export function roundPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// THE ARENA BOARD KIT — the scoreboard's shared visual language: smoked dark
// glass with an aqua rim glow, big white digits, dim slate labels, and colour
// used only as signal (lime = live, amber = heat, red = letters/danger).
// Used by the goal-mounted HUD and the pavilion LED board so both read as
// one piece of kit.
// ---------------------------------------------------------------------------

export const BOARD = {
  bgTop: '#060d15',
  bgBottom: '#0c1b29',
  rim: 'rgba(126,214,255,0.65)',
  hairline: 'rgba(255,255,255,0.10)',
  inset: 'rgba(255,255,255,0.05)',
  label: 'rgba(164,198,222,0.85)',
  value: '#f4faff',
  slate: 'rgba(190,214,232,0.65)',
};

/** The smoked-glass board face: dark gradient, glowing rim, whisper of gloss. */
export function boardPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radius = 30,
): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, BOARD.bgTop);
  g.addColorStop(1, BOARD.bgBottom);
  roundPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = g;
  ctx.fill();

  // A faint aero lens so it still belongs to the sports centre.
  ctx.save();
  roundPath(ctx, x, y, w, h, radius);
  ctx.clip();
  const lens = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
  lens.addColorStop(0, 'rgba(255,255,255,0.10)');
  lens.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lens;
  ctx.fillRect(x, y, w, h * 0.4);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(70,180,255,0.8)';
  ctx.shadowBlur = 10;
  roundPath(ctx, x, y, w, h, radius);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = BOARD.rim;
  ctx.stroke();
  ctx.restore();
}

/** Dim small-caps section label. */
export function boardLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  align: CanvasTextAlign = 'left',
  px = 21,
): void {
  ctx.font = aeroFont(px, 800);
  ctx.textAlign = align;
  ctx.fillStyle = BOARD.label;
  ctx.fillText(text.toUpperCase(), x, y);
}

/** Bright glowing text — the board's "lit LED" treatment. */
export function boardGlow(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  px: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight = 900,
): void {
  ctx.font = aeroFont(px, weight);
  ctx.textAlign = align;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = px * 0.16;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * The T·W·O·T letter track: ONE quiet inset slot holding the whole word —
 * unlit letters are just dim glyphs resting in it (no per-letter boxes;
 * the old segmented cells read like a broken filing cabinet), and each
 * conceded letter LIGHTS as a red cell inside the slot.
 */
export function letterTrack(
  ctx: CanvasRenderingContext2D,
  rightX: number, topY: number,
  cellW: number, cellH: number, gap: number,
  lit: number,
): void {
  const word = ['T', 'W', 'O', 'T'];
  const totalW = cellW * 4 + gap * 3;
  const leftX = rightX - totalW;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  roundPath(ctx, leftX, topY, totalW, cellH, 8);
  ctx.fillStyle = BOARD.inset;
  ctx.fill();
  roundPath(ctx, leftX, topY, totalW, cellH, 8);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = BOARD.hairline;
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const cx = leftX + i * (cellW + gap);
    ctx.font = aeroFont(cellH * 0.62, 900);
    if (i < lit) {
      ctx.save();
      ctx.shadowColor = '#ff2617';
      ctx.shadowBlur = 8;
      roundPath(ctx, cx + 1, topY + 1, cellW - 2, cellH - 2, 6);
      ctx.fillStyle = '#e02b1d';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
    }
    ctx.fillText(word[i], cx + cellW / 2, topY + cellH / 2 + 1);
  }
}

/** The LIVE lamp: a pill that burns lime when the ball can be buried. */
export function liveLamp(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, w: number, h: number,
  on: boolean,
): void {
  roundPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.textBaseline = 'middle';
  if (on) {
    ctx.save();
    ctx.shadowColor = AERO.lime;
    ctx.shadowBlur = 16;
    ctx.fillStyle = AERO.lime;
    ctx.fill();
    ctx.restore();
    ctx.font = aeroFont(h * 0.58, 900);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0a1a04';
    ctx.fillText('● LIVE', cx, cy + 1);
  } else {
    ctx.fillStyle = BOARD.inset;
    ctx.fill();
    roundPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = BOARD.hairline;
    ctx.stroke();
    ctx.font = aeroFont(h * 0.52, 800);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillText('NOT LIVE', cx, cy + 1);
  }
}

/** Heat bar: an inset slot filling lime → amber → red as the ball cooks. */
export function heatBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  t: number,
): void {
  roundPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = BOARD.inset;
  ctx.fill();
  roundPath(ctx, x, y, w, h, h / 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = BOARD.hairline;
  ctx.stroke();
  const k = Math.min(1, Math.max(0, t));
  if (k <= 0.02) return;
  const color = k < 0.45 ? AERO.lime : k < 0.8 ? AERO.sun : AERO.danger;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  roundPath(ctx, x + 1.5, y + 1.5, Math.max(h - 3, (w - 3) * k), h - 3, (h - 3) / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Accent hex lifted toward white so team colours read on the dark board. */
export function boardAccent(accent: number, lift = 0.35): string {
  const r = Math.round(((accent >> 16) & 0xff) * (1 - lift) + 255 * lift);
  const g = Math.round(((accent >> 8) & 0xff) * (1 - lift) + 255 * lift);
  const b = Math.round((accent & 0xff) * (1 - lift) + 255 * lift);
  return `rgb(${r},${g},${b})`;
}

/**
 * A board-kit push control: an inset dark slot with a glowing accent label —
 * the interactive cousin of liveLamp. `hot` = a controller laser is on the
 * panel (panel-level hover, same contract the old candy pills had).
 */
export function boardButton(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  accent: string,
  hot: boolean,
): void {
  const r = Math.min(16, h / 2);
  roundPath(ctx, x, y, w, h, r);
  ctx.fillStyle = hot ? 'rgba(255,255,255,0.09)' : BOARD.inset;
  ctx.fill();
  if (hot) {
    // The laser wakes the slot: accent rim burning like the panel edge.
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    roundPath(ctx, x, y, w, h, r);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.restore();
  } else {
    roundPath(ctx, x, y, w, h, r);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = BOARD.hairline;
    ctx.stroke();
  }
  ctx.textBaseline = 'middle';
  boardGlow(ctx, label.toUpperCase(), x + w / 2, y + h / 2 + 1, Math.round(h * 0.42), accent, 'center');
}
