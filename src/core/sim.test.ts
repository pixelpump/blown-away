import { describe, expect, it } from 'vitest';
import { iterateInputs, InputLog, NEUTRAL, quantizeStick, type InputFrame } from './input';
import { replay } from './replay';
import { LEAF_ACTIVE, LEAF_CLEARED, LEAF_COLLECTED, Sim, type SimOptions } from './sim';
import { loadLevelFromDisk, makeLevel } from './testing';
import { WEATHER_PRESETS } from './weather';

const dry: SimOptions = { mode: 'clear', weather: WEATHER_PRESETS.dry, seed: 1 };

/** Stand still and aim. */
const aim = (x: number, y: number): InputFrame => {
  const [ax, ay] = quantizeStick(x, y);
  return { mx: 0, my: 0, ax, ay };
};
const walk = (x: number, y: number): InputFrame => {
  const [mx, my] = quantizeStick(x, y);
  return { mx, my, ax: 0, ay: 0 };
};

function stepN(sim: Sim, f: InputFrame, n: number) {
  for (let i = 0; i < n; i++) sim.step(f);
}

/** A 10×6 pavement strip with one leaf zone just right of the player. */
function strip(extra: Partial<Parameters<typeof makeLevel>[0]> = {}) {
  return makeLevel({
    cols: 10,
    rows: 6,
    start: { x: 20, y: 48 },
    leaves: [{ x: 30, y: 44, w: 8, h: 8, count: 10 }],
    goals: [{ type: 'exit', x: 144, y: 0, w: 16, h: 96 }, { type: 'tarp', x: 100, y: 32, w: 30, h: 32 }],
    ...extra,
  });
}

describe('input log', () => {
  it('run-length encodes and round-trips', () => {
    const log = new InputLog();
    const frames = [walk(1, 0), walk(1, 0), walk(1, 0), aim(0, -1), walk(1, 0)];
    frames.forEach((f) => log.push(f));
    expect(log.data.length).toBe(15);
    expect([...iterateInputs(log.data)]).toEqual(frames);
  });

  it('rejects tampered logs', () => {
    expect(() => [...iterateInputs([1, 500, 0, 0, 0])]).toThrow();
    expect(() => [...iterateInputs([0, 1, 0, 0, 0])]).toThrow();
    expect(() => [...iterateInputs([1, 1, 0])]).toThrow();
  });
});

describe('Sim', () => {
  it('does not start the clock until the player moves', () => {
    const sim = new Sim(strip(), dry);
    stepN(sim, NEUTRAL, 100);
    expect(sim.started).toBe(false);
    expect(sim.ticks).toBe(0);
    sim.step(walk(1, 0));
    expect(sim.started).toBe(true);
    expect(sim.ticks).toBe(1);
  });

  it('blows leaves in the aim direction', () => {
    const sim = new Sim(strip(), dry);
    const before = Array.from(sim.x);
    stepN(sim, aim(1, 0), 20);
    for (let i = 0; i < sim.count; i++) expect(sim.x[i]).toBeGreaterThan(before[i]);
  });

  it('does not blow leaves behind the player', () => {
    // Far from any wall, so no air bounces back.
    const sim = new Sim(strip({ start: { x: 90, y: 48 }, leaves: [{ x: 100, y: 44, w: 8, h: 8, count: 10 }] }), dry);
    const before = Array.from(sim.x);
    stepN(sim, aim(-1, 0), 30);
    expect(Array.from(sim.x)).toEqual(before);
  });

  it('stops leaves at walls', () => {
    const level = strip({ solids: [{ type: 'fence', x: 60, y: 0, w: 4, h: 96 }] });
    const sim = new Sim(level, dry);
    stepN(sim, aim(1, 0), 120);
    for (let i = 0; i < sim.count; i++) expect(sim.x[i]).toBeLessThan(60);
  });

  it('air bouncing off a wall frees leaves pinned against it', () => {
    // House wall along the top; leaves squeezed between it and the player.
    const level = makeLevel({
      cols: 10,
      rows: 6,
      modes: 'clear',
      start: { x: 80, y: 30 },
      solids: [{ type: 'house', x: 0, y: 0, w: 160, h: 20 }],
      leaves: [{ x: 50, y: 20, w: 24, h: 7, count: 8 }],
      goals: [{ type: 'exit', x: 0, y: 80, w: 160, h: 16 }],
    });
    const sim = new Sim(level, dry);
    const before = sim.y.reduce((s, v) => s + v, 0);
    stepN(sim, aim(-0.6, -0.8), 40); // aim up-left into the wall
    expect(sim.bounceRange).toBeGreaterThan(0);
    expect(sim.y.reduce((s, v) => s + v, 0)).toBeGreaterThan(before + sim.count * 5);
  });

  it('frees a leaf wedged in a corner', () => {
    const level = makeLevel({
      cols: 10,
      rows: 8,
      modes: 'clear',
      start: { x: 20, y: 30 },
      solids: [
        { type: 'house', x: 0, y: 0, w: 160, h: 16 },
        { type: 'fence', x: 0, y: 0, w: 4, h: 128 },
      ],
      leaves: [{ x: 3.5, y: 15.5, w: 4, h: 4, count: 1 }], // spawns at (5.5, 17.5)
      goals: [{ type: 'exit', x: 0, y: 112, w: 160, h: 16 }],
    });
    const sim = new Sim(level, dry);
    sim.playerX = sim.playerPX = 14;
    sim.playerY = sim.playerPY = 26;
    stepN(sim, aim(-0.6, -0.8), 50); // aim into the corner
    expect(Math.hypot(sim.x[0] - 5.5, sim.y[0] - 17.5)).toBeGreaterThan(10);
  });

  it('treats the map edge as a wall that air bounces off', () => {
    const level = strip({ modes: 'clear', start: { x: 20, y: 10 }, leaves: [{ x: 30, y: 0, w: 8, h: 6, count: 4 }] });
    const sim = new Sim(level, dry);
    stepN(sim, aim(0.5, -0.87), 30); // up-right, into the top edge
    expect(sim.bounceRange).toBeGreaterThan(0);
    expect(Math.min(...sim.y)).toBeGreaterThan(4);
  });

  it('backing up keeps the blower aimed ahead (one thumb)', () => {
    const sim = new Sim(strip(), dry);
    stepN(sim, walk(0, 1), 5); // walk down: blower aims down
    expect(sim.aimY).toBeCloseTo(1);
    stepN(sim, walk(0, -1), 20); // pull straight back
    expect(sim.aimY).toBeCloseTo(1);
    expect(sim.backingUp).toBe(true);
    stepN(sim, walk(1, 0), 5); // sideways turns the blower
    expect(sim.aimX).toBeCloseTo(1);
  });

  it('keeps the player out of solids', () => {
    const level = strip({ solids: [{ type: 'car', x: 40, y: 0, w: 20, h: 96 }], leaves: [{ x: 0, y: 0, w: 16, h: 16, count: 1 }] });
    const sim = new Sim(level, dry);
    stepN(sim, walk(1, 0), 120);
    expect(sim.playerX).toBeLessThanOrEqual(40 - 5 + 1e-9);
  });

  it('mulch grips leaves harder than pavement', () => {
    // Leaves near the end of the air cone get only a weak push.
    const far = { leaves: [{ x: 82, y: 46, w: 8, h: 4, count: 6 }] };
    const moved = (tile: number) => {
      const sim = new Sim(strip({ ...far, ground: new Array(60).fill(tile) }), dry);
      const before = sim.x.reduce((s, v) => s + v, 0);
      stepN(sim, aim(1, 0), 30);
      return sim.x.reduce((s, v) => s + v, 0) - before;
    };
    expect(moved(0)).toBeGreaterThan(1); // pavement
    expect(moved(1)).toBe(0); // mulch
  });

  it('clears leaves that reach an exit, and finishes', () => {
    // Start a little further back so every leaf is inside the air cone.
    const level = strip({ modes: 'clear', start: { x: 10, y: 48 }, goals: [{ type: 'exit', x: 60, y: 0, w: 100, h: 96 }] });
    const sim = new Sim(level, dry);
    for (let i = 0; i < 600 && !sim.finished; i++) sim.step(aim(1, 0));
    expect(sim.finished).toBe(true);
    expect(Array.from(sim.state).filter((s) => s === LEAF_CLEARED).length).toBeGreaterThanOrEqual(sim.target);
  });

  it('collects leaves on the tarp in pile mode', () => {
    const level = strip({ modes: 'pile', goals: [{ type: 'tarp', x: 60, y: 0, w: 40, h: 96 }] });
    const sim = new Sim(level, { ...dry, mode: 'pile' });
    for (let i = 0; i < 600 && !sim.finished; i++) sim.step(aim(1, 0));
    expect(sim.finished).toBe(true);
    expect(Array.from(sim.state).every((s) => s === LEAF_COLLECTED || s === LEAF_ACTIVE)).toBe(true);
  });

  it('wet leaves move slower than dry ones', () => {
    const dist = (wet: number) => {
      const sim = new Sim(strip(), { ...dry, weather: { ...WEATHER_PRESETS.dry, wet } });
      const before = sim.x.reduce((s, v) => s + v, 0);
      stepN(sim, aim(1, 0), 10);
      return sim.x.reduce((s, v) => s + v, 0) - before;
    };
    expect(dist(1)).toBeLessThan(dist(0) * 0.7);
  });
});

describe('determinism', () => {
  const level = loadLevelFromDisk('yard-01');

  /** A wandering input script that exercises walking, aiming and gusts. */
  function script(): InputFrame[] {
    const frames: InputFrame[] = [];
    let t = 0;
    for (let i = 0; i < 1800; i++, t++) {
      const phase = Math.floor(t / 90) % 4;
      const dirs = [[-1, -0.4], [0, -1], [1, 0.3], [0.2, 1]];
      const [mx, my] = quantizeStick(dirs[phase][0], dirs[phase][1]);
      const twoThumb = Math.floor(t / 45) % 3 === 0;
      const [ax, ay] = twoThumb ? quantizeStick(0, 1) : [0, 0];
      frames.push({ mx, my, ax, ay });
    }
    return frames;
  }

  for (const preset of ['dry', 'rain', 'wind'] as const) {
    it(`replays to the identical state (${preset})`, () => {
      const opts: SimOptions = { mode: 'clear', weather: WEATHER_PRESETS[preset], seed: 42 };
      const live = new Sim(level, opts);
      for (const f of script()) {
        live.step(f);
        if (live.finished) break;
      }
      const result = replay(level, opts, live.inputs);
      expect(result).toEqual(live.result());

      const again = new Sim(level, opts);
      for (const f of iterateInputs(live.inputs)) again.step(f);
      expect(Array.from(again.x)).toEqual(Array.from(live.x));
      expect(Array.from(again.y)).toEqual(Array.from(live.y));
    });
  }

  it('same seed → same layout, different seed → different layout', () => {
    const a = new Sim(level, { ...dry, seed: 7 });
    const b = new Sim(level, { ...dry, seed: 7 });
    const c = new Sim(level, { ...dry, seed: 8 });
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.x)).not.toEqual(Array.from(c.x));
    expect(a.count).toBe(300);
  });
});
