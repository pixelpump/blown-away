// Bundles every Tiled map in /levels at build time (Vite only).
import { joinPath, parseLevel, type Level, type TiledMap, type TiledTileset } from '../core';

const maps = import.meta.glob('../../levels/*.tmj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const tilesets = import.meta.glob('../../levels/**/*.tsj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const images = import.meta.glob('../../levels/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface LevelAsset {
  level: Level;
  tilesetUrl: string;
}

export function loadLevels(): LevelAsset[] {
  return Object.keys(maps)
    .sort()
    .map((path) => {
      const id = path.split('/').pop()!.replace(/\.tmj$/, '');
      const level = parseLevel(id, JSON.parse(maps[path]) as TiledMap, (source) => {
        const raw = tilesets[joinPath(path, source)];
        if (!raw) throw new Error(`Level "${id}": tileset not found: ${source}`);
        return JSON.parse(raw) as TiledTileset;
      });
      const tilesetUrl = images[joinPath(path, level.tileset.image)];
      if (!tilesetUrl) throw new Error(`Level "${id}": tileset image not found: ${level.tileset.image}`);
      return { level, tilesetUrl };
    });
}
