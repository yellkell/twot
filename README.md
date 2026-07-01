# KEEP IT UP ⚽🙌

A WebXR **passthrough** sports game for Meta Quest, built on
[Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) and
harvested from the bones of *Iron Balls Boxing* (the platforms, the fire, the
synth SFX kit and the ECS architecture all live on here).

It's the British playground classic: **one keeper, five attackers** stood on
pedestals arced around a five-a-side goal like a basketball three-point line
— except everyone's wearing **enormous floppy rubber sports hands**, and the
ball starts the size of a beach ball.

## The rules

- **Keep it up.** Slap the ball between you — it must not touch the floor.
- **Three touches.** Once three different players have touched it, the ball
  is **LIVE**: anyone can bury it in the goal, or keep rallying.
- **The combo.** Every completed pass builds the combo, shrinks the ball a
  step and pays rally points… rally long enough and it **catches fire**.
- **One bounce and it's dead.** Closest player restarts it. *Unless* someone
  slaps it **the instant it lands** — a **HALF VOLLEY** — which counts, pays
  bonus combo, and feels incredible.
- **Shooting.** Big slap = **power shot**. Swipe across the ball = spin, and
  spin **curves** (Magnus lift is simulated for real).
- **The rotation.** Keeper saves your shot? **You take the gloves.** The old
  keeper teleports to a far platform and everyone between shuffles one
  pedestal toward the centre. The whole sports centre glides around you when
  it's your turn to move.

## Stats — both positions, every player

Persistent (localStorage) per player — you *and* the five bots: goals,
shots, saves, **average time as keeper**, passes, half volleys, best combo.
Check the CLUB SHEET panel in the lobby.

## Running it

```bash
npm install
npm run dev        # desktop: IWSDK's built-in WebXR emulator (WASD + mouse)
```

Open it on a Quest browser for passthrough AR; the goal and pedestals float
in your real room. In-game, **hold both grips ~1 second** to return to the
lobby.

```bash
npm run build      # typecheck + production build to dist/
```

## The tech

- **IWSDK** (`@iwsdk/core` 0.4.2) — ECS world, XR session, input, emulator.
- **Three.js** — all geometry is procedural; every texture is a canvas;
  every sound is synthesised WebAudio. Nothing to download.
- **The hands** (`src/avatar/hands.ts`) — position springs, laggy slerp,
  per-finger flop springs and impact squash: thick rubber, perceived.
- **The fire** (`src/fx/fire.ts`) — the Iron Balls molten-core shader,
  corona and GPU ember/trail pools, now the reward for a long rally.
- **Frutiger aero** (`src/ui/aero.ts`) — glass panels, candy pills, bubbles,
  lime swooshes; sports-centre optimism throughout.
