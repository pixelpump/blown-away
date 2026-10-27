// Test helpers (Node only).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { joinPath, type TiledMap, type TiledTileset } from '../core/map';
import { parseMowLevel, type MowLevel } from './level';
import { DIRS, MowSim, SUB } from './sim';

const DIR = fileURLToPath(new URL('../../levels/mow/', import.meta.url));

export function loadMowLevel(id: string): MowLevel {
  const path = `${DIR}${id}.tmj`;
  const map = JSON.parse(readFileSync(path, 'utf8')) as TiledMap;
  return parseMowLevel(id, map, (src) => JSON.parse(readFileSync(joinPath(path, src), 'utf8')) as TiledTileset);
}

/** Input frame that requests direction d (index into DIRS). */
export const press = (d: number) => ({ mx: DIRS[d].dx * 127, my: DIRS[d].dy * 127, ax: 0, ay: 0 });

/**
 * A simple route-planning player: plans from the next tile centre ahead to the
 * nearest unmowed lawn tile (breadth-first search, never over toys), and only
 * turns around at dead ends, like someone mowing in stripes.
 * Not optimal, but a fair stand-in for a decent human.
 */
export function playBot(sim: MowSim, maxTicks = 60 * 300): void {
  const L = sim.level;
  const toy = new Set(L.toys.map((t) => t.row * L.cols + t.col));
  const per = L.tileSize / 4;
  const tileUnits = L.tileSize * SUB;
  const tileDone = (t: number) => {
    const c = t % L.cols;
    const r = (t - c) / L.cols;
    for (let y = 0; y < per; y++)
      for (let x = 0; x < per; x++) if (!sim.cut[(r * per + y) * sim.cellCols + c * per + x]) return false;
    return true;
  };
  const firstStep = (start: number): number => {
    const from = new Map<number, number>([[start, -1]]);
    const q = [start];
    for (let k = 0; k < q.length; k++) {
      const t = q[k];
      if (t !== start && L.lawn[t] && !tileDone(t)) {
        let s = t;
        while (from.get(s) !== start) s = from.get(s)!;
        return DIRS.findIndex((d) => d.dx === (s % L.cols) - (start % L.cols) && d.dy === Math.floor(s / L.cols) - Math.floor(start / L.cols));
      }
      const c = t % L.cols;
      const r = (t - c) / L.cols;
      for (let d = 1; d <= 4; d++) {
        const nc = c + DIRS[d].dx;
        const nr = r + DIRS[d].dy;
        const n = nr * L.cols + nc;
        if (nc < 0 || nr < 0 || nc >= L.cols || nr >= L.rows || L.blocked[n] || toy.has(n) || from.has(n)) continue;
        from.set(n, t);
        q.push(n);
      }
    }
    return 0;
  };
  while (!sim.finished && sim.ticks < maxTicks) {
    // The tile centre the mower reaches next (where a requested turn takes effect).
    let { col, row } = sim.tile();
    if (sim.dir) {
      const d = DIRS[sim.dir];
      const along = d.dx ? sim.x : sim.y;
      // How far past this tile's centre we are, in the direction of travel (-half..half).
      const past = ((along % tileUnits) - tileUnits / 2) * (d.dx || d.dy);
      if (past > 0) {
        col += d.dx;
        row += d.dy;
      }
    }
    const next = firstStep(row * L.cols + col);
    if (next <= 0) {
      // Nothing left beyond the tile ahead: finish driving into it, or give up.
      if (!sim.dir) break;
      sim.step(press(sim.dir));
      continue;
    }
    const reverse = sim.dir && DIRS[next].dx === -DIRS[sim.dir].dx && DIRS[next].dy === -DIRS[sim.dir].dy;
    sim.step(press(reverse ? sim.dir : next));
  }
}
