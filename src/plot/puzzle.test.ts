import { describe, expect, it } from 'vitest';
import { checkBoard, countSolutions, daily, EMPTY, generate, logicSolve, TREE, type Puzzle } from './puzzle';

function solutionBoard(p: Puzzle): Uint8Array {
  const b = new Uint8Array(p.size * p.size);
  p.solution.forEach((c, r) => (b[r * p.size + c] = TREE));
  return b;
}

function bedsConnected(p: Puzzle): boolean {
  const { size, beds } = p;
  for (let bed = 0; bed < size; bed++) {
    const cells = [...beds.keys()].filter((i) => beds[i] === bed);
    const seen = new Set([cells[0]]);
    const q = [cells[0]];
    while (q.length) {
      const i = q.pop()!;
      for (const j of [i - size, i + size, i % size ? i - 1 : -1, (i + 1) % size ? i + 1 : -1]) {
        if (j >= 0 && j < beds.length && beds[j] === bed && !seen.has(j)) {
          seen.add(j);
          q.push(j);
        }
      }
    }
    if (seen.size !== cells.length) return false;
  }
  return true;
}

describe('daily puzzle', () => {
  it('is the same for everyone on the same day', () => {
    const a = daily(new Date(2026, 9, 27, 7, 0));
    const b = daily(new Date(2026, 9, 27, 22, 30));
    expect(a).toEqual(b);
    expect(a.key).toBe('2026-10-27');
    expect(a.number).toBe(27);
    expect(generate(a.seed, a.options).beds).toEqual(generate(b.seed, b.options).beds);
  });

  it('changes every day, and per company when salted', () => {
    expect(daily(new Date(2026, 9, 27)).seed).not.toBe(daily(new Date(2026, 9, 28)).seed);
    expect(daily(new Date(2026, 9, 27), 'bishop').seed).not.toBe(daily(new Date(2026, 9, 27), 'other').seed);
  });

  it('gets bigger through the week', () => {
    expect(daily(new Date(2026, 9, 26)).options.size).toBe(7); // Monday
    expect(daily(new Date(2026, 9, 30)).options.size).toBe(9); // Friday
  });

  it('every puzzle for the next 90 days is fair', () => {
    for (let k = 0; k < 90; k++) {
      const info = daily(new Date(2026, 9, 27 + k));
      const t = performance.now();
      const p = generate(info.seed, info.options);
      expect(performance.now() - t, `${info.key} generation time`).toBeLessThan(1500);
      expect(p.size).toBe(info.options.size);
      expect(countSolutions(p.size, p.beds), `${info.key} unique`).toBe(1);
      expect(checkBoard(p, solutionBoard(p)).solved, `${info.key} solution valid`).toBe(true);
      expect(logicSolve(p.size, p.beds).solved, `${info.key} solvable without guessing`).toBe(true);
      expect(p.level).toBeLessThanOrEqual(info.options.maxLevel);
      expect(bedsConnected(p), `${info.key} beds in one piece`).toBe(true);
    }
  }, 120000);
});

describe('checkBoard', () => {
  const p = generate(1, { size: 7, maxLevel: 2 });

  it('accepts the solution', () => {
    expect(checkBoard(p, solutionBoard(p))).toMatchObject({ trees: 7, solved: true });
  });

  it('flags trees that touch diagonally', () => {
    const b = new Uint8Array(49).fill(EMPTY);
    b[0] = TREE;
    b[8] = TREE; // one down, one right
    expect([...checkBoard(p, b).conflicts].sort()).toEqual([0, 8]);
  });

  it('flags two trees in the same row or the same bed', () => {
    const b = new Uint8Array(49);
    b[0] = TREE;
    b[6] = TREE; // same row, far apart
    expect(checkBoard(p, b).conflicts.size).toBe(2);
    const bed = p.beds[24];
    const same = [...p.beds.keys()].filter((i) => p.beds[i] === bed && i !== 24);
    const far = same.find((i) => Math.abs(Math.floor(i / 7) - 3) > 1 && Math.abs((i % 7) - 3) > 1 && Math.floor(i / 7) !== 3 && i % 7 !== 3);
    if (far !== undefined) {
      const c = new Uint8Array(49);
      c[24] = TREE;
      c[far] = TREE;
      expect(checkBoard(p, c).conflicts.size).toBe(2);
    }
  });

  it('a full board with a rule broken is not solved', () => {
    const b = solutionBoard(p);
    const r0 = p.solution[0];
    b[r0] = EMPTY;
    b[(r0 + 3) % 7] = TREE;
    expect(checkBoard(p, b).solved).toBe(false);
  });
});
