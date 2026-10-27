/**
 * Garden Plot puzzles (the "Queens" format with a green thumb):
 * plant one tree in every row, every column and every garden bed,
 * and no two trees may touch, not even diagonally.
 *
 * Puzzles are generated from a seed, so a date gives everyone the same
 * daily puzzle. Every generated puzzle has exactly one solution and can
 * be solved by step-by-step logic, without guessing.
 */
import { createRng, type Rng } from '../core/rng';

export interface Puzzle {
  size: number;
  /** Garden bed id (0..size-1) per cell, row-major. */
  beds: Uint8Array;
  /** The solution: tree column for each row. */
  solution: Uint8Array;
  /** Hardest deduction needed: 1 easy … 4 hard. */
  level: number;
}

export const EMPTY = 0;
export const MARK = 1;
export const TREE = 2;

// --- generation --------------------------------------------------------------

/** Random tree layout: one per row and column, never touching. */
function placeTrees(size: number, rng: Rng): Uint8Array | null {
  const cols = new Uint8Array(size);
  const used = new Uint8Array(size);
  const go = (r: number): boolean => {
    if (r === size) return true;
    const order = shuffle([...Array(size).keys()], rng);
    for (const c of order) {
      if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) < 2)) continue;
      cols[r] = c;
      used[c] = 1;
      if (go(r + 1)) return true;
      used[c] = 0;
    }
    return false;
  };
  return go(0) ? cols : null;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Grow one bed from each tree until the grid is full, giving organic shapes. */
function growBeds(size: number, trees: Uint8Array, rng: Rng): Uint8Array {
  const n = size * size;
  const beds = new Uint8Array(n).fill(255);
  for (let r = 0; r < size; r++) beds[r * size + trees[r]] = r;
  let left = n - size;
  // Uneven growth rates make some beds big and some small, which makes better puzzles.
  const rate = Array.from({ length: size }, () => 0.3 + rng() * 1.7);
  while (left > 0) {
    const total = rate.reduce((a, b) => a + b, 0);
    let pick = rng() * total;
    let bed = 0;
    while (pick > rate[bed]) pick -= rate[bed++];
    const frontier: number[] = [];
    for (let i = 0; i < n; i++) {
      if (beds[i] !== bed) continue;
      const r = Math.floor(i / size);
      const c = i % size;
      if (r > 0 && beds[i - size] === 255) frontier.push(i - size);
      if (r < size - 1 && beds[i + size] === 255) frontier.push(i + size);
      if (c > 0 && beds[i - 1] === 255) frontier.push(i - 1);
      if (c < size - 1 && beds[i + 1] === 255) frontier.push(i + 1);
    }
    if (frontier.length === 0) {
      rate[bed] = 0; // boxed in
      continue;
    }
    beds[frontier[Math.floor(rng() * frontier.length)]] = bed;
    left--;
  }
  return beds;
}

/** Number of solutions, stopping once `limit` are found. */
export function countSolutions(size: number, beds: Uint8Array, limit = 2): number {
  const usedCol = new Uint8Array(size);
  const usedBed = new Uint8Array(size);
  let found = 0;
  const go = (r: number, prev: number) => {
    if (found >= limit) return;
    if (r === size) {
      found++;
      return;
    }
    for (let c = 0; c < size; c++) {
      const b = beds[r * size + c];
      if (usedCol[c] || usedBed[b] || (r > 0 && Math.abs(prev - c) < 2)) continue;
      usedCol[c] = usedBed[b] = 1;
      go(r + 1, c);
      usedCol[c] = usedBed[b] = 0;
    }
  };
  go(0, -10);
  return found;
}

/** A solution other than `not` (tree column per row), or null if there's none. */
function otherSolution(size: number, beds: Uint8Array, not: Uint8Array): Uint8Array | null {
  const cols = new Uint8Array(size);
  const usedCol = new Uint8Array(size);
  const usedBed = new Uint8Array(size);
  const go = (r: number): boolean => {
    if (r === size) return cols.some((c, i) => c !== not[i]);
    for (let c = 0; c < size; c++) {
      const b = beds[r * size + c];
      if (usedCol[c] || usedBed[b] || (r > 0 && Math.abs(cols[r - 1] - c) < 2)) continue;
      cols[r] = c;
      usedCol[c] = usedBed[b] = 1;
      if (go(r + 1)) return true;
      usedCol[c] = usedBed[b] = 0;
    }
    return false;
  };
  return go(0) ? cols : null;
}

/** Is bed `b` still in one piece if cell `skip` is taken out of it? */
function connectedWithout(size: number, beds: Uint8Array, b: number, skip: number): boolean {
  const cells = [...beds.keys()].filter((i) => beds[i] === b && i !== skip);
  if (cells.length === 0) return false;
  const seen = new Set([cells[0]]);
  const q = [cells[0]];
  while (q.length) {
    const i = q.pop()!;
    const r = Math.floor(i / size);
    const c = i % size;
    for (const j of [r > 0 ? i - size : -1, r < size - 1 ? i + size : -1, c > 0 ? i - 1 : -1, c < size - 1 ? i + 1 : -1]) {
      if (j >= 0 && j !== skip && beds[j] === b && !seen.has(j)) {
        seen.add(j);
        q.push(j);
      }
    }
  }
  return seen.size === cells.length;
}

/**
 * Reshape beds until the intended layout is the only solution: whenever
 * another solution exists, move one of its trees' cells into a neighbouring
 * bed. That breaks the other solution and never touches the intended trees.
 */
function makeUnique(size: number, beds: Uint8Array, trees: Uint8Array, rng: Rng): boolean {
  for (let step = 0; step < 300; step++) {
    const other = otherSolution(size, beds, trees);
    if (!other) return true;
    const moves: [number, number][] = [];
    for (let r = 0; r < size; r++) {
      if (other[r] === trees[r]) continue;
      const x = r * size + other[r];
      const c = other[r];
      for (const j of [r > 0 ? x - size : -1, r < size - 1 ? x + size : -1, c > 0 ? x - 1 : -1, c < size - 1 ? x + 1 : -1]) {
        if (j >= 0 && beds[j] !== beds[x] && connectedWithout(size, beds, beds[x], x)) moves.push([x, beds[j]]);
      }
    }
    if (moves.length === 0) return false;
    const [x, to] = moves[Math.floor(rng() * moves.length)];
    beds[x] = to;
  }
  return false;
}

export interface GenerateOptions {
  size: number;
  /** Hardest deduction a solver may need (1..4). */
  maxLevel: number;
  /** Easiest acceptable puzzle: needs at least this level (1..4). */
  minLevel?: number;
}

export function generate(seed: number, opts: GenerateOptions): Puzzle {
  const rng = createRng(seed);
  const { size, maxLevel, minLevel = 1 } = opts;
  for (let attempt = 0; attempt < 5000; attempt++) {
    const trees = placeTrees(size, rng);
    if (!trees) continue;
    for (let k = 0; k < 4; k++) {
      const beds = growBeds(size, trees, rng);
      if (!makeUnique(size, beds, trees, rng)) continue;
      const { solved, level } = logicSolve(size, beds);
      if (solved && level <= maxLevel && level >= minLevel) return { size, beds, solution: trees, level };
    }
  }
  throw new Error(`Could not generate a ${size}×${size} puzzle (seed ${seed})`);
}

// --- human-style solver --------------------------------------------------------

/**
 * Solves using the deductions people use, from easiest to hardest, and
 * reports the hardest one needed:
 *   1  a row, column or bed with only one open spot gets the tree
 *   2  a bed that fits in one row (or column) rules out the rest of that row;
 *      a spot touching every open spot of a bed can't hold a tree
 *   3  N beds squeezed into N rows (or columns) rule out the rest of those rows
 *   4  "what if": a spot that would leave some row, column or bed with
 *      nowhere to go can't hold a tree
 */
export function logicSolve(size: number, beds: Uint8Array): { solved: boolean; level: number } {
  const n = size * size;
  const open = new Uint8Array(n).fill(1);
  const tree = new Uint8Array(n);
  const units: number[][] = [];
  for (let r = 0; r < size; r++) units.push([...Array(size).keys()].map((c) => r * size + c));
  for (let c = 0; c < size; c++) units.push([...Array(size).keys()].map((r) => r * size + c));
  for (let b = 0; b < size; b++) units.push([...Array(n).keys()].filter((i) => beds[i] === b));
  const rowOf = (i: number) => Math.floor(i / size);
  const colOf = (i: number) => i % size;
  const touching = (a: number, b: number) => a !== b && Math.abs(rowOf(a) - rowOf(b)) <= 1 && Math.abs(colOf(a) - colOf(b)) <= 1;

  const plant = (o: Uint8Array, t: Uint8Array, i: number) => {
    t[i] = 1;
    for (let j = 0; j < n; j++) {
      if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || beds[j] === beds[i] || touching(i, j))) o[j] = 0;
    }
  };
  const unitDone = (t: Uint8Array, u: number[]) => u.some((i) => t[i]);
  const openIn = (o: Uint8Array, t: Uint8Array, u: number[]) => u.filter((i) => o[i] && !t[i]);

  /** Level 1 to a fixed point. Returns false on a contradiction. */
  const singles = (o: Uint8Array, t: Uint8Array): boolean | 'progress' => {
    let progress = false;
    for (let again = true; again; ) {
      again = false;
      for (const u of units) {
        if (unitDone(t, u)) continue;
        const spots = openIn(o, t, u);
        if (spots.length === 0) return false;
        if (spots.length === 1) {
          plant(o, t, spots[0]);
          again = progress = true;
        }
      }
    }
    return progress ? 'progress' : true;
  };

  const eliminate = (cells: number[]) => {
    let changed = false;
    for (const i of cells) {
      if (open[i] && !tree[i]) {
        open[i] = 0;
        changed = true;
      }
    }
    return changed;
  };

  const level2 = (): boolean => {
    const rows = units.slice(0, size);
    const cols = units.slice(size, 2 * size);
    const bedUnits = units.slice(2 * size);
    for (const bed of bedUnits) {
      if (unitDone(tree, bed)) continue;
      const spots = openIn(open, tree, bed);
      const r = new Set(spots.map(rowOf));
      const c = new Set(spots.map(colOf));
      if (r.size === 1 && eliminate(rows[[...r][0]].filter((i) => beds[i] !== beds[spots[0]]))) return true;
      if (c.size === 1 && eliminate(cols[[...c][0]].filter((i) => beds[i] !== beds[spots[0]]))) return true;
    }
    for (const line of [...rows, ...cols]) {
      if (unitDone(tree, line)) continue;
      const spots = openIn(open, tree, line);
      const b = new Set(spots.map((i) => beds[i]));
      if (b.size === 1) {
        const bed = bedUnits[[...b][0]];
        if (eliminate(bed.filter((i) => !line.includes(i)))) return true;
      }
    }
    for (const u of units) {
      if (unitDone(tree, u)) continue;
      const spots = openIn(open, tree, u);
      const hit = [...Array(n).keys()].filter((x) => open[x] && !tree[x] && !u.includes(x) && spots.every((s) => touching(s, x)));
      if (eliminate(hit)) return true;
    }
    return false;
  };

  const level3 = (): boolean => {
    const groups: [number[][], (i: number) => number, number[][]][] = [
      [units.slice(2 * size), rowOf, units.slice(0, size)],
      [units.slice(2 * size), colOf, units.slice(size, 2 * size)],
      [units.slice(0, size), (i) => beds[i], units.slice(2 * size)],
      [units.slice(size, 2 * size), (i) => beds[i], units.slice(2 * size)],
    ];
    for (const [sets, key, targets] of groups) {
      const live = sets.filter((u) => !unitDone(tree, u));
      for (let mask = 1; mask < 1 << live.length; mask++) {
        const k = popcount(mask);
        if (k < 2 || k >= live.length) continue;
        const chosen = live.filter((_, j) => mask & (1 << j));
        const cells = new Set(chosen.flat());
        const keys = new Set(chosen.flatMap((u) => openIn(open, tree, u)).map(key));
        if (keys.size !== k) continue;
        const outside = [...keys].flatMap((x) => targets[x]).filter((i) => !cells.has(i));
        if (eliminate(outside)) return true;
      }
    }
    return false;
  };

  const level4 = (): boolean => {
    for (let i = 0; i < n; i++) {
      if (!open[i] || tree[i]) continue;
      const o = open.slice();
      const t = tree.slice();
      plant(o, t, i);
      if (singles(o, t) === false) {
        open[i] = 0;
        return true;
      }
    }
    return false;
  };

  let level = 1;
  for (let guard = 0; guard < 1000; guard++) {
    const s = singles(open, tree);
    if (s === false) return { solved: false, level };
    if (tree.reduce((a, v) => a + v, 0) === size) return { solved: true, level };
    if (s === 'progress') continue;
    if (level2()) {
      level = Math.max(level, 2);
      continue;
    }
    if (level3()) {
      level = Math.max(level, 3);
      continue;
    }
    if (level4()) {
      level = Math.max(level, 4);
      continue;
    }
    return { solved: false, level };
  }
  return { solved: false, level };
}

function popcount(x: number): number {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

// --- checking a player's board ---------------------------------------------------

export interface BoardCheck {
  trees: number;
  /** Cells with a tree that breaks a rule. */
  conflicts: Set<number>;
  solved: boolean;
}

export function checkBoard(p: Puzzle, board: Uint8Array): BoardCheck {
  const { size, beds } = p;
  const trees: number[] = [];
  board.forEach((v, i) => v === TREE && trees.push(i));
  const conflicts = new Set<number>();
  for (let a = 0; a < trees.length; a++) {
    for (let b = a + 1; b < trees.length; b++) {
      const i = trees[a];
      const j = trees[b];
      const ri = Math.floor(i / size);
      const rj = Math.floor(j / size);
      const ci = i % size;
      const cj = j % size;
      const clash = ri === rj || ci === cj || beds[i] === beds[j] || (Math.abs(ri - rj) <= 1 && Math.abs(ci - cj) <= 1);
      if (clash) {
        conflicts.add(i);
        conflicts.add(j);
      }
    }
  }
  return { trees: trees.length, conflicts, solved: trees.length === size && conflicts.size === 0 };
}

// --- the daily puzzle ------------------------------------------------------------

/** Day 1 of Garden Plot. */
const EPOCH = Date.UTC(2026, 9, 1);

/** Bigger and trickier through the week, like a newspaper crossword. Index = getDay(). */
const WEEK: { size: number; maxLevel: number; minLevel: number }[] = [
  { size: 9, maxLevel: 3, minLevel: 2 }, // Sun
  { size: 7, maxLevel: 2, minLevel: 1 }, // Mon
  { size: 7, maxLevel: 2, minLevel: 2 }, // Tue
  { size: 8, maxLevel: 2, minLevel: 2 }, // Wed
  { size: 8, maxLevel: 3, minLevel: 2 }, // Thu
  { size: 9, maxLevel: 3, minLevel: 2 }, // Fri
  { size: 9, maxLevel: 4, minLevel: 3 }, // Sat
];

export interface Daily {
  /** YYYY-MM-DD in the player's (later: the company's) time zone. */
  key: string;
  number: number;
  weekday: string;
  seed: number;
  options: GenerateOptions;
}

/** Same date → same puzzle for everyone. `salt` can make it per-company. */
export function daily(date: Date, salt = ''): Daily {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const number = Math.round((Date.UTC(y, m, d) - EPOCH) / 86400000) + 1;
  let seed = 2166136261;
  for (const ch of `garden-plot:${salt}:${key}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const w = date.getDay();
  return {
    key,
    number,
    weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][w],
    seed: seed >>> 0,
    options: WEEK[w],
  };
}
