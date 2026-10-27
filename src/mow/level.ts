/**
 * Loads a Tiled map as a mowing level. Uses the same conventions and tileset
 * as Blown Away, so yards can be shared between the games:
 *
 *   tile layer   "ground"     tiles with surface "grass" are lawn to mow;
 *                             "mulch" (flower beds) blocks the mower;
 *                             anything else can be driven over
 *   tile layers  "overhead*"  drawn above the mower
 *   object layer "solids"     a tile whose centre is inside a solid is blocked
 *   object layer "toys"       points or rectangles; mowing over one costs time
 *   object layer "markers"    point "player_start"
 *
 * The mower drives along a grid of tile-sized lanes, so everything is
 * resolved per tile.
 */
import {
  flattenLayers,
  GID_MASK,
  joinPath,
  LevelError,
  objectType,
  prop,
  type Solid,
  type TileLayer,
  type TiledMap,
  type TiledObject,
  type TiledTileset,
} from '../core/map';

export interface Toy {
  col: number;
  row: number;
  kind: string;
}

export interface MowLevel {
  id: string;
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  tileLayers: TileLayer[];
  /** Per tile: 1 = lawn that must be mowed (excludes toy tiles). */
  lawn: Uint8Array;
  /** Per tile: 1 = mower can't enter. */
  blocked: Uint8Array;
  /** Per tile: 1 = grass surface, mowable or not (for drawing). */
  grass: Uint8Array;
  toys: Toy[];
  /** Number of lawn tiles that must be mowed. */
  required: number;
  start: { col: number; row: number };
  /** 3-star time in seconds, if set. */
  par?: number;
  solids: Solid[];
  tileset: { name: string; columns: number; tileCount: number; image: string };
}

export function parseMowLevel(id: string, map: TiledMap, loadTileset: (source: string) => TiledTileset): MowLevel {
  const fail = (msg: string): never => {
    throw new LevelError(`Mowing level "${id}": ${msg}`);
  };
  if (map.orientation !== 'orthogonal' || map.infinite) fail('use an orthogonal, non-infinite map.');
  if (map.tilesets.length !== 1 || !map.tilesets[0].source) fail('use exactly one external (.tsj) tileset.');

  const tsRef = map.tilesets[0];
  const ts = loadTileset(tsRef.source!);
  const tileSize = map.tilewidth;
  const cols = map.width;
  const rows = map.height;
  const n = cols * rows;

  const surfaceOf = new Map<number, string>();
  for (const t of ts.tiles ?? []) surfaceOf.set(t.id, prop<string>(t.properties, 'surface', 'grass'));

  const layers = flattenLayers(map.layers);
  const tileLayers: TileLayer[] = [];
  for (const l of layers) {
    if (l.type !== 'tilelayer') continue;
    if (!Array.isArray(l.data) || l.data.length !== n) fail(`layer "${l.name}" must be CSV and match the map size.`);
    const tiles = new Int32Array(n);
    (l.data as number[]).forEach((gid, i) => {
      const g = gid & GID_MASK;
      tiles[i] = g === 0 ? -1 : g - tsRef.firstgid;
    });
    tileLayers.push({ name: l.name, overhead: l.name.toLowerCase().startsWith('overhead'), tiles });
  }
  const ground = tileLayers.find((l) => l.name.toLowerCase() === 'ground');
  if (!ground) fail('needs a tile layer named "ground".');

  const objectsIn = (name: string): TiledObject[] =>
    layers.filter((l) => l.type === 'objectgroup' && l.name.toLowerCase() === name).flatMap((l) => l.objects ?? []);
  const tileOf = (o: TiledObject) => ({
    col: Math.floor((o.x + (o.width ?? 0) / 2) / tileSize),
    row: Math.floor((o.y + (o.height ?? 0) / 2) / tileSize),
  });

  const solids: Solid[] = objectsIn('solids').map((o) => ({
    x: o.x,
    y: o.y,
    w: o.width ?? 0,
    h: o.height ?? 0,
    kind: objectType(o) || 'solid',
  }));

  const lawn = new Uint8Array(n);
  const blocked = new Uint8Array(n);
  const grass = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const t = ground!.tiles[i];
      const surface = t >= 0 ? (surfaceOf.get(t) ?? 'grass') : 'none';
      const cx = c * tileSize + tileSize / 2;
      const cy = r * tileSize + tileSize / 2;
      if (surface === 'grass') grass[i] = 1;
      const underSolid = solids.some((s) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h);
      if (underSolid || surface === 'mulch' || surface === 'none') blocked[i] = 1;
      else if (surface === 'grass') lawn[i] = 1;
    }
  }

  const toys: Toy[] = objectsIn('toys').map((o) => ({ ...tileOf(o), kind: objectType(o) || 'ball' }));
  for (const t of toys) {
    if (!lawn[t.row * cols + t.col]) fail(`toy at tile ${t.col},${t.row} must sit on lawn.`);
    lawn[t.row * cols + t.col] = 0; // optional: mowing it is a penalty, not a requirement
  }

  const startObj = objectsIn('markers').find((o) => objectType(o) === 'player_start');
  if (!startObj) fail('add a point "player_start" in the "markers" layer.');
  const start = tileOf(startObj!);
  if (blocked[start.row * cols + start.col]) fail('player_start is on a blocked tile.');

  const required = lawn.reduce((a, v) => a + v, 0);
  if (required === 0) fail('there is no lawn to mow.');

  const par = prop<number | null>(map.properties, 'parMow', null) ?? undefined;
  return {
    id,
    name: prop<string>(map.properties, 'name', id),
    tileSize,
    cols,
    rows,
    width: cols * tileSize,
    height: rows * tileSize,
    tileLayers,
    lawn,
    blocked,
    grass,
    toys,
    required,
    start,
    par,
    solids,
    tileset: { name: ts.name, columns: ts.columns, tileCount: ts.tilecount, image: joinPath(tsRef.source!, ts.image) },
  };
}
