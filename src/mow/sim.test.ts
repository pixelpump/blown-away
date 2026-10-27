import { describe, expect, it } from 'vitest';
import { iterateInputs, NEUTRAL } from '../core/input';
import type { TiledTileset } from '../core/map';
import { makeMap } from '../core/testing';
import { parseMowLevel } from './level';
import { CELL, DIRS, MowSim, SPEED, SUB, TOY_PENALTY_S } from './sim';
import { loadMowLevel, playBot, press } from './testing';

const UP = 1;
const LEFT = 3;
const RIGHT = 4;

const TILESET: TiledTileset = {
  name: 't',
  tilewidth: 16,
  tileheight: 16,
  tilecount: 3,
  columns: 3,
  image: 't.png',
  tiles: [
    { id: 0, properties: [{ name: 'surface', type: 'string', value: 'grass' }] },
    { id: 1, properties: [{ name: 'surface', type: 'string', value: 'pavement' }] },
    { id: 2, properties: [{ name: 'surface', type: 'string', value: 'mulch' }] },
  ],
};

/** A small lawn: 6×4 grass with a pavement row at the bottom (start there). */
function lawn(opts: { ground?: number[]; toys?: { x: number; y: number }[]; solids?: { x: number; y: number; w: number; h: number }[] } = {}) {
  const ground = opts.ground ?? [...new Array(18).fill(0), ...new Array(6).fill(1)];
  const map = makeMap({ cols: 6, rows: 4, ground, start: { x: 8, y: 56 }, solids: opts.solids, modes: 'clear' });
  map.layers.push({ type: 'objectgroup', name: 'toys', objects: (opts.toys ?? []).map((t, i) => ({ id: 100 + i, type: 'ball', x: t.x, y: t.y, point: true })) });
  return parseMowLevel('t', map, () => TILESET);
}

const ticksPerTile = (16 * SUB) / SPEED;

describe('mowing level', () => {
  it('lawn-01 loads with lawn, blocked tiles and toys', () => {
    const L = loadMowLevel('lawn-01');
    expect(L.required).toBeGreaterThan(60);
    expect(L.toys.length).toBe(3);
    const at = (c: number, r: number) => r * L.cols + c;
    expect(L.blocked[at(3, 6)]).toBe(1); // flower bed
    expect(L.blocked[at(9, 9)]).toBe(1); // under the truck
    expect(L.lawn[at(3, 12)]).toBe(1);
    expect(L.lawn[at(L.toys[0].col, L.toys[0].row)]).toBe(0); // toys are optional
  });

  it('every lawn tile on every mowing level can be reached', async () => {
    const { readdirSync } = await import('node:fs');
    const ids = readdirSync(new URL('../../levels/mow/', import.meta.url)).filter((f) => f.endsWith('.tmj'));
    for (const f of ids) {
      const L = loadMowLevel(f.replace(/\.tmj$/, ''));
      const seen = new Uint8Array(L.cols * L.rows);
      const q = [L.start.row * L.cols + L.start.col];
      seen[q[0]] = 1;
      for (let k = 0; k < q.length; k++) {
        const c = q[k] % L.cols;
        const r = (q[k] - c) / L.cols;
        for (let d = 1; d <= 4; d++) {
          const nc = c + DIRS[d].dx;
          const nr = r + DIRS[d].dy;
          const n = nr * L.cols + nc;
          if (nc >= 0 && nr >= 0 && nc < L.cols && nr < L.rows && !L.blocked[n] && !seen[n]) {
            seen[n] = 1;
            q.push(n);
          }
        }
      }
      const unreachable = [...L.lawn.keys()].filter((i) => L.lawn[i] && !seen[i]);
      expect(unreachable, `${f}: unreachable lawn tiles`).toEqual([]);
    }
  });
});

describe('MowSim', () => {
  it('waits for the first swipe before starting the clock', () => {
    const sim = new MowSim(lawn());
    for (let i = 0; i < 30; i++) sim.step(NEUTRAL);
    expect(sim.started).toBe(false);
    sim.step(press(RIGHT));
    expect(sim.started).toBe(true);
  });

  it('drives straight until it reaches something it cannot enter, then stops', () => {
    const sim = new MowSim(lawn());
    sim.step(press(RIGHT));
    for (let i = 0; i < 200; i++) sim.step(NEUTRAL);
    expect(sim.dir).toBe(0);
    expect(sim.tile()).toEqual({ col: 5, row: 3 });
    expect(sim.bumps).toBe(1);
  });

  it('a turn requested between tiles waits for the next tile centre', () => {
    const sim = new MowSim(lawn());
    sim.step(press(RIGHT));
    for (let i = 0; i < 4; i++) sim.step(NEUTRAL); // part-way into the next tile
    sim.step(press(UP));
    expect(sim.dir).toBe(RIGHT);
    for (let i = 0; i < ticksPerTile; i++) sim.step(NEUTRAL);
    expect(sim.dir).toBe(UP);
    expect(sim.x % (16 * SUB)).toBe(8 * SUB); // exactly on the lane
  });

  it('a turn into a blocked way is kept until an opening comes up', () => {
    // Row 2 is a flower bed except column 4: turning up early waits for that gap.
    const ground = [...new Array(12).fill(0), 2, 2, 2, 2, 0, 2, ...new Array(6).fill(1)];
    const sim = new MowSim(lawn({ ground }));
    sim.step(press(RIGHT));
    sim.step(press(UP));
    for (let i = 0; i < ticksPerTile * 6; i++) sim.step(NEUTRAL);
    expect(sim.tile().col).toBe(4);
    expect(sim.tile().row).toBeLessThan(3);
  });

  it('reverses immediately', () => {
    const sim = new MowSim(lawn());
    sim.step(press(RIGHT));
    for (let i = 0; i < 4; i++) sim.step(NEUTRAL);
    sim.step(press(LEFT));
    expect(sim.dir).toBe(LEFT);
  });

  it('mows the lane it drives along, recording the direction for stripes', () => {
    const sim = new MowSim(lawn());
    sim.step(press(UP));
    for (let i = 0; i < 200; i++) sim.step(NEUTRAL);
    const per = 16 / CELL;
    const cols = sim.cellCols;
    for (let cy = 0; cy < 3 * per; cy++) for (let cx = 0; cx < per; cx++) expect(sim.cut[cy * cols + cx]).toBe(UP);
    expect(sim.cut[0 * cols + per]).toBe(0); // next lane untouched
    expect(sim.mowedCells).toBe(3 * per * per);
  });

  it('mowing over a toy costs time', () => {
    const sim = new MowSim(lawn({ toys: [{ x: 8, y: 24 }] }));
    sim.step(press(UP));
    for (let i = 0; i < 200; i++) sim.step(NEUTRAL);
    expect(sim.toyHits).toEqual([0]);
    expect(sim.penaltyTicks).toBe(TOY_PENALTY_S * 60);
  });

  it('finishes when every lawn tile is mowed', () => {
    const sim = new MowSim(lawn());
    playBot(sim);
    expect(sim.finished).toBe(true);
    expect(sim.mowedCells).toBe(sim.requiredCells);
  });

  it('replays identically from the recorded input', () => {
    const L = loadMowLevel('lawn-01');
    const live = new MowSim(L);
    playBot(live);
    const again = new MowSim(L);
    for (const f of iterateInputs(live.inputs)) again.step(f);
    expect(again.result()).toEqual(live.result());
    expect(again.finished).toBe(true);
  });
});
