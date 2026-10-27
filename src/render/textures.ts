import type Phaser from 'phaser';
import { LEAF_COLOURS, WET_LEAF_COLOURS } from './palette';

export const leafKey = (variant: number, wet: boolean) => `leaf-${wet ? 'wet' : 'dry'}-${variant}`;
export const PLAYER_KEY = 'player';
export const PIXEL_KEY = 'pixel';

/** Draw placeholder sprites into textures. Swap for a spritesheet later. */
export function makeTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics();

  const leaf = (colour: number, key: string) => {
    g.clear();
    g.fillStyle(colour);
    g.fillRect(1, 0, 2, 1);
    g.fillRect(0, 1, 4, 1);
    g.fillRect(1, 2, 2, 1);
    g.fillStyle(0x000000, 0.25);
    g.fillRect(3, 1, 1, 1);
    g.generateTexture(key, 4, 3);
  };
  LEAF_COLOURS.forEach((c, i) => leaf(c, leafKey(i, false)));
  WET_LEAF_COLOURS.forEach((c, i) => leaf(c, leafKey(i, true)));

  // Landscaper, 10×14: cap, face, hi-vis vest, work pants, boots.
  g.clear();
  const px = (c: number, x: number, y: number, w: number, h: number) => {
    g.fillStyle(c);
    g.fillRect(x, y, w, h);
  };
  px(0x5b3b22, 2, 0, 6, 2); // cap
  px(0x4a2e1a, 1, 2, 8, 1); // brim
  px(0xe0a882, 3, 3, 4, 2); // face
  px(0x2b2b2b, 2, 3, 1, 2); // ear defenders
  px(0x2b2b2b, 7, 3, 1, 2);
  px(0xc8e03a, 1, 5, 8, 5); // vest
  px(0xf2f2f2, 1, 7, 8, 1); // reflective stripe
  px(0xe0a882, 0, 6, 1, 3); // arms
  px(0xe0a882, 9, 6, 1, 3);
  px(0x3b4a5a, 2, 10, 6, 2); // pants
  px(0x2a1d12, 2, 12, 2, 2); // boots
  px(0x2a1d12, 6, 12, 2, 2);
  g.generateTexture(PLAYER_KEY, 10, 14);

  g.clear();
  g.fillStyle(0xffffff);
  g.fillRect(0, 0, 1, 1);
  g.generateTexture(PIXEL_KEY, 1, 1);

  g.destroy();
}
