/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files to ship or load). The synth toolkit (`tone`, `whooshNoise`, `clank`,
 * `servo`) is harvested straight from Iron Balls; the sound set on top is
 * retuned for a sports centre: rubber thwacks, a pea whistle, pentatonic
 * combo bells, an air horn and a crowd that lives in bandpassed noise.
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame loop
 * play fine.
 */

type Ctx = AudioContext & { _master?: GainNode };

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    ctx._master = master;
  }
  return ctx;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

/** Call from a user gesture (e.g. menu click) to make sure audio is live. */
export function ensureAudio(): void {
  unlock();
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

interface ToneOpts {
  freq: number;
  to?: number; // glide target
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ready();
  if (!c) return;
  const { freq, to, type = 'sine', dur = 0.12, gain = 0.2, delay = 0 } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Bandpass-filtered noise burst — the basis of every whoosh and crowd. */
function whooshNoise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (p < 0.12 ? p / 0.12 : 1) * (1 - p) ** 0.8;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(fromHz, t0);
  bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur * 0.6);
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t0);
}

/** Struck metal — kept for the goal frame ping. */
function clank(base: number, gain = 0.2, dur = 0.3, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const ratios = [1, 1.51, 2.27, 3.43, 4.83];
  ratios.forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.015);
    const env = c.createGain();
    const g = gain * (1 / (i + 1));
    const d = dur * (1 - i * 0.12);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.04, d));
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
  whooshNoise(0.03, gain * 0.7, base * 4, base * 2, delay);
}

/**
 * The referee's pea whistle: two close tones beating against each other with
 * a touch of noise breath. `dur` short = a chirp, long = THE decision.
 */
function whistle(dur: number, gain = 0.16, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  for (const f of [2093, 2217]) {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain * 0.5, t0 + 0.01);
    env.gain.setValueAtTime(gain * 0.5, t0 + dur * 0.8);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  whooshNoise(dur, gain * 0.3, 1800, 2600, delay);
}

/** A crowd swell living in shaped noise — murmurs, oohs and roars. */
function crowd(dur: number, gain: number, lowHz: number, highHz: number, delay = 0): void {
  whooshNoise(dur, gain, lowHz, highHz, delay);
  whooshNoise(dur * 0.8, gain * 0.6, lowHz * 1.6, highHz * 0.8, delay + dur * 0.15);
}

// --- Game sounds -----------------------------------------------------------

/**
 * THE SLAP — thick rubber on ball. Body thump + airy smack, pitched up a
 * little as the rally climbs (the ball is smaller and angrier), with a bonus
 * boom when it's a power shot.
 */
export function slap(power: number, combo: number): void {
  const pitch = 1 + Math.min(1, combo / 12) * 0.5;
  tone({ freq: 165 * pitch, to: 62 * pitch, type: 'sine', dur: 0.16, gain: 0.3 });
  whooshNoise(0.12, 0.22, 320 * pitch, (900 + power * 900) * pitch);
  // The rubbery squeak that sells "thick rubber".
  tone({ freq: 820 * pitch, to: 430 * pitch, type: 'sawtooth', dur: 0.05, gain: 0.045 });
  if (power > 0.7) {
    tone({ freq: 95, to: 34, type: 'sine', dur: 0.3, gain: 0.32, delay: 0.01 });
    whooshNoise(0.3, 0.18, 200, 1400, 0.01);
  }
}

/** The combo ladder: one pentatonic bell per completed pass, ever higher. */
export function comboPop(combo: number): void {
  const scale = [392, 440, 523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760];
  const f = scale[Math.min(combo - 1, scale.length - 1)] ?? 392;
  tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.16 });
  tone({ freq: f * 2, type: 'sine', dur: 0.1, gain: 0.06, delay: 0.02 });
}

/** Third player in — the ball is LIVE. A bright two-note "go on then". */
export function liveAlert(): void {
  tone({ freq: 659, type: 'triangle', dur: 0.1, gain: 0.16 });
  tone({ freq: 988, type: 'triangle', dur: 0.16, gain: 0.18, delay: 0.09 });
  crowd(0.5, 0.06, 300, 900, 0.05);
}

/** The rally hits ignition — the furnace catches (Iron Balls' own ignite). */
export function ignite(): void {
  clank(1900, 0.04, 0.05);
  whooshNoise(0.4, 0.16, 140, 850);
  tone({ freq: 70, to: 46, type: 'sine', dur: 0.24, gain: 0.16 });
}

/** HALF VOLLEY! A snare-crack off the floor and a rising zing. */
export function halfVolley(): void {
  whooshNoise(0.06, 0.3, 900, 250);
  tone({ freq: 140, to: 60, type: 'sine', dur: 0.12, gain: 0.3 });
  tone({ freq: 440, to: 1320, type: 'sawtooth', dur: 0.22, gain: 0.07, delay: 0.03 });
  crowd(0.6, 0.08, 350, 1000, 0.06);
}

/** The ball dies on the floor — flat bounce, sad honk, the whistle. */
export function bounceDead(): void {
  tone({ freq: 130, to: 70, type: 'sine', dur: 0.14, gain: 0.24 });
  tone({ freq: 290, to: 120, type: 'sawtooth', dur: 0.3, gain: 0.09, delay: 0.12 });
  whistle(0.35, 0.13, 0.22);
  crowd(0.7, 0.05, 200, 500, 0.15); // the groan
}

/** A shot leaves a hand — sharp air. */
export function shotWhoosh(): void {
  whooshNoise(0.3, 0.2, 380, 1900);
}

/** GOAL — air horn, crowd roar, a little bell run on top. */
export function goalHorn(): void {
  for (const f of [233, 311, 466]) {
    tone({ freq: f, type: 'sawtooth', dur: 0.85, gain: 0.09 });
  }
  whooshNoise(0.9, 0.12, 180, 700);
  crowd(1.6, 0.2, 250, 1400, 0.1);
  [784, 988, 1175, 1568].forEach((f, i) =>
    tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.12, delay: 0.25 + i * 0.09 }),
  );
}

/** SAVED — a deep rubbery thud off the keeper's mitts and a crowd "OOH". */
export function saveThump(): void {
  tone({ freq: 110, to: 40, type: 'sine', dur: 0.26, gain: 0.34 });
  whooshNoise(0.14, 0.2, 260, 90);
  tone({ freq: 620, to: 300, type: 'sawtooth', dur: 0.06, gain: 0.05, delay: 0.01 });
  crowd(0.9, 0.14, 220, 800, 0.08);
}

/** The ball pings off the goal frame. */
export function postPing(): void {
  clank(880, 0.2, 0.5);
  crowd(0.6, 0.07, 250, 700, 0.1);
}

/** Rotation ceremony: whistle chirp + teleport shimmer per swap. */
export function rotateCue(): void {
  whistle(0.16, 0.12);
  whistle(0.16, 0.12, 0.22);
  [523, 659, 784].forEach((f, i) =>
    tone({ freq: f, to: f * 1.4, type: 'sine', dur: 0.18, gain: 0.07, delay: 0.3 + i * 0.08 }),
  );
}

/** Kick-off: one long blast, game on. */
export function kickoffWhistle(): void {
  whistle(0.5, 0.15);
}

/** Serve is up and waiting — a friendly ascending blip. */
export function serveReady(): void {
  tone({ freq: 392, type: 'triangle', dur: 0.09, gain: 0.1 });
  tone({ freq: 523, type: 'triangle', dur: 0.12, gain: 0.12, delay: 0.09 });
}

/** The ball rattling off the chain-link fence — jangling steel diamonds. */
export function chainRattle(): void {
  clank(1500, 0.14, 0.18);
  clank(1130, 0.1, 0.22, 0.03);
  clank(1720, 0.06, 0.12, 0.06);
  whooshNoise(0.12, 0.1, 900, 2600);
  tone({ freq: 240, to: 120, type: 'sine', dur: 0.1, gain: 0.12 });
}

/** Over the fence (or a not-live goal) — whistle, groan, sad trombone-ish slide. */
export function overFence(): void {
  whistle(0.4, 0.14);
  crowd(1.0, 0.12, 250, 1100, 0.15);
  tone({ freq: 392, to: 196, type: 'sawtooth', dur: 0.5, gain: 0.08, delay: 0.3 });
}

/** A TWOT letter lighting up — a stadium-organ stab, one step per letter. */
export function twotLetter(n: number): void {
  const base = [196, 233, 262, 311][Math.max(0, Math.min(3, n - 1))];
  for (const mult of [1, 1.5, 2]) {
    tone({ freq: base * mult, type: 'sawtooth', dur: 0.5, gain: 0.09 });
  }
  tone({ freq: base * 4, type: 'triangle', dur: 0.3, gain: 0.1, delay: 0.05 });
  whooshNoise(0.4, 0.1, 200, 900);
  crowd(0.8, 0.1, 260, 1000, 0.1);
}

/** The word completes — doom klaxon + the crowd smelling blood. */
export function twotComplete(): void {
  for (const d of [0, 0.5]) {
    tone({ freq: 311, type: 'square', dur: 0.32, gain: 0.11, delay: d });
    tone({ freq: 233, type: 'square', dur: 0.34, gain: 0.11, delay: d + 0.28 });
  }
  tone({ freq: 98, to: 45, type: 'sawtooth', dur: 1.2, gain: 0.16, delay: 0.2 });
  crowd(2.0, 0.18, 200, 1200, 0.3);
  whistle(0.6, 0.12, 1.0);
}

/** A ceremony slap landing on the TWOTed keeper — meaty, and funny. */
export function punishSlap(): void {
  tone({ freq: 190, to: 55, type: 'sine', dur: 0.2, gain: 0.36 });
  whooshNoise(0.1, 0.3, 500, 150);
  tone({ freq: 950, to: 380, type: 'sawtooth', dur: 0.07, gain: 0.07 });
  crowd(0.9, 0.16, 300, 1400, 0.1); // the "OOOOH"
  [1175, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, gain: 0.08, delay: 0.12 + i * 0.08 }));
}

/** UI: a bubble popping (this is an aero game now). */
export function uiClick(): void {
  tone({ freq: 620, to: 940, type: 'sine', dur: 0.06, gain: 0.12 });
  whooshNoise(0.03, 0.05, 1200, 2600);
}
