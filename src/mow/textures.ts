import type Phaser from 'phaser';

export const MOWER_KEY = 'mower';
export const toyKey = (kind: string) => `toy-${kind === 'gnome' ? 'gnome' : 'ball'}`;

/** Placeholder art drawn in code, until there's a mower and toys in art/raw. */
export function makeMowTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const px = (c: number, x: number, y: number, w = 1, h = 1) => {
    g.fillStyle(c);
    g.fillRect(x, y, w, h);
  };

  // Push mower seen from above, pointing up. 14×15: deck, engine, wheels, handle.
  g.clear();
  px(0x2a1d12, 0, 1, 14, 11); // outline
  px(0xc8392b, 1, 1, 12, 10); // red deck
  px(0xe0574a, 1, 1, 12, 2); // highlight
  px(0x8f2a20, 1, 9, 12, 2); // shadow
  px(0x9a9a9a, 4, 3, 6, 5); // engine
  px(0xc8c8c8, 5, 3, 4, 2);
  px(0x2b2b2b, 6, 5, 2, 2); // cap
  px(0x1f1f1f, 0, 0, 3, 3); // wheels
  px(0x1f1f1f, 11, 0, 3, 3);
  px(0x1f1f1f, 0, 9, 3, 3);
  px(0x1f1f1f, 11, 9, 3, 3);
  px(0x3a3a3a, 3, 12, 1, 3); // handle
  px(0x3a3a3a, 10, 12, 1, 3);
  g.generateTexture(MOWER_KEY, 14, 15);

  // Ball, 6×6.
  g.clear();
  px(0x2a1d12, 1, 0, 4, 6);
  px(0x2a1d12, 0, 1, 6, 4);
  px(0xd8402f, 1, 1, 4, 4);
  px(0xf2f2f2, 1, 2, 4, 1);
  px(0xff8070, 2, 1, 1, 1);
  g.generateTexture('toy-ball', 6, 6);

  // Garden gnome, 6×9.
  g.clear();
  px(0x2a1d12, 1, 0, 4, 9);
  px(0x2a1d12, 0, 4, 6, 5);
  px(0xc8392b, 2, 0, 2, 1);
  px(0xc8392b, 1, 1, 4, 2); // hat
  px(0xe0a882, 1, 3, 4, 1); // face
  px(0xf2f2f2, 1, 4, 4, 2); // beard
  px(0x2f6fb0, 1, 6, 4, 2); // coat
  px(0x5b3b22, 1, 8, 4, 1); // boots
  g.generateTexture('toy-gnome', 6, 9);

  g.destroy();
}
