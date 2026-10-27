import Phaser from 'phaser';
import { LEAF_ACTIVE, LEAF_CLEARED, LEAF_COLLECTED, NEUTRAL, Sim, TICK_HZ, type InputFrame, type Level } from '../core';
import type { LevelAsset } from './levels';
import { EXIT, SOLID_COLOURS, TARP, TARP_EDGE } from './palette';
import { leafKey, makeTextures, PIXEL_KEY, PLAYER_KEY } from './textures';

const STEP_MS = 1000 / TICK_HZ;
/** Never simulate more than this many ticks per frame (e.g. after a hitch). */
const MAX_STEPS_PER_FRAME = 6;

const CONE_HALF_ANGLE = 0.49; // matches BLOWER_COS_HALF (render only, trig is fine here)
const CONE_LENGTH = 58;
const BOUNCE_HALF_ANGLE = 0.77; // matches BOUNCE_COS_HALF

interface Streak {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
}

export interface SceneHooks {
  /** Called every rendered frame while a run is active. */
  onFrame?(sim: Sim): void;
  onFinish?(sim: Sim): void;
}

/**
 * Draws a Sim. Owns no game rules: it only steps the sim at a fixed rate
 * and interpolates between ticks for smooth motion on 60/90/120 Hz screens.
 */
export class GameScene extends Phaser.Scene {
  sim?: Sim;
  paused = false;
  readInput: () => InputFrame = () => NEUTRAL;
  hooks: SceneHooks = {};

  private readyResolve!: () => void;
  readonly ready = new Promise<void>((r) => (this.readyResolve = r));

  private acc = 0;
  private reported = false;
  private world?: Phaser.GameObjects.Container;
  private leaves: Phaser.GameObjects.Image[] = [];
  private leafRot = new Float32Array(0);
  private leafAlpha = new Float32Array(0);
  /** Pile target positions for collected leaves (render-only tidy-up). */
  private pileX = new Float32Array(0);
  private pileY = new Float32Array(0);
  private piled = 0;
  private player?: Phaser.GameObjects.Image;
  private fx?: Phaser.GameObjects.Graphics;
  private streaks: Streak[] = [];
  private streakTimer = 0;

  constructor(private readonly assets: LevelAsset[]) {
    super('game');
  }

  preload(): void {
    for (const a of this.assets) this.load.image(`tiles:${a.level.id}`, a.tilesetUrl);
  }

  create(): void {
    makeTextures(this);
    this.readyResolve();
  }

  /** Tear down the previous run and build the scene for a new one. */
  startRun(sim: Sim): void {
    this.world?.destroy(true);
    this.streaks = [];
    this.sim = sim;
    this.acc = 0;
    this.reported = false;
    this.paused = false;
    this.piled = 0;

    const { level } = sim;
    this.scale.setGameSize(level.width, level.height);
    const world = (this.world = this.add.container(0, 0));

    for (const layer of level.tileLayers.filter((l) => !l.overhead)) world.add(this.tileLayer(level, layer.tiles));

    const g = this.add.graphics();
    world.add(g);
    if (sim.options.mode === 'clear') {
      for (const e of level.exits) {
        g.fillStyle(EXIT, 0.18).fillRect(e.x, e.y, e.w, e.h);
        g.fillStyle(EXIT, 0.55);
        for (let x = e.x + 2; x < e.x + e.w; x += 8) g.fillRect(x, e.y + e.h / 2 - 1, 4, 2);
      }
    } else {
      for (const t of level.tarps) {
        g.fillStyle(TARP).fillRect(t.x, t.y, t.w, t.h);
        g.lineStyle(1, TARP_EDGE).strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
        g.fillStyle(0xd0d0d0);
        for (const [cx, cy] of [[t.x + 1, t.y + 1], [t.x + t.w - 2, t.y + 1], [t.x + 1, t.y + t.h - 2], [t.x + t.w - 2, t.y + t.h - 2]]) {
          g.fillRect(cx, cy, 1, 1);
        }
      }
    }

    if (level.placeholderSolids) {
      for (const s of level.solids) {
        const c = SOLID_COLOURS[s.kind] ?? SOLID_COLOURS.solid;
        g.fillStyle(c).fillRect(s.x, s.y, s.w, s.h);
        g.fillStyle(0x000000, 0.25).fillRect(s.x, s.y + s.h - 2, s.w, 2);
        if (s.kind === 'house') {
          g.fillStyle(0x000000, 0.12);
          for (let y = s.y + 4; y < s.y + s.h - 4; y += 6) g.fillRect(s.x, y, s.w, 1);
        }
        if (s.kind === 'car') {
          g.fillStyle(0x9ab8d0).fillRect(s.x + 4, s.y + 10, s.w - 8, 8);
          g.fillStyle(0x9ab8d0).fillRect(s.x + 4, s.y + s.h - 16, s.w - 8, 6);
        }
      }
    }

    this.leaves = [];
    this.leafRot = new Float32Array(sim.count);
    this.leafAlpha = new Float32Array(sim.count).fill(1);
    this.pileX = new Float32Array(sim.count);
    this.pileY = new Float32Array(sim.count);
    for (let i = 0; i < sim.count; i++) {
      const img = this.add.image(sim.x[i], sim.y[i], leafKey(sim.variant[i], sim.wet[i] === 1));
      this.leafRot[i] = (i * 2.399) % (Math.PI * 2);
      img.setRotation(this.leafRot[i]);
      this.leaves.push(img);
      world.add(img);
    }

    this.fx = this.add.graphics();
    world.add(this.fx);
    this.player = this.add.image(sim.playerX, sim.playerY, PLAYER_KEY).setOrigin(0.5, 0.7);
    world.add(this.player);

    for (const layer of level.tileLayers.filter((l) => l.overhead)) world.add(this.tileLayer(level, layer.tiles));

    for (let i = 0; i < 28; i++) {
      const img = this.add.image(-10, -10, PIXEL_KEY).setVisible(false);
      world.add(img);
      this.streaks.push({ img, vx: 0, vy: 0, life: 0 });
    }

    this.draw(0, 0);
  }

  private tileLayer(level: Level, tiles: Int32Array): Phaser.GameObjects.GameObject {
    const data: number[][] = [];
    for (let r = 0; r < level.rows; r++) data.push(Array.from(tiles.subarray(r * level.cols, (r + 1) * level.cols)));
    const map = this.make.tilemap({ data, tileWidth: level.tileSize, tileHeight: level.tileSize });
    const ts = map.addTilesetImage(`tiles:${level.id}`, `tiles:${level.id}`, level.tileSize, level.tileSize)!;
    return map.createLayer(0, ts, 0, 0)!;
  }

  update(_time: number, delta: number): void {
    const sim = this.sim;
    if (!sim) return;
    if (this.paused) return;

    this.acc += Math.min(delta, 250);
    let steps = 0;
    while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      sim.step(sim.finished ? NEUTRAL : this.readInput());
      this.acc -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;

    this.draw(sim.started ? this.acc / STEP_MS : 0, delta / 1000);
    this.hooks.onFrame?.(sim);
    if (sim.finished && !this.reported) {
      this.reported = true;
      this.hooks.onFinish?.(sim);
    }
  }

  private draw(alpha: number, dt: number): void {
    const sim = this.sim!;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    for (let i = 0; i < sim.count; i++) {
      const img = this.leaves[i];
      const st = sim.state[i];
      if (st === LEAF_ACTIVE) {
        const sp = Math.abs(sim.vx[i]) + Math.abs(sim.vy[i]);
        this.leafRot[i] += sp * dt * 0.15 * (i % 2 ? 1 : -1);
        img.setPosition(lerp(sim.px[i], sim.x[i]), lerp(sim.py[i], sim.y[i]));
        img.setRotation(this.leafRot[i]);
      } else if (st === LEAF_CLEARED) {
        // Keep drifting off-screen while fading out.
        if (this.leafAlpha[i] > 0) {
          this.leafAlpha[i] = Math.max(0, this.leafAlpha[i] - dt * 2.5);
          img.x += sim.vx[i] * dt;
          img.y += sim.vy[i] * dt + 20 * dt;
          img.setAlpha(this.leafAlpha[i]);
          if (this.leafAlpha[i] === 0) img.setVisible(false);
        }
      } else if (st === LEAF_COLLECTED) {
        if (this.pileX[i] === 0 && this.pileY[i] === 0) this.assignPileSpot(i);
        img.x += (this.pileX[i] - img.x) * Math.min(1, dt * 6);
        img.y += (this.pileY[i] - img.y) * Math.min(1, dt * 6);
      }
    }

    const p = this.player!;
    const x = lerp(sim.playerPX, sim.playerX);
    const y = lerp(sim.playerPY, sim.playerY);
    p.setPosition(x, y);
    if (sim.aimX !== 0) p.setFlipX(sim.aimX < 0);

    // Air cone + nozzle.
    const fx = this.fx!;
    fx.clear();
    const ang = Math.atan2(sim.aimY, sim.aimX);
    const nx = x + sim.aimX * 7;
    const ny = y + sim.aimY * 7;
    const running = sim.started && !sim.finished;
    fx.fillStyle(0xffffff, running ? 0.09 : 0.05);
    fx.fillTriangle(
      nx,
      ny,
      nx + Math.cos(ang - CONE_HALF_ANGLE) * CONE_LENGTH,
      ny + Math.sin(ang - CONE_HALF_ANGLE) * CONE_LENGTH,
      nx + Math.cos(ang + CONE_HALF_ANGLE) * CONE_LENGTH,
      ny + Math.sin(ang + CONE_HALF_ANGLE) * CONE_LENGTH,
    );
    if (running && sim.bounceRange > 4) {
      const ba = Math.atan2(sim.bounceDY, sim.bounceDX);
      const bx = sim.bounceX;
      const by = sim.bounceY;
      const len = sim.bounceRange;
      fx.fillStyle(0xffffff, 0.06);
      fx.fillTriangle(
        bx,
        by,
        bx + Math.cos(ba - BOUNCE_HALF_ANGLE) * len,
        by + Math.sin(ba - BOUNCE_HALF_ANGLE) * len,
        bx + Math.cos(ba + BOUNCE_HALF_ANGLE) * len,
        by + Math.sin(ba + BOUNCE_HALF_ANGLE) * len,
      );
    }
    fx.lineStyle(3, 0xe86a1a);
    fx.lineBetween(x, y, nx, ny);
    fx.fillStyle(0x2b2b2b).fillRect(nx - 1, ny - 1, 2, 2);

    // Air streaks.
    if (running) {
      this.streakTimer += dt;
      while (this.streakTimer > 0.012) {
        this.streakTimer -= 0.012;
        const s = this.streaks.find((q) => q.life <= 0);
        if (!s) break;
        const a = ang + (Math.random() * 2 - 1) * CONE_HALF_ANGLE * 0.8;
        const v = 180 + Math.random() * 80;
        s.vx = Math.cos(a) * v;
        s.vy = Math.sin(a) * v;
        s.life = 0.22;
        s.img.setPosition(nx, ny).setVisible(true);
      }
    }
    for (const s of this.streaks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.img.x += s.vx * dt;
      s.img.y += s.vy * dt;
      s.img.setAlpha(Math.max(0, s.life / 0.22) * 0.7);
      if (s.life <= 0) s.img.setVisible(false);
    }
  }

  /** Spiral collected leaves into a tidy pile in the middle of the nearest tarp. */
  private assignPileSpot(i: number): void {
    const sim = this.sim!;
    const tarp = sim.level.tarps.reduce((best, t) => {
      const d = (t: { x: number; y: number; w: number; h: number }) =>
        Math.abs(t.x + t.w / 2 - sim.x[i]) + Math.abs(t.y + t.h / 2 - sim.y[i]);
      return d(t) < d(best) ? t : best;
    });
    const k = this.piled++;
    const r = Math.min(Math.sqrt(k) * 1.1, Math.min(tarp.w, tarp.h) / 2 - 3);
    const a = k * 2.399;
    this.pileX[i] = tarp.x + tarp.w / 2 + Math.cos(a) * r;
    this.pileY[i] = tarp.y + tarp.h / 2 + Math.sin(a) * r * 0.8;
  }
}
