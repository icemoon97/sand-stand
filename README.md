# Sand Stand

A browser game about the beach game of standing as close to the waves as you dare.

Stand still on the sand to fill your pot. It fills faster the lower down the beach you are and the longer you
hold still. Step away to bank it; if the water reaches your feet first, the pot is lost and you are soaked for a
couple of seconds.

Three or four sand dollars wash up each round, glinting under a wave. The first player to reach one after the
water has drained off it banks a bonus.

## Run

```bash
npm run dev
```

Then open http://localhost:5173. No dependencies or build step.

- Player 1: `W A S D` · Player 2: arrow keys
- `Space` start / play again · `R` restart round · `M` mute · `` ` `` stats
- `?seed=123` fixes the sea so a round can be replayed exactly

## How it works

- `src/sim.js` – the sea. A 2D shallow-water solver on a 256×184 staggered grid with wetting and drying, so swell
  steepens into bores, runs up the sand and drains back by itself. Deterministic for a given seed (fixed step, no
  platform-dependent maths), which is what will let a room of players share the same waves.
- `src/render.js` – one WebGL2 fragment shader that draws sand, wet sand, water, foam and glitter from the sim fields.
- `src/game.js` – players, scoring and round flow, advanced in fixed 60 Hz ticks from per-player inputs.
- `src/overlay.js`, `src/audio.js`, `src/main.js` – players and score pops, procedural surf sound, wiring and HUD.
- `src/config.js` – every tunable (beach shape, swell, scoring, movement).

## Balance tools

```bash
npm run runup -- 7 180
```

Runs seed 7 headless for 180 simulated seconds and prints how far up the beach each wave reached, plus the cost of
a simulation step. In the browser console, `sandStand.advance(seconds)` fast-forwards the game.
