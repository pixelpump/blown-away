/**
 * Mowing simulation. Deterministic like Blown Away's: integer positions,
 * fixed 60 Hz ticks, and only the recorded input decides the outcome.
 *
 * Movement is Pac-Man style: the mower drives straight along tile-sized
 * lanes, turns only at tile centres, and stops by itself in front of
 * anything it can't drive into. A swipe sets the direction you *want*;
 * it's applied at the next tile centre where that way is open.
 */
import { InputLog, isNeutral, type EncodedInputs, type InputFrame } from '../core/input';
import { TICK_HZ } from '../core/tuning';
import type { MowLevel } from './level';

/** Sub-pixel units per pixel, so speeds can be fractional while positions stay integers. */
export const SUB = 4;
/** Mower speed in sub-pixel units per tick (6 = 1.5 px/tick = 90 px/s). */
export const SPEED = 6;
/** Grass is tracked in cells this many pixels square, for smooth cutting visuals. */
export const CELL = 4;
/** Time added for mowing over a toy. */
export const TOY_PENALTY_S = 3;

/** Directions, also stored per grass cell as the way it was mowed (for stripes). */
export const DIRS = [
  { dx: 0, dy: 0 }, // 0: none / uncut
  { dx: 0, dy: -1 }, // 1: up
  { dx: 0, dy: 1 }, // 2: down
  { dx: -1, dy: 0 }, // 3: left
  { dx: 1, dy: 0 }, // 4: right
] as const;

function dirOf(dx: number, dy: number): number {
  return DIRS.findIndex((d) => d.dx === dx && d.dy === dy);
}

export interface MowResult {
  finished: boolean;
  ticks: number;
  penaltyTicks: number;
  timeMs: number;
  mowed: number;
  required: number;
}

export class MowSim {
  /** Mower centre in sub-pixel units, now and at the previous tick. */
  x: number;
  y: number;
  px: number;
  py: number;
  /** Current heading (index into DIRS); 0 = stopped. */
  dir = 0;
  /** The way the mower last moved, kept while stopped (for drawing). */
  facing = 1;
  /** Direction requested by the player, waiting for a tile centre. */
  want = 0;

  ticks = 0;
  penaltyTicks = 0;
  started = false;
  finished = false;

  readonly cellCols: number;
  readonly cellRows: number;
  /** Per grass cell: 0 = uncut, else the DIRS index it was mowed in. */
  readonly cut: Uint8Array;
  /** Per cell: 1 if it belongs to a required lawn tile. */
  private readonly requiredCell: Uint8Array;
  /** Per cell: 1 if it's lawn at all (required, or under a toy). */
  private readonly grassCell: Uint8Array;
  readonly requiredCells: number;
  mowedCells = 0;
  /** Cells cut so far, in order. Renderers read new entries each frame. */
  readonly cutLog: number[] = [];

  /** Per toy: still on the lawn? */
  readonly toyAlive: boolean[];
  /** Toy indices hit, in order (for effects). */
  readonly toyHits: number[] = [];
  /** Increments each time the mower stops against something (for a bump effect). */
  bumps = 0;

  private readonly log = new InputLog();
  private readonly tileUnits: number;

  constructor(readonly level: MowLevel) {
    this.tileUnits = level.tileSize * SUB;
    this.x = this.px = level.start.col * this.tileUnits + this.tileUnits / 2;
    this.y = this.py = level.start.row * this.tileUnits + this.tileUnits / 2;
    this.cellCols = level.width / CELL;
    this.cellRows = level.height / CELL;
    this.cut = new Uint8Array(this.cellCols * this.cellRows);
    this.requiredCell = new Uint8Array(this.cut.length);
    this.grassCell = new Uint8Array(this.cut.length);
    const toyTiles = new Set(level.toys.map((t) => t.row * level.cols + t.col));
    const per = level.tileSize / CELL;
    let req = 0;
    for (let cy = 0; cy < this.cellRows; cy++) {
      for (let cx = 0; cx < this.cellCols; cx++) {
        const tile = Math.floor(cy / per) * level.cols + Math.floor(cx / per);
        const i = cy * this.cellCols + cx;
        if (level.lawn[tile]) {
          this.requiredCell[i] = 1;
          req++;
        }
        if (level.lawn[tile] || toyTiles.has(tile)) this.grassCell[i] = 1;
      }
    }
    this.requiredCells = req;
    this.toyAlive = level.toys.map(() => true);
  }

  get inputs(): EncodedInputs {
    return this.log.data;
  }

  get timeMs(): number {
    return Math.round(((this.ticks + this.penaltyTicks) * 1000) / TICK_HZ);
  }

  /** 0..1 */
  get progress(): number {
    return this.mowedCells / this.requiredCells;
  }

  /** Is this cell part of the lawn (required or a toy's tile)? */
  isGrassCell(cell: number): boolean {
    return this.grassCell[cell] === 1;
  }

  result(): MowResult {
    return {
      finished: this.finished,
      ticks: this.ticks,
      penaltyTicks: this.penaltyTicks,
      timeMs: this.timeMs,
      mowed: this.mowedCells,
      required: this.requiredCells,
    };
  }

  /** Tile (col, row) the mower's centre is in. */
  tile(): { col: number; row: number } {
    return { col: Math.floor(this.x / this.tileUnits), row: Math.floor(this.y / this.tileUnits) };
  }

  atCentre(): boolean {
    const h = this.tileUnits / 2;
    return this.x % this.tileUnits === h && this.y % this.tileUnits === h;
  }

  /** Can the mower drive from its current tile one step in direction d? */
  open(d: number): boolean {
    const { col, row } = this.tile();
    const c = col + DIRS[d].dx;
    const r = row + DIRS[d].dy;
    const L = this.level;
    return c >= 0 && r >= 0 && c < L.cols && r < L.rows && !L.blocked[r * L.cols + c];
  }

  step(f: InputFrame): void {
    if (this.finished) return;
    if (!this.started) {
      if (isNeutral(f)) return;
      this.started = true;
    }
    this.log.push(f);
    this.ticks++;
    this.px = this.x;
    this.py = this.y;

    // Strongest stick axis is the requested direction.
    if (f.mx !== 0 || f.my !== 0) {
      this.want = Math.abs(f.mx) >= Math.abs(f.my) ? dirOf(Math.sign(f.mx), 0) : dirOf(0, Math.sign(f.my));
    }

    for (let u = 0; u < SPEED; u++) {
      if (this.want && this.dir && DIRS[this.want].dx === -DIRS[this.dir].dx && DIRS[this.want].dy === -DIRS[this.dir].dy) {
        // Reversing is allowed anywhere.
        this.dir = this.want;
        this.want = 0;
      }
      if (this.atCentre()) {
        if (this.want && this.open(this.want)) {
          this.dir = this.want;
          this.want = 0;
        } else if (this.dir && !this.open(this.dir)) {
          this.dir = 0;
          this.bumps++;
        }
      }
      if (!this.dir) break;
      this.x += DIRS[this.dir].dx;
      this.y += DIRS[this.dir].dy;
      this.facing = this.dir;
    }

    this.mow();
    this.hitToys();
    if (this.mowedCells >= this.requiredCells) this.finished = true;
  }

  /** Cut the grass under the mower deck (one tile wide, centred on the mower). */
  private mow(): void {
    const half = this.tileUnits / 2;
    const unitsPerCell = CELL * SUB;
    const x0 = Math.max(0, Math.floor((this.x - half) / unitsPerCell));
    const y0 = Math.max(0, Math.floor((this.y - half) / unitsPerCell));
    const x1 = Math.min(this.cellCols - 1, Math.floor((this.x + half - 1) / unitsPerCell));
    const y1 = Math.min(this.cellRows - 1, Math.floor((this.y + half - 1) / unitsPerCell));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * this.cellCols + cx;
        if (this.cut[i] || !this.isGrassCell(i)) continue;
        this.cut[i] = this.facing;
        this.cutLog.push(i);
        if (this.requiredCell[i]) this.mowedCells++;
      }
    }
  }

  private hitToys(): void {
    const { col, row } = this.tile();
    this.level.toys.forEach((t, k) => {
      if (this.toyAlive[k] && t.col === col && t.row === row) {
        this.toyAlive[k] = false;
        this.toyHits.push(k);
        this.penaltyTicks += TOY_PENALTY_S * TICK_HZ;
      }
    });
  }
}
