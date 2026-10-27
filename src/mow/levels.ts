// Bundles every mowing map in /levels/mow at build time (Vite only).
import { joinPath, type TiledMap, type TiledTileset } from '../core/map';
import { parseMowLevel, type MowLevel } from './level';

const maps = import.meta.glob('../../levels/mow/*.tmj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const tilesets = import.meta.glob('../../levels/**/*.tsj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const images = import.meta.glob('../../levels/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface MowLevelAsset {
  level: MowLevel;
  tilesetUrl: string;
}

export function loadMowLevels(): MowLevelAsset[] {
  return Object.keys(maps)
    .sort()
    .map((path) => {
      const id = path.split('/').pop()!.replace(/\.tmj$/, '');
      const level = parseMowLevel(id, JSON.parse(maps[path]) as TiledMap, (source) => {
        const raw = tilesets[joinPath(path, source)];
        if (!raw) throw new Error(`Mowing level "${id}": tileset not found: ${source}`);
        return JSON.parse(raw) as TiledTileset;
      });
      const tilesetUrl = images[joinPath(path, level.tileset.image)];
      if (!tilesetUrl) throw new Error(`Mowing level "${id}": tileset image not found: ${level.tileset.image}`);
      return { level, tilesetUrl };
    });
}
