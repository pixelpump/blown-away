import Phaser from 'phaser';
import { NEUTRAL, type InputFrame } from '../core/input';
import type { TileLayer } from '../core/map';
import { TICK_HZ } from '../core/tuning';
import { FENCE_KEY, loadSprites, makeAnimations, PIXEL_KEY, PLAYER_KEY, SOLID_SPRITES } from '../render/textures';
import type { MowLevel } from './level';
import type { MowLevelAsset } from './levels';
import { CELL, DIRS, MowSim, SUB } from './sim';
import { makeMowTextures, MOWER_KEY, toyKey } from './textures';

const STEP_MS = 1000 / TICK_HZ;
const MAX_STEPS_PER_FRAME = 6;
const GRASS_KEY = 'grass';

/** Tall grass: base colour plus lighter tufts and darker shadows. */
const TALL = ['#3f6d27', '#4b7f2d', '#5c9436', '#335a20'];
/** Mown grass by direction (index into DIRS). Opposite directions differ in shade: that's the stripe. */
const STRIPE = ['', '#8cc457', '#679f3c', '#71aa44', '#82bb4f'];

/** Deterministic per-cell noise for the grass texture (render only). */
function hash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

interface Bit {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
}

export interface MowHooks {
  onFrame?(sim: MowSim): void;
  onToy?(sim: MowSim): void;
  onFinish?(sim: MowSim): void;
}

export class MowScene extends Phaser.Scene {
  sim?: MowSim;
  paused = false;
  readInput: () => InputFrame = () => NEUTRAL;
  hooks: MowHooks = {};

  private readyResolve!: () => void;
  readonly ready = new Promise<void>((r) => (this.readyResolve = r));

  private acc = 0;
  private reported = false;
  private world?: Phaser.GameObjects.Container;
  private grass?: Phaser.Textures.CanvasTexture;
  private drawnCuts = 0;
  private toys: Phaser.GameObjects.Image[] = [];
  private toyHitsSeen = 0;
  private bumpsSeen = 0;
  private mower?: Phaser.GameObjects.Image;
  private player?: Phaser.GameObjects.Sprite;
  private bits: Bit[] = [];

  constructor(private readonly assets: MowLevelAsset[]) {
    super('mow');
  }

  preload(): void {
    for (const a of this.assets) this.load.image(`tiles:${a.level.id}`, a.tilesetUrl);
    loadSprites(this);
  }

  create(): void {
    makeAnimations(this);
    makeMowTextures(this);
    this.readyResolve();
  }

  startRun(sim: MowSim): void {
    this.world?.destroy(true);
    this.sim = sim;
    this.acc = 0;
    this.reported = false;
    this.paused = false;
    this.drawnCuts = 0;
    this.toyHitsSeen = 0;
    this.bumpsSeen = 0;
    this.bits = [];

    const L = sim.level;
    this.scale.setGameSize(L.width, L.height);
    const world = (this.world = this.add.container(0, 0));

    for (const layer of L.tileLayers.filter((l) => !l.overhead)) world.add(this.tileLayer(L, layer));

    // Lawn: one canvas the size of the level, redrawn cell by cell as it's mowed.
    if (this.textures.exists(GRASS_KEY)) this.textures.remove(GRASS_KEY);
    this.grass = this.textures.createCanvas(GRASS_KEY, L.width, L.height)!;
    const ctx = this.grass.getContext();
    // Paint every grass tile, including unmowable ones under shrubs, so sprites
    // that don't line up with the grid never show bare tileset underneath.
    const per = L.tileSize / CELL;
    for (let i = 0; i < sim.cut.length; i++) {
      const cx = i % sim.cellCols;
      const cy = (i - cx) / sim.cellCols;
      if (L.grass[Math.floor(cy / per) * L.cols + Math.floor(cx / per)]) this.paintCell(ctx, sim, i);
    }
    this.grass.refresh();
    world.add(this.add.image(0, 0, GRASS_KEY).setOrigin(0));

    for (const s of L.solids) {
      const art = SOLID_SPRITES[s.kind];
      if (art?.draw === 'fit') world.add(this.add.image(s.x, s.y, art.key).setOrigin(0).setDisplaySize(s.w, s.h));
      else if (art?.draw === 'centre') world.add(this.add.image(s.x + s.w / 2, s.y + s.h / 2, art.key));
      else if (s.kind === 'fence') {
        const vertical = s.h >= s.w;
        const fence = this.add.tileSprite(s.x + s.w / 2, s.y + s.h / 2, 6, vertical ? s.h : s.w, FENCE_KEY);
        world.add(vertical ? fence : fence.setAngle(90));
      }
    }

    this.toys = L.toys.map((t) => {
      const img = this.add.image(t.col * L.tileSize + L.tileSize / 2, t.row * L.tileSize + L.tileSize / 2, toyKey(t.kind));
      world.add(img);
      return img;
    });

    this.player = this.add.sprite(0, 0, PLAYER_KEY).setOrigin(0.5, 1);
    this.mower = this.add.image(0, 0, MOWER_KEY);
    world.add([this.player, this.mower]); // mower on top

    for (const layer of L.tileLayers.filter((l) => l.overhead)) world.add(this.tileLayer(L, layer));

    for (let i = 0; i < 40; i++) {
      const img = this.add.image(-10, -10, PIXEL_KEY).setVisible(false);
      world.add(img);
      this.bits.push({ img, vx: 0, vy: 0, life: 0 });
    }
    this.draw(0, 0);
  }

  private tileLayer(L: MowLevel, layer: TileLayer): Phaser.GameObjects.GameObject {
    const data: number[][] = [];
    for (let r = 0; r < L.rows; r++) data.push(Array.from(layer.tiles.subarray(r * L.cols, (r + 1) * L.cols)));
    const map = this.make.tilemap({ data, tileWidth: L.tileSize, tileHeight: L.tileSize });
    const ts = map.addTilesetImage(`tiles:${L.id}`, `tiles:${L.id}`, L.tileSize, L.tileSize)!;
    return map.createLayer(0, ts, 0, 0)!;
  }

  private paintCell(ctx: CanvasRenderingContext2D, sim: MowSim, i: number): void {
    const cx = (i % sim.cellCols) * CELL;
    const cy = Math.floor(i / sim.cellCols) * CELL;
    const d = sim.cut[i];
    if (d) {
      ctx.fillStyle = STRIPE[d];
      ctx.fillRect(cx, cy, CELL, CELL);
      if (hash(i) < 0.35) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(cx + Math.floor(hash(i + 7) * CELL), cy + Math.floor(hash(i + 3) * CELL), 1, 1);
      }
      return;
    }
    ctx.fillStyle = TALL[1];
    ctx.fillRect(cx, cy, CELL, CELL);
    // A couple of grass blades and a shadow pixel per cell.
    for (let k = 0; k < 3; k++) {
      const h = hash(i * 7 + k);
      const x = cx + Math.floor(h * CELL);
      const y = cy + Math.floor(hash(i * 13 + k) * (CELL - 1));
      ctx.fillStyle = k === 2 ? TALL[3] : TALL[2];
      ctx.fillRect(x, y, 1, k === 2 ? 1 : 2);
    }
  }

  update(_time: number, delta: number): void {
    const sim = this.sim;
    if (!sim || this.paused) return;
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

    // Newly mowed cells, plus a few clippings for each.
    if (sim.cutLog.length > this.drawnCuts) {
      const ctx = this.grass!.getContext();
      const fresh = sim.cutLog.length - this.drawnCuts;
      for (; this.drawnCuts < sim.cutLog.length; this.drawnCuts++) this.paintCell(ctx, sim, sim.cutLog[this.drawnCuts]);
      this.grass!.refresh();
      this.spray(Math.min(4, fresh));
    }

    // Toys that got mowed fly off.
    for (; this.toyHitsSeen < sim.toyHits.length; this.toyHitsSeen++) {
      const img = this.toys[sim.toyHits[this.toyHitsSeen]];
      this.tweens.add({ targets: img, y: img.y - 18, angle: 540, alpha: 0, duration: 450, ease: 'Quad.easeOut' });
      this.cameras.main.shake(120, 0.008);
      this.hooks.onToy?.(sim);
    }
    if (sim.bumps > this.bumpsSeen) {
      this.bumpsSeen = sim.bumps;
      this.cameras.main.shake(70, 0.003);
    }

    const x = (sim.px + (sim.x - sim.px) * alpha) / SUB;
    const y = (sim.py + (sim.y - sim.py) * alpha) / SUB;
    const d = DIRS[sim.facing];
    this.mower!.setPosition(x, y).setAngle(sim.facing === 1 ? 0 : sim.facing === 2 ? 180 : sim.facing === 3 ? -90 : 90);

    // The landscaper walks behind the mower, holding the handle.
    const p = this.player!;
    p.setPosition(x - d.dx * 12, y - d.dy * 14 + (d.dy === -1 ? 6 : d.dy === 1 ? -2 : 4));
    const facing = d.dx ? 'side' : d.dy === 1 ? 'down' : 'up';
    p.setFlipX(d.dx < 0);
    p.anims.play(`${sim.dir ? 'walk' : 'idle'}-${facing}`, true);
    // The mower is what you steer, so it's always drawn on top of the landscaper.

    for (const b of this.bits) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      b.vy += 120 * dt;
      b.img.setAlpha(Math.max(0, b.life / 0.35));
      if (b.life <= 0) b.img.setVisible(false);
    }
  }

  /** Grass clippings thrown out of the side of the deck. */
  private spray(n: number): void {
    const sim = this.sim!;
    const d = DIRS[sim.facing];
    for (let k = 0; k < n; k++) {
      const b = this.bits.find((q) => q.life <= 0);
      if (!b) return;
      const side = Math.random() < 0.5 ? -1 : 1;
      const speed = 30 + Math.random() * 40;
      // Perpendicular to travel, drifting slightly backwards.
      b.vx = -d.dy * side * speed - d.dx * 15;
      b.vy = d.dx * side * speed - d.dy * 15 - 20;
      b.life = 0.35;
      b.img
        .setPosition(sim.x / SUB + -d.dy * side * 6, sim.y / SUB + d.dx * side * 6)
        .setTint(Math.random() < 0.5 ? 0x8cc457 : 0x5c9436)
        .setAlpha(1)
        .setVisible(true);
    }
  }
}
