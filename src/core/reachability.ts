/**
 * Level lint: finds spots where a leaf can get stuck, meaning no spot the
 * player can walk to, with any aim, blows it measurably closer to the goal.
 *
 * If every wall-hugging spot passes, any leaf can be worked to the goal
 * step by step, so the level can always be finished.
 */
import { quantizeStick } from './input';
import type { Level, Mode, Rect } from './map';
import { Sim } from './sim';
import { LEAF_RADIUS, PLAYER_RADIUS } from './tuning';
import { WEATHER_PRESETS } from './weather';

const CELL = 2;
const AIMS = 16;
const TICKS = 50;
/** A leaf "makes progress" if it gets this much closer to the goal (px). */
const PROGRESS = 8;

function blocked(level: Level, x: number, y: number, pad: number): boolean {
  if (x < pad || y < pad || x > level.width - pad || y > level.height - pad) return true;
  return level.solids.some((s) => x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad);
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export interface Grid {
  cols: number;
  rows: number;
  /** Distance in px through open space, Infinity if unreachable. */
  dist: Float64Array;
  at(x: number, y: number): number;
}

function makeGrid(level: Level, pad: number, seeds: (x: number, y: number) => boolean): Grid {
  const cols = Math.ceil(level.width / CELL);
  const rows = Math.ceil(level.height / CELL);
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const open = new Uint8Array(cols * rows);
  const queue: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      const i = r * cols + c;
      open[i] = blocked(level, x, y, pad) ? 0 : 1;
      if (open[i] && seeds(x, y)) {
        dist[i] = 0;
        queue.push(i);
      }
    }
  }
  // Dijkstra-lite: 8-neighbour BFS, good enough on a uniform grid.
  const steps = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr, w] of steps) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      const d = dist[i] + w * CELL;
      if (open[j] && d < dist[j]) {
        dist[j] = d;
        queue.push(j);
      }
    }
  }
  return {
    cols,
    rows,
    dist,
    at(x, y) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
      let d = dist[r * cols + c];
      // A point hugging a wall can fall in a cell whose centre is blocked: use the nearest open neighbour.
      if (!Number.isFinite(d)) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nc = c + dc;
            const nr = r + dr;
            if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) d = Math.min(d, dist[nr * cols + nc] + CELL);
          }
        }
      }
      return d;
    },
  };
}

/** How far a leaf at each point is from the goal, travelling through open space. */
export function goalField(level: Level, mode: Mode): Grid {
  const goals = mode === 'pile' ? level.tarps : level.exits;
  return makeGrid(level, LEAF_RADIUS, (x, y) => goals.some((g) => inside(g, x, y)));
}

/** Where the player can walk to from the start (0 = reachable). */
export function walkField(level: Level): Grid {
  const sx = level.playerStart.x;
  const sy = level.playerStart.y;
  return makeGrid(level, PLAYER_RADIUS, (x, y) => Math.abs(x - sx) <= CELL && Math.abs(y - sy) <= CELL);
}

/**
 * Can the player blow a leaf at (lx, ly) to within `need` px of the goal?
 * With depth 2, a first blow may reposition the leaf (e.g. off the top of a
 * shrub) as long as a second blow then gets it there.
 */
export function canProgress(
  level: Level,
  mode: Mode,
  goal: Grid,
  walk: Grid,
  lx: number,
  ly: number,
  need = goal.at(lx, ly) - PROGRESS,
  depth = 2,
): boolean {
  const start = goal.at(lx, ly);
  if (start === 0) return true;
  if (!Number.isFinite(start)) return false;
  const moved: [number, number, number][] = [];
  const single: Level = {
    ...level,
    // A 4×4 zone spawns its one leaf exactly at the centre.
    leafZones: [{ x: lx - 2, y: ly - 2, w: 4, h: 4, count: 1 }],
  };
  // Candidate standing spots: a fine grid around the leaf, closest first.
  const spots: [number, number, number][] = [];
  for (let dy = -24; dy <= 24; dy += 3) {
    for (let dx = -24; dx <= 24; dx += 3) {
      const d = Math.hypot(dx, dy);
      if (d < 3 || d > 24) continue;
      spots.push([lx + dx, ly + dy, d]);
    }
  }
  spots.sort((a, b) => a[2] - b[2]);
  for (const [sx, sy] of spots) {
    if (!Number.isFinite(walk.at(sx, sy)) || blocked(level, sx, sy, PLAYER_RADIUS)) continue;
    for (let j = 0; j < AIMS; j++) {
      const b = (j / AIMS) * Math.PI * 2;
      const [ax, ay] = quantizeStick(Math.cos(b), Math.sin(b));
      const sim = new Sim(single, { mode, weather: WEATHER_PRESETS.dry, seed: 1 });
      if (sim.count !== 1) return true; // spot is inside a solid
      sim.playerX = sim.playerPX = sx;
      sim.playerY = sim.playerPY = sy;
      for (let t = 0; t < TICKS && !sim.finished; t++) sim.step({ mx: 0, my: 0, ax, ay });
      const end = goal.at(sim.x[0], sim.y[0]);
      if (sim.finished || end <= need) return true;
      if (Math.hypot(sim.x[0] - lx, sim.y[0] - ly) >= 4 && Number.isFinite(end)) moved.push([sim.x[0], sim.y[0], end]);
    }
  }
  if (depth > 1) {
    // Try a few distinct places the first blow can put the leaf, most promising first.
    moved.sort((a, b) => a[2] - b[2]);
    const tried: [number, number][] = [];
    for (const [mx, my] of moved) {
      if (tried.some(([tx, ty]) => Math.hypot(tx - mx, ty - my) < 4)) continue;
      tried.push([mx, my]);
      if (canProgress(level, mode, goal, walk, mx, my, need, depth - 1)) return true;
      if (tried.length >= 10) break;
    }
  }
  return false;
}

/** Sample points hugging every wall, map edge and corner; return the ones a leaf can get stuck at. */
export function findStuckSpots(level: Level, mode: Mode, step = 4): { x: number; y: number }[] {
  const OFF = 2.5; // leaf centre distance from the wall
  const pts: { x: number; y: number }[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i <= n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n });
  };
  const W = level.width;
  const H = level.height;
  edge(OFF, OFF, W - OFF, OFF);
  edge(OFF, H - OFF, W - OFF, H - OFF);
  edge(OFF, OFF, OFF, H - OFF);
  edge(W - OFF, OFF, W - OFF, H - OFF);
  for (const s of level.solids) {
    edge(s.x - OFF, s.y - OFF, s.x + s.w + OFF, s.y - OFF);
    edge(s.x - OFF, s.y + s.h + OFF, s.x + s.w + OFF, s.y + s.h + OFF);
    edge(s.x - OFF, s.y - OFF, s.x - OFF, s.y + s.h + OFF);
    edge(s.x + s.w + OFF, s.y - OFF, s.x + s.w + OFF, s.y + s.h + OFF);
  }
  const goal = goalField(level, mode);
  const walk = walkField(level);
  return pts.filter((p) => !blocked(level, p.x, p.y, LEAF_RADIUS) && !canProgress(level, mode, goal, walk, p.x, p.y));
}
