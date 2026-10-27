/**
 * The deterministic game simulation.
 *
 * Determinism rules (so a server can replay a run and get the same time):
 *   - advance only via step(), one fixed tick at a time
 *   - all randomness comes from seeded Rng instances
 *   - only + - * / and Math.sqrt on numbers (these are exact in IEEE-754);
 *     no Math.sin/cos/atan2/pow/exp, which can differ between JS engines
 */
import { InputLog, isNeutral, type EncodedInputs, type InputFrame } from './input';
import type { Level, Mode, Rect } from './map';
import { createRng, type Rng } from './rng';
import * as T from './tuning';
import type { Weather } from './weather';

export interface SimOptions {
  mode: Mode;
  weather: Weather;
  /** Same seed → same leaf layout and gusts. */
  seed: number;
}

export const LEAF_ACTIVE = 0;
export const LEAF_CLEARED = 1;
export const LEAF_COLLECTED = 2;

export interface RunResult {
  finished: boolean;
  ticks: number;
  timeMs: number;
  done: number;
  total: number;
}

export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / T.TICK_HZ);
}

function inRect(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;
}

export class Sim {
  readonly count: number;
  /** Leaf positions now and at the previous tick (for render interpolation). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly state: Uint8Array;
  readonly wet: Uint8Array;
  /** Cosmetic colour variant, 0..3. */
  readonly variant: Uint8Array;

  playerX: number;
  playerY: number;
  playerPX: number;
  playerPY: number;
  playerMoving = false;
  /** Walking backwards with the blower still aimed ahead (one-thumb play). */
  backingUp = false;
  /** False until the player first moves or aims, so the first move always sets the aim. */
  private aimed = false;
  aimX = 0;
  aimY = -1;

  /** Current total wind acceleration, including any gust. */
  windX = 0;
  windY = 0;
  gust = 0;

  /** The air stream's reflection off a wall, if it hits one (bounceRange > 0). */
  bounceX = 0;
  bounceY = 0;
  bounceDX = 0;
  bounceDY = 0;
  bounceRange = 0;
  private bouncePower = 0;
  /** Scratch output of coneForce(). */
  private fbx = 0;
  private fby = 0;

  ticks = 0;
  started = false;
  finished = false;
  done = 0;
  readonly target: number;

  /** Solids plus the map edges, which block leaves and bounce air like any wall. */
  private readonly walls: Rect[];
  private readonly log = new InputLog();
  private readonly gustRng: Rng;
  private gustWait: number;
  private gustLen = 0;
  private gustT = 0;
  private gustDX = 0;
  private gustDY = 0;

  constructor(
    readonly level: Level,
    readonly options: SimOptions,
  ) {
    const E = 32;
    this.walls = [
      ...level.solids,
      { x: -E, y: -E, w: level.width + 2 * E, h: E },
      { x: -E, y: level.height, w: level.width + 2 * E, h: E },
      { x: -E, y: 0, w: E, h: level.height },
      { x: level.width, y: 0, w: E, h: level.height },
    ];
    this.playerX = this.playerPX = level.playerStart.x;
    this.playerY = this.playerPY = level.playerStart.y;

    const spawnRng = createRng(options.seed);
    const max = level.leafZones.reduce((s, z) => s + z.count, 0);
    const xs = new Float64Array(max);
    const ys = new Float64Array(max);
    const wet = new Uint8Array(max);
    const variant = new Uint8Array(max);
    const goals = [...level.tarps, ...level.exits];
    let n = 0;
    for (const z of level.leafZones) {
      for (let i = 0; i < z.count; i++) {
        for (let attempt = 0; attempt < 24; attempt++) {
          const lx = z.x + 2 + spawnRng() * (z.w - 4);
          const ly = z.y + 2 + spawnRng() * (z.h - 4);
          if (level.solids.some((s) => inRect(s, lx, ly, T.LEAF_RADIUS))) continue;
          if (goals.some((g) => inRect(g, lx, ly, 2))) continue;
          xs[n] = lx;
          ys[n] = ly;
          wet[n] = spawnRng() < options.weather.wet ? 1 : 0;
          variant[n] = Math.floor(spawnRng() * 4);
          n++;
          break;
        }
      }
    }

    this.count = n;
    this.x = xs.slice(0, n);
    this.y = ys.slice(0, n);
    this.px = this.x.slice();
    this.py = this.y.slice();
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.state = new Uint8Array(n);
    this.wet = wet.slice(0, n);
    this.variant = variant.slice(0, n);
    this.target = Math.ceil(n * level.clearThreshold);

    this.gustRng = createRng(options.seed ^ 0x9e3779b9);
    this.gustWait = this.nextGustGap();
  }

  /** The recorded input since the clock started. Submit this with a score. */
  get inputs(): EncodedInputs {
    return this.log.data;
  }

  get timeMs(): number {
    return ticksToMs(this.ticks);
  }

  result(): RunResult {
    return { finished: this.finished, ticks: this.ticks, timeMs: this.timeMs, done: this.done, total: this.count };
  }

  /** Advance one tick. The clock starts on the first non-neutral input. */
  step(f: InputFrame): void {
    if (this.finished) return;
    if (!this.started) {
      if (isNeutral(f)) return;
      this.started = true;
    }
    this.log.push(f);
    this.ticks++;

    this.updatePlayer(f.mx / 127, f.my / 127, f.ax / 127, f.ay / 127);
    this.updateWind();
    this.updateLeaves();

    if (this.done >= this.target) this.finished = true;
  }

  private updatePlayer(mx: number, my: number, ax: number, ay: number): void {
    this.playerPX = this.playerX;
    this.playerPY = this.playerY;

    const mlen = Math.sqrt(mx * mx + my * my);
    if (mlen > 1) {
      mx /= mlen;
      my /= mlen;
    }
    this.playerMoving = mlen > 0.15;

    let x = this.playerX + mx * T.PLAYER_SPEED * T.DT;
    let y = this.playerY + my * T.PLAYER_SPEED * T.DT;
    const r = T.PLAYER_RADIUS;

    for (const s of this.level.solids) {
      // Circle vs rectangle: push out along the shortest direction.
      const cx = x < s.x ? s.x : x > s.x + s.w ? s.x + s.w : x;
      const cy = y < s.y ? s.y : y > s.y + s.h ? s.y + s.h : y;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        y = cy + (dy / d) * r;
      } else {
        // Centre is inside the rectangle: exit via the nearest edge.
        const left = x - s.x;
        const right = s.x + s.w - x;
        const top = y - s.y;
        const bottom = s.y + s.h - y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = s.x - r;
        else if (m === right) x = s.x + s.w + r;
        else if (m === top) y = s.y - r;
        else y = s.y + s.h + r;
      }
    }
    this.playerX = Math.min(Math.max(x, r), this.level.width - r);
    this.playerY = Math.min(Math.max(y, r), this.level.height - r);

    const alen = Math.sqrt(ax * ax + ay * ay);
    if (alen > 0.2) {
      this.aimX = ax / alen;
      this.aimY = ay / alen;
      this.aimed = true;
    } else if (mlen > 0.2) {
      const l = Math.min(mlen, 1); // mx/my were already normalised if mlen > 1
      const dx = mx / l;
      const dy = my / l;
      // Pulling straight back backs up while still blowing forward, so you can
      // get behind leaves without blowing them the wrong way.
      this.backingUp = this.aimed && dx * this.aimX + dy * this.aimY < T.BACK_UP_COS;
      if (!this.backingUp) {
        this.aimX = dx;
        this.aimY = dy;
        this.aimed = true;
      }
    } else {
      this.backingUp = false;
    }
  }

  private nextGustGap(): number {
    const g = this.options.weather.gustiness;
    if (g <= 0) return Infinity;
    const s = T.GUST_MIN_GAP_S + this.gustRng() * (T.GUST_MAX_GAP_S - T.GUST_MIN_GAP_S);
    return Math.round((s / (0.5 + g * 0.5)) * T.TICK_HZ);
  }

  private updateWind(): void {
    const w = this.options.weather;
    if (this.gustLen > 0) {
      this.gustT++;
      // Triangle envelope: ramp up, then down.
      const half = this.gustLen / 2;
      this.gust = this.gustT < half ? this.gustT / half : Math.max(0, (this.gustLen - this.gustT) / half);
      if (this.gustT >= this.gustLen) {
        this.gustLen = 0;
        this.gust = 0;
        this.gustWait = this.nextGustGap();
      }
    } else if (--this.gustWait <= 0) {
      // Random direction without trig: rejection-sample a vector in the unit disc.
      let dx = 0;
      let dy = 0;
      let len = 0;
      do {
        dx = this.gustRng() * 2 - 1;
        dy = this.gustRng() * 2 - 1;
        len = Math.sqrt(dx * dx + dy * dy);
      } while (len < 0.2 || len > 1);
      // Gusts mostly follow the prevailing wind if there is one.
      const bx = w.windX;
      const by = w.windY;
      const blen = Math.sqrt(bx * bx + by * by);
      dx = dx / len + (blen > 0 ? (bx / blen) * 1.5 : 0);
      dy = dy / len + (blen > 0 ? (by / blen) * 1.5 : 0);
      len = Math.sqrt(dx * dx + dy * dy) || 1;
      this.gustDX = dx / len;
      this.gustDY = dy / len;
      const secs = T.GUST_MIN_LEN_S + this.gustRng() * (T.GUST_MAX_LEN_S - T.GUST_MIN_LEN_S);
      this.gustLen = Math.round(secs * T.TICK_HZ);
      this.gustT = 0;
    }
    const g = this.gust * T.GUST_ACCEL * w.gustiness;
    this.windX = w.windX + this.gustDX * g;
    this.windY = w.windY + this.gustDY * g;
  }

  /**
   * Force from a cone of air on a leaf at (lx, ly), written to fbx/fby.
   * `wash`: also catch leaves right at the nozzle in a wider arc.
   */
  private coneForce(lx: number, ly: number, ox: number, oy: number, ax: number, ay: number, range: number, power: number, cosHalf: number, wash: boolean): void {
    this.fbx = 0;
    this.fby = 0;
    const dx = lx - ox;
    const dy = ly - oy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= range * range) return;
    const d = Math.sqrt(d2);
    if (d < 0.5) {
      this.fbx = ax * power;
      this.fby = ay * power;
      return;
    }
    const ux = dx / d;
    const uy = dy / d;
    const along = ux * ax + uy * ay;
    const inCone = along > cosHalf;
    if (!inCone && !(wash && d < T.NEAR_WASH && along > 0.2)) return;
    const centre = inCone ? (along - cosHalf) / (1 - cosHalf) : 0.3;
    const s = power * (1 - d / range) * (0.35 + 0.65 * centre);
    const dirX = ax * (1 - T.BLOWER_SPREAD) + ux * T.BLOWER_SPREAD;
    const dirY = ay * (1 - T.BLOWER_SPREAD) + uy * T.BLOWER_SPREAD;
    const dl = Math.sqrt(dirX * dirX + dirY * dirY);
    this.fbx = (dirX / dl) * s;
    this.fby = (dirY / dl) * s;
  }

  /** Cast the air stream from the nozzle; if it hits a wall, set up a reflected cone. */
  private updateBounce(nx: number, ny: number, ax: number, ay: number): void {
    let best = T.BLOWER_RANGE;
    let hitNX = 0;
    let hitNY = 0;
    for (const s of this.walls) {
      if (inRect(s, nx, ny)) {
        // Nozzle is pressed into the wall: bounce straight off the nearest face.
        const left = nx - s.x;
        const right = s.x + s.w - nx;
        const top = ny - s.y;
        const bottom = s.y + s.h - ny;
        const m = Math.min(left, right, top, bottom);
        best = 0;
        hitNX = m === left ? -1 : m === right ? 1 : 0;
        hitNY = hitNX !== 0 ? 0 : m === top ? -1 : 1;
        break;
      }
      // Ray vs rectangle (slab method).
      let enter = -Infinity;
      let exit = Infinity;
      let enterNX = 0;
      let enterNY = 0;
      if (ax !== 0) {
        const t1 = (s.x - nx) / ax;
        const t2 = (s.x + s.w - nx) / ax;
        const tn = Math.min(t1, t2);
        if (tn > enter) {
          enter = tn;
          enterNX = ax > 0 ? -1 : 1;
          enterNY = 0;
        }
        exit = Math.min(exit, Math.max(t1, t2));
      } else if (nx < s.x || nx > s.x + s.w) continue;
      if (ay !== 0) {
        const t1 = (s.y - ny) / ay;
        const t2 = (s.y + s.h - ny) / ay;
        const tn = Math.min(t1, t2);
        if (tn > enter) {
          enter = tn;
          enterNX = 0;
          enterNY = ay > 0 ? -1 : 1;
        }
        exit = Math.min(exit, Math.max(t1, t2));
      } else if (ny < s.y || ny > s.y + s.h) continue;
      if (enter <= exit && enter >= 0 && enter < best) {
        best = enter;
        hitNX = enterNX;
        hitNY = enterNY;
      }
    }
    if (hitNX === 0 && hitNY === 0) {
      this.bounceRange = 0;
      return;
    }
    const dot = ax * hitNX + ay * hitNY;
    this.bounceDX = ax - 2 * dot * hitNX;
    this.bounceDY = ay - 2 * dot * hitNY;
    this.bounceX = nx + ax * best + hitNX;
    this.bounceY = ny + ay * best + hitNY;
    const left = 1 - best / T.BLOWER_RANGE;
    this.bounceRange = T.BLOWER_RANGE * left * T.BOUNCE_RANGE;
    this.bouncePower = T.BLOWER_POWER * left * T.BOUNCE_POWER;
  }

  private updateLeaves(): void {
    const { level } = this;
    const { x, y, px, py, vx, vy, state, wet } = this;
    const ts = level.tileSize;
    const R = T.LEAF_RADIUS;
    const nx = this.playerX + this.aimX * T.NOZZLE_OFFSET;
    const ny = this.playerY + this.aimY * T.NOZZLE_OFFSET;
    const ax = this.aimX;
    const ay = this.aimY;
    const pileMode = this.options.mode === 'pile';
    this.updateBounce(nx, ny, ax, ay);

    for (let i = 0; i < this.count; i++) {
      px[i] = x[i];
      py[i] = y[i];
      if (state[i] !== LEAF_ACTIVE) continue;

      const mass = wet[i] ? T.WET_MASS : 1;
      let fx = this.windX / mass;
      let fy = this.windY / mass;

      // Blower cone, plus the cone bouncing off whatever wall it hits.
      this.coneForce(x[i], y[i], nx, ny, ax, ay, T.BLOWER_RANGE, T.BLOWER_POWER / mass, T.BLOWER_COS_HALF, true);
      let bx = this.fbx;
      let by = this.fby;
      if (this.bounceRange > 0) {
        this.coneForce(x[i], y[i], this.bounceX, this.bounceY, this.bounceDX, this.bounceDY, this.bounceRange, this.bouncePower / mass, T.BOUNCE_COS_HALF, false);
        bx += this.fbx;
        by += this.fby;
      }
      if (bx !== 0 || by !== 0) {
        // Air that hits a wall bounces off it, so aiming at the base of a
        // wall pops leaves back out instead of pinning them there. In a
        // corner it bounces off both walls. Air also gets under leaves lying
        // against a wall and peels them off it, so they don't slide along
        // walls into dead ends.
        const near = R + T.WALL_DEFLECT_DIST;
        const push = Math.sqrt(bx * bx + by * by);
        for (const s of this.walls) {
          if (!inRect(s, x[i], y[i], near)) continue;
          const left = x[i] - (s.x - near);
          const right = s.x + s.w + near - x[i];
          const top = y[i] - (s.y - near);
          const bottom = s.y + s.h + near - y[i];
          const m = Math.min(left, right, top, bottom);
          const nX = m === left ? -1 : m === right ? 1 : 0;
          const nY = nX !== 0 ? 0 : m === top ? -1 : 1;
          const into = bx * nX + by * nY;
          if (into < 0) {
            bx -= 2 * into * nX * T.WALL_DEFLECT;
            by -= 2 * into * nY * T.WALL_DEFLECT;
          }
          bx += nX * push * T.WALL_LIFT;
          by += nY * push * T.WALL_LIFT;
        }
        fx += bx;
        fy += by;
      }

      const col = Math.min(level.cols - 1, Math.max(0, Math.floor(x[i] / ts)));
      const row = Math.min(level.rows - 1, Math.max(0, Math.floor(y[i] / ts)));
      const surf = T.SURFACE_TUNING[level.surface[row * level.cols + col]];
      const grip = surf.grip * (wet[i] ? T.WET_GRIP : 1);
      const f2 = fx * fx + fy * fy;
      let speed2 = vx[i] * vx[i] + vy[i] * vy[i];

      // Static friction: a resting leaf ignores weak pushes.
      if (speed2 < T.LEAF_REST_SPEED * T.LEAF_REST_SPEED && f2 < grip * grip) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }

      let nvx = vx[i] + fx * T.DT;
      let nvy = vy[i] + fy * T.DT;
      const keep = Math.max(0, 1 - surf.drag * T.DT);
      nvx *= keep;
      nvy *= keep;
      speed2 = nvx * nvx + nvy * nvy;
      if (speed2 > T.LEAF_MAX_SPEED * T.LEAF_MAX_SPEED) {
        const k = T.LEAF_MAX_SPEED / Math.sqrt(speed2);
        nvx *= k;
        nvy *= k;
      }

      let lx = x[i] + nvx * T.DT;
      let ly = y[i] + nvy * T.DT;

      for (const s of this.walls) {
        if (!inRect(s, lx, ly, R)) continue;
        const left = lx - (s.x - R);
        const right = s.x + s.w + R - lx;
        const top = ly - (s.y - R);
        const bottom = s.y + s.h + R - ly;
        const m = Math.min(left, right, top, bottom);
        if (m === left || m === right) {
          lx = m === left ? s.x - R : s.x + s.w + R;
          nvx = -nvx * T.LEAF_BOUNCE;
          nvy *= 0.8;
        } else {
          ly = m === top ? s.y - R : s.y + s.h + R;
          nvy = -nvy * T.LEAF_BOUNCE;
          nvx *= 0.8;
        }
      }
      // Safety net; the edge walls normally handle this.
      if (lx < R || lx > level.width - R) {
        lx = lx < R ? R : level.width - R;
        nvx = -nvx * T.LEAF_BOUNCE;
      }
      if (ly < R || ly > level.height - R) {
        ly = ly < R ? R : level.height - R;
        nvy = -nvy * T.LEAF_BOUNCE;
      }

      x[i] = lx;
      y[i] = ly;
      vx[i] = nvx;
      vy[i] = nvy;

      const goals = pileMode ? level.tarps : level.exits;
      for (const g of goals) {
        if (inRect(g, lx, ly)) {
          state[i] = pileMode ? LEAF_COLLECTED : LEAF_CLEARED;
          this.done++;
          break;
        }
      }
    }
  }
}
