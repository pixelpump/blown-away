import type Phaser from 'phaser';
import blowerUrl from './sprites/blower.png';
import fenceUrl from './sprites/fence.png';
import houseUrl from './sprites/house.png';
import landscaperUrl from './sprites/landscaper.png';
import leavesUrl from './sprites/leaves.png';
import shrubUrl from './sprites/shrub.png';
import sheets from './sprites/sprites.json';
import tarpUrl from './sprites/tarp.png';
import truckUrl from './sprites/truck.png';

// Sprites are generated from art/raw by scripts/process-art.py.

export const PLAYER_KEY = 'landscaper';
export const BLOWER_KEY = 'blower';
export const LEAVES_KEY = 'leaves';
export const FENCE_KEY = 'fence';
export const TARP_KEY = 'tarp';
export const PIXEL_KEY = 'pixel';

/** Leaf sheet: frames 0–3 dry, 4–7 the same leaves wet. */
export const leafFrame = (variant: number, wet: boolean) => variant + (wet ? 4 : 0);

/**
 * Solid object kinds (Tiled class) that have art. `fit` stretches the sprite
 * over the solid's rectangle; `centre` draws it at its own size, centred.
 */
export const SOLID_SPRITES: Record<string, { key: string; draw: 'fit' | 'centre' }> = {
  house: { key: 'house', draw: 'fit' },
  truck: { key: 'truck', draw: 'fit' },
  car: { key: 'truck', draw: 'fit' },
  shrub: { key: 'shrub', draw: 'centre' },
};

export function loadSprites(scene: Phaser.Scene): void {
  const { frameWidth, frameHeight } = sheets.landscaper;
  scene.load.spritesheet(PLAYER_KEY, landscaperUrl, { frameWidth, frameHeight });
  scene.load.spritesheet(LEAVES_KEY, leavesUrl, { frameWidth: 6, frameHeight: 6 });
  scene.load.image(BLOWER_KEY, blowerUrl);
  scene.load.image(FENCE_KEY, fenceUrl);
  scene.load.image(TARP_KEY, tarpUrl);
  scene.load.image('house', houseUrl);
  scene.load.image('truck', truckUrl);
  scene.load.image('shrub', shrubUrl);
}

/** Landscaper sheet rows: 0 facing down, 1 facing up, 2 facing right (left = mirrored). */
const ROWS = ['down', 'up', 'side'] as const;
export type Facing = (typeof ROWS)[number];

export function makeAnimations(scene: Phaser.Scene): void {
  ROWS.forEach((dir, row) => {
    const first = row * 6;
    scene.anims.create({
      key: `idle-${dir}`,
      frames: scene.anims.generateFrameNumbers(PLAYER_KEY, { start: first, end: first + 1 }),
      frameRate: 2,
      repeat: -1,
    });
    scene.anims.create({
      key: `walk-${dir}`,
      frames: scene.anims.generateFrameNumbers(PLAYER_KEY, { start: first + 2, end: first + 5 }),
      frameRate: 9,
      repeat: -1,
    });
  });

  const g = scene.add.graphics();
  g.fillStyle(0xffffff);
  g.fillRect(0, 0, 1, 1);
  g.generateTexture(PIXEL_KEY, 1, 1);
  g.destroy();
}
