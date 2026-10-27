// Test helpers (Node only).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { joinPath, parseLevel, type Level, type TiledMap, type TiledTileset } from './map';

const LEVELS_DIR = fileURLToPath(new URL('../../levels/', import.meta.url));

export function loadLevelFromDisk(id: string): Level {
  const mapPath = `${LEVELS_DIR}${id}.tmj`;
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as TiledMap;
  return parseLevel(id, map, (src) => JSON.parse(readFileSync(joinPath(mapPath, src), 'utf8')) as TiledTileset);
}

export const TEST_TILESET: TiledTileset = {
  name: 'test',
  tilewidth: 16,
  tileheight: 16,
  tilecount: 2,
  columns: 2,
  image: 'test.png',
  tiles: [
    { id: 0, properties: [{ name: 'surface', type: 'string', value: 'pavement' }] },
    { id: 1, properties: [{ name: 'surface', type: 'string', value: 'mulch' }] },
  ],
};

type Obj = { type?: string; x: number; y: number; w?: number; h?: number; count?: number };

/** Build a small Tiled map in code. `ground` is a cols×rows grid of tile indices. */
export function makeMap(opts: {
  cols: number;
  rows: number;
  ground?: number[];
  solids?: Obj[];
  leaves?: Obj[];
  goals?: Obj[];
  start: { x: number; y: number };
  modes?: string;
}): TiledMap {
  let id = 1;
  const obj = (o: Obj) => ({
    id: id++,
    type: o.type ?? '',
    x: o.x,
    y: o.y,
    width: o.w ?? 0,
    height: o.h ?? 0,
    ...(o.count !== undefined ? { properties: [{ name: 'count', type: 'int', value: o.count }] } : {}),
  });
  return {
    orientation: 'orthogonal',
    width: opts.cols,
    height: opts.rows,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 1, source: 'test.tsj' }],
    properties: [{ name: 'modes', type: 'string', value: opts.modes ?? 'clear,pile' }],
    layers: [
      { type: 'tilelayer', name: 'ground', data: (opts.ground ?? new Array(opts.cols * opts.rows).fill(0)).map((t) => t + 1) },
      { type: 'objectgroup', name: 'solids', objects: (opts.solids ?? []).map(obj) },
      { type: 'objectgroup', name: 'leaves', objects: (opts.leaves ?? []).map(obj) },
      { type: 'objectgroup', name: 'goals', objects: (opts.goals ?? []).map(obj) },
      { type: 'objectgroup', name: 'markers', objects: [{ id: id++, type: 'player_start', point: true, x: opts.start.x, y: opts.start.y }] },
    ],
  };
}

export function makeLevel(opts: Parameters<typeof makeMap>[0]): Level {
  return parseLevel('test', makeMap(opts), () => TEST_TILESET);
}
