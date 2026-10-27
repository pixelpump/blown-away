# Blown Away

Blow leaves, beat the clock. A mobile-first mini game for Shepherd: crews play it on the ride to the job site, and the best times go up on the Staff Board.

```
npm install
npm run dev        # http://localhost:5173, also on your LAN for phone testing
npm test           # Vitest: simulation, level loading, replays
npm run build      # typecheck + production build in dist/
```

## How it plays

- **Clear It**: blow the leaves out to the street.
- **Pile It**: blow the leaves onto the tarp.
- The clock starts when you first move and stops when 95% of the leaves are done.
- **Controls:** drag anywhere to walk, and the blower points where you walk. Pull straight back to back up while still blowing forward, which is how you get behind leaves. Put a second thumb down to aim on its own. On desktop, WASD walks and the arrow keys aim.
- **Weather:** rain makes some leaves wet (heavier and grippier). Wind adds a steady breeze plus gusts that undo your work.
- **Surfaces:** leaves slide on pavement, catch on grass, and get stuck in mulch beds.
- **Walls:** air bounces off walls and the map edges, and out of corners. Aim at the base of a wall to pop pinned leaves back out.

## Layout

```
src/core/     Pure TypeScript game rules. No browser APIs, fully deterministic.
  sim.ts        the simulation (fixed 60 Hz tick)
  tuning.ts     every number that affects feel
  map.ts        Tiled map loader + validation
  input.ts      quantized input frames + run-length encoded input logs
  replay.ts     re-run a recorded run (for server-side score verification)
  reachability.ts  level lint: finds spots where a leaf could get stuck for good
src/render/   Phaser: draws the sim, interpolates between ticks, procedural blower audio
src/ui/       DOM: touch joysticks, styles
src/embed/    mountGame() + <BlownAway/> React wrapper for Shepherd
levels/       Tiled maps (.tmj) and tilesets (.tsj + .png)
docs/         level design, art spec, Shepherd integration
```

### Why `core` is separate

`core` runs the same in the browser and in Node, and it only uses arithmetic that gives identical results on every JS engine (no `Math.sin` and friends). So:

- tests run the real game logic headlessly, and
- the Shepherd API can **replay a submitted run's inputs** and compute the time itself, so a faked score can't reach the Staff Board.

If you change anything in `tuning.ts`, old runs will replay differently. Treat that as a new season.

## Docs

- [Level design with Tiled](docs/level-design.md)
- [Art spec](docs/art-spec.md)
- [Shepherd integration](docs/shepherd-integration.md)
