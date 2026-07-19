/**
 * The shared 2D-canvas drawing kit for KEEP IT UP's frutiger-aero sports
 * centre look: swimming-pool blues, lime energy stripes, glass everywhere —
 * every panel is a glossy translucent pane with a light source living in its
 * top edge, round corners, floating bubbles. Optimism-core.
 *
 * Used by the lobby menu, the goal-mounted scoreboard and the title banner
 * so the whole game speaks one visual language (the same job industrial.ts
 * did for Iron Balls).
 */

export const AERO = {
  // Near-opaque: text has to survive a sunlit room behind it (passthrough)
  // and the bright pavilion alike. The gloss lens keeps the aero look.
  glassTop: 'rgba(255,255,255,0.94)',
  glassBottom: 'rgba(188,223,247,0.92)',
  glassDeep: 'rgba(11,72,120,0.42)', // behind headline text
  stroke: 'rgba(255,255,255,0.85)',
  strokeSoft: 'rgba(255,255,255,0.35)',
  aqua: '#29b6f6',
  aquaDeep: '#0b62a8',
  sky: '#7ec9f5',
  lime: '#9be82a',
  limeDeep: '#5aa511',
  sun: '#ffb226',
  bubblegum: '#ff7ac8',
  violet: '#9a7bff',
  white: '#f7fbff',
  text: '#083a5e',
  textBright: '#ffffff',
  textDim: 'rgba(8,58,94,0.62)',
  danger: '#ff5252',
  ember: '#ff7a18',
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

interface GlassOpts {
  radius?: number;
  /** Base tint gradient stops (top, bottom). */
  top?: string;
  bottom?: string;
  stroke?: string;
  /** Draw the glossy highlight lens across the top half. */
  gloss?: boolean;
  /** Sprinkle decorative rising bubbles. */
  bubbles?: number;
}

/** A pane of aero glass: tinted gradient, crisp light rim, glossy lens. */
export function glassPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  opts: GlassOpts = {},
): void {
  const {
    radius = 26,
    top = AERO.glassTop,
    bottom = AERO.glassBottom,
    stroke = AERO.stroke,
    gloss = true,
    bubbles = 0,
  } = opts;

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  roundPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = g;
  ctx.fill();

  if (bubbles > 0) {
    ctx.save();
    roundPath(ctx, x, y, w, h, radius);
    ctx.clip();
    for (let i = 0; i < bubbles; i++) {
      // Deterministic scatter so redraws don't shimmer.
      const fx = ((i * 97.3) % 100) / 100;
      const fy = ((i * 61.7 + 23) % 100) / 100;
      const r = 4 + ((i * 37) % 14);
      ctx.beginPath();
      ctx.arc(x + fx * w, y + h * (0.45 + fy * 0.55), r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + fx * w - r * 0.3, y + h * (0.45 + fy * 0.55) - r * 0.3, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
    ctx.restore();
  }

  if (gloss) {
    ctx.save();
    roundPath(ctx, x, y, w, h, radius);
    ctx.clip();
    const lens = ctx.createLinearGradient(0, y, 0, y + h * 0.52);
    lens.addColorStop(0, 'rgba(255,255,255,0.55)');
    lens.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = lens;
    // A wide ellipse cresting out of the panel top — the aero lens.
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.02, w * 0.62, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  roundPath(ctx, x, y, w, h, radius);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** A glossy candy pill button. */
export function pillButton(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  accent: string,
  hot: boolean,
): void {
  const r = h / 2;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (hot) {
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, accent);
    g.addColorStop(1, accent);
  } else {
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, accent);
  }
  roundPath(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  // Candy top-light.
  ctx.save();
  roundPath(ctx, x, y, w, h, r);
  ctx.clip();
  const lens = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  lens.addColorStop(0, 'rgba(255,255,255,0.75)');
  lens.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = lens;
  ctx.fillRect(x + 3, y + 2, w - 6, h * 0.55);
  ctx.restore();
  roundPath(ctx, x, y, w, h, r);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = hot ? '#ffffff' : AERO.strokeSoft;
  ctx.stroke();

  ctx.font = aeroFont(Math.round(h * 0.44));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Soft drop shadow keeps text readable over passthrough.
  ctx.fillStyle = 'rgba(8,40,66,0.5)';
  ctx.fillText(label.toUpperCase(), x + w / 2, y + h / 2 + 3);
  ctx.fillStyle = AERO.textBright;
  ctx.fillText(label.toUpperCase(), x + w / 2, y + h / 2 + 1);
}

/** Big glossy headline: accent top fading to deep ink — reads on the
 * (now near-opaque) glass panes instead of washing out white-on-white. */
export function headline(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number, cy: number, px: number,
  color = AERO.aqua,
): void {
  ctx.font = aeroFont(px, 900);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,50,84,0.45)';
  ctx.fillText(text, cx, cy + px * 0.05);
  const g = ctx.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, AERO.text);
  ctx.fillStyle = g;
  ctx.fillText(text, cx, cy);
}

/** A lime energy swoosh — the aero go-faster stripe. */
export function swoosh(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color = AERO.lime,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.quadraticCurveTo(x + w * 0.3, y - h * 0.6, x + w, y + h * 0.25);
  ctx.quadraticCurveTo(x + w * 0.4, y + h * 0.15, x, y + h);
  ctx.closePath();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.restore();
}
