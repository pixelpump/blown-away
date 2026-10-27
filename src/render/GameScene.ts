import Phaser from 'phaser';
import { LEAF_ACTIVE, LEAF_CLEARED, LEAF_COLLECTED, NEUTRAL, Sim, TICK_HZ, type InputFrame, type Level } from '../core';
import type { LevelAsset } from './levels';
import { EXIT, SOLID_COLOURS } from './palette';
import { BLOWER_KEY, FENCE_KEY, leafFrame, LEAVES_KEY, loadSprites, makeAnimations, PIXEL_KEY, PLAYER_KEY, SOLID_SPRITES, TARP_KEY, type Facing } from './textures';

const STEP_MS = 1000 / TICK_HZ;
/** Never simulate more than this many ticks per frame (e.g. after a hitch). */
const MAX_STEPS_PER_FRAME = 6;

const CONE_HALF_ANGLE = 0.49; // matches BLOWER_COS_HALF (render only, trig is fine here)
const CONE_LENGTH = 58;
const BOUNCE_HALF_ANGLE = 0.77; // matches BOUNCE_COS_HALF
/** Where the landscaper holds the blower, relative to the sim position (the feet). */
const HANDS_Y = -4;
/** Blower sprite: pivot at the handle, nozzle tip this many px from the pivot. */
const BLOWER_PIVOT_X = 0.3;
const BLOWER_REACH = 14;

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
  private player?: Phaser.GameObjects.Sprite;
  private blower?: Phaser.GameObjects.Image;
  private facing: Facing = 'up';
  private fx?: Phaser.GameObjects.Graphics;
  private streaks: Streak[] = [];
  private streakTimer = 0;

  constructor(private readonly assets: LevelAsset[]) {
    super('game');
  }

  preload(): void {
    for (const a of this.assets) this.load.image(`tiles:${a.level.id}`, a.tilesetUrl);
    loadSprites(this);
  }

  create(): void {
    makeAnimations(this);
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
      for (const t of level.tarps) world.add(this.add.image(t.x, t.y, TARP_KEY).setOrigin(0).setDisplaySize(t.w, t.h));
    }

    for (const s of level.solids) {
      const art = SOLID_SPRITES[s.kind];
      if (art?.draw === 'fit') {
        world.add(this.add.image(s.x, s.y, art.key).setOrigin(0).setDisplaySize(s.w, s.h));
      } else if (art?.draw === 'centre') {
        world.add(this.add.image(s.x + s.w / 2, s.y + s.h / 2, art.key));
      } else if (s.kind === 'fence') {
        // A 6 px vertical strip repeated along the fence; turned for horizontal fences.
        const vertical = s.h >= s.w;
        const fence = this.add.tileSprite(s.x + s.w / 2, s.y + s.h / 2, 6, vertical ? s.h : s.w, FENCE_KEY);
        world.add(vertical ? fence : fence.setAngle(90));
      } else if (level.placeholderSolids) {
        g.fillStyle(SOLID_COLOURS[s.kind] ?? SOLID_COLOURS.solid).fillRect(s.x, s.y, s.w, s.h);
        g.fillStyle(0x000000, 0.25).fillRect(s.x, s.y + s.h - 2, s.w, 2);
      }
    }

    this.leaves = [];
    this.leafRot = new Float32Array(sim.count);
    this.leafAlpha = new Float32Array(sim.count).fill(1);
    this.pileX = new Float32Array(sim.count);
    this.pileY = new Float32Array(sim.count);
    for (let i = 0; i < sim.count; i++) {
      const img = this.add.image(sim.x[i], sim.y[i], LEAVES_KEY, leafFrame(sim.variant[i], sim.wet[i] === 1));
      this.leafRot[i] = (i * 2.399) % (Math.PI * 2);
      img.setRotation(this.leafRot[i]);
      this.leaves.push(img);
      world.add(img);
    }

    this.fx = this.add.graphics();
    world.add(this.fx);
    this.blower = this.add.image(0, 0, BLOWER_KEY).setOrigin(BLOWER_PIVOT_X, 0.5);
    // Feet sit a little below the centre of the 10 px collision body.
    this.player = this.add.sprite(sim.playerX, sim.playerY, PLAYER_KEY).setOrigin(0.5, 1);
    world.add([this.blower, this.player]);

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
    p.setPosition(x, y + 4);

    // Face where the blower points (with a little hysteresis so diagonals don't flicker).
    const ax = sim.aimX;
    const ay = sim.aimY;
    const side = this.facing === 'side' ? Math.abs(ax) > Math.abs(ay) * 0.85 : Math.abs(ax) > Math.abs(ay) * 1.15;
    this.facing = side ? 'side' : ay > 0 ? 'down' : 'up';
    p.setFlipX(this.facing === 'side' && ax < 0);
    p.anims.play(`${sim.playerMoving ? 'walk' : 'idle'}-${this.facing}`, true);

    // Blower: rotates freely with the aim; behind the body when aiming away from the camera.
    const ang = Math.atan2(ay, ax);
    const hx = x;
    const hy = y + HANDS_Y;
    const b = this.blower!;
    b.setPosition(hx, hy).setRotation(ang).setFlipY(ax < 0);
    if (this.facing === 'up') this.world!.moveBelow(b, p);
    else this.world!.moveAbove(b, p);

    // Air cone from the nozzle tip.
    const fx = this.fx!;
    fx.clear();
    const nx = hx + ax * BLOWER_REACH;
    const ny = hy + ay * BLOWER_REACH;
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
