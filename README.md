# TW⚽T

A WebXR **passthrough** sports game for Meta Quest, built on
[Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) and
harvested from the bones of *Iron Balls Boxing* (the platforms, the fire, the
synth SFX kit and the ECS architecture all live on here).

It's the British playground classic: **one keeper, five attackers** stood on
pedestals arced around a five-a-side goal like a basketball three-point line
— except everyone's wearing **enormous floppy rubber sports hands**, and the
ball starts the size of a beach ball (a proper black-and-white football, just huge). The title sign above the goal spells
**TWOT** with a football for the O. That sign is also the scoreboard of doom.

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
  spin **curves** (Magnus lift is simulated for real). Score before the ball
  is live and **you go in goal**.
- **The fence.** A chain-link fence stands behind the goal, wide and two
  goals high. Bounce the ball off it — the rally stays alive. Put it **over**
  (or wide of it) and **you go in goal**.
- **Self keep-ups.** A soft, mostly-upward slap stays over YOUR head
  (juggle assist damps the sideways drift); smash it and physics takes over.
- **The rotation.** Keeper saves your shot? **You take the gloves.** The old
  keeper teleports to a far platform and everyone between shuffles one
  pedestal toward the centre.

## THE TWOT LAW

Every goal a keeper concedes lights a letter on the board, with a giant pop
everyone can see: **T… TW… TWO… TWOT.** Four letters and the keeper LOSES:

1. They're marched down the line and presented to **each attacker in turn**,
   who gets a couple of seconds to **slap them** with the big floppy hands.
2. Every landed slap moves **AURA**: **+1** to the slapper (golden glow),
   **−1** to the keeper (shameful violet glow). Aura is a persistent stat.
   Aura is forever.
3. The game resets — **with the same keeper still in goal**, on a fresh word.

If YOU get TWOTed, the sports centre drags you down the line itself.

## Stats — both positions, every player

Persistent (localStorage) per player — you *and* the five bots: goals,
shots, saves, **average time as keeper**, passes, half volleys, best combo,
and **aura**. Check the CLUB SHEET panel in the lobby.

## Try it online (GitHub Pages)

Pushed to `main`, the [`Deploy to GitHub Pages`](.github/workflows/deploy.yml)
workflow builds and publishes to
**https://yellkell.github.io/twot/** (enable it once under
*Settings → Pages → Source → GitHub Actions*).

The production build bundles the WebXR emulator, so:

- **On a Quest browser** you get native passthrough AR — Enter AR and the
  goal floats in your room.
- **On a plain desktop browser** the emulator kicks in: Enter XR, then fly
  the hands with WASD + mouse (drag the controller widgets to swing).

## Running it locally

```bash
npm install
npm run dev        # desktop: IWSDK's built-in WebXR emulator (WASD + mouse)
```

In-game, press **A** (or X) to summon the pause panel — resume, or leave
to the lobby.

```bash
npm run build      # typecheck + production build to dist/
npm run preview    # serve the built dist/ exactly as Pages will
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
