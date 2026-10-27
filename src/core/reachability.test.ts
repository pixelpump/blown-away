import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canProgress, findStuckSpots, goalField, walkField } from './reachability';
import { loadLevelFromDisk, makeLevel } from './testing';

const ids = readdirSync(new URL('../../levels/', import.meta.url))
  .filter((f) => f.endsWith('.tmj'))
  .map((f) => f.replace(/\.tmj$/, ''));

describe('no leaf can get stuck for good', () => {
  for (const id of ids) {
    const level = loadLevelFromDisk(id);
    for (const mode of level.modes) {
      it(`${id} (${mode})`, () => {
        // Each entry is a wall-hugging spot where no reachable position and aim
        // moves a leaf closer to the goal. Fix the map (widen the gap, remove
        // the nook) rather than loosening this test.
        expect(findStuckSpots(level, mode)).toEqual([]);
      });
    }
  }
});

describe('the lint itself', () => {
  it('flags a dead-end nook the player cannot fit into', () => {
    // A 6px-wide slot in the top wall: leaves can fall in, the player (10px) can't follow.
    const level = makeLevel({
      cols: 8,
      rows: 8,
      modes: 'clear',
      start: { x: 64, y: 80 },
      solids: [
        { type: 'house', x: 0, y: 0, w: 60, h: 40 },
        { type: 'house', x: 66, y: 0, w: 62, h: 40 },
      ],
      leaves: [{ x: 10, y: 60, w: 20, h: 20, count: 1 }],
      goals: [{ type: 'exit', x: 0, y: 112, w: 128, h: 16 }],
    });
    const goal = goalField(level, 'clear');
    const walk = walkField(level);
    expect(canProgress(level, 'clear', goal, walk, 63, 3)).toBe(false);
    expect(canProgress(level, 'clear', goal, walk, 40, 70)).toBe(true);
  });
});
