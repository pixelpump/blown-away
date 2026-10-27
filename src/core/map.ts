/**
 * Loads Tiled (https://www.mapeditor.org) JSON maps into the game's Level format.
 *
 * Map conventions (see docs/level-design.md):
 *   tile layer   "ground"     required; each tile's `surface` property sets leaf friction
 *   tile layers  "overhead*"  optional; drawn above the player (roofs, tree canopies)
 *   object layer "solids"     rectangles that block the player and leaves
 *   object layer "leaves"     rectangles that spawn leaves; int property `count`
 *   object layer "goals"      rectangles of type `tarp` (Pile It) or `exit` (Clear It)
 *   object layer "markers"    point of type `player_start`
 */
import { SURFACES, type Surface } from './tuning';

export type Mode = 'clear' | 'pile';
export const MODES: readonly Mode[] = ['clear', 'pile'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Solid extends Rect {
  /** Object type from Tiled (house, fence, car…). Only used for placeholder drawing. */
  kind: string;
}

export interface LeafZone extends Rect {
  count: number;
}

export interface TileLayer {
  name: string;
  overhead: boolean;
  /** Tile index within the tileset, -1 for empty. Row-major, cols × rows. */
  tiles: Int32Array;
}

export interface Level {
  id: string;
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Surface index (into SURFACES) per ground tile. */
  surface: Uint8Array;
  tileLayers: TileLayer[];
  solids: Solid[];
  leafZones: LeafZone[];
  tarps: Rect[];
  exits: Rect[];
  playerStart: { x: number; y: number };
  modes: Mode[];
  /** Target times in seconds, used for star ratings. */
  par: Partial<Record<Mode, number>>;
  /** Fraction of leaves that must be cleared to stop the clock. */
  clearThreshold: number;
  /** Draw coloured rectangles for solids (until real art covers them). */
  placeholderSolids: boolean;
  tileset: { name: string; columns: number; tileCount: number; image: string };
}

// --- Minimal Tiled JSON types ------------------------------------------------

export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

export interface TiledObject {
  id: number;
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  point?: boolean;
  ellipse?: boolean;
  polygon?: unknown;
  polyline?: unknown;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  type: string;
  name: string;
  data?: number[] | string;
  encoding?: string;
  objects?: TiledObject[];
  layers?: TiledLayer[];
  properties?: TiledProperty[];
}

export interface TiledMap {
  orientation: string;
  infinite?: boolean;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: { firstgid: number; source?: string; name?: string }[];
  properties?: TiledProperty[];
}

export interface TiledTileset {
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  tiles?: { id: number; properties?: TiledProperty[] }[];
}

// -----------------------------------------------------------------------------

export class LevelError extends Error {}

/** Gids carry flip flags in their top bits. */
export const GID_MASK = 0x1fffffff;

export function prop<T>(props: TiledProperty[] | undefined, name: string, fallback: T): T {
  const p = props?.find((q) => q.name === name);
  return p === undefined ? fallback : (p.value as T);
}

export function objectType(o: TiledObject): string {
  return (o.type || o.class || o.name || '').trim().toLowerCase();
}

/** Resolve `rel` against the directory of file path `base`. */
export function joinPath(base: string, rel: string): string {
  const out = base.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function flattenLayers(layers: TiledLayer[]): TiledLayer[] {
  return layers.flatMap((l) => (l.type === 'group' ? flattenLayers(l.layers ?? []) : [l]));
}

/**
 * @param id              Level id (usually the file name without extension).
 * @param map             Parsed .tmj JSON.
 * @param loadTileset     Returns the parsed .tsj for a tileset `source` path (relative to the map).
 */
export function parseLevel(id: string, map: TiledMap, loadTileset: (source: string) => TiledTileset): Level {
  const fail = (msg: string): never => {
    throw new LevelError(`Level "${id}": ${msg}`);
  };

  if (map.orientation !== 'orthogonal') fail('map orientation must be Orthogonal.');
  if (map.infinite) fail('turn off "Infinite" in Map Properties.');
  if (map.tilewidth !== map.tileheight) fail('tiles must be square.');
  if (map.tilesets.length !== 1) fail(`use exactly one tileset (found ${map.tilesets.length}).`);

  const tsRef = map.tilesets[0];
  if (!tsRef.source) fail('the tileset must be external (.tsj), not embedded. Use "Export Tileset As…".');
  const ts = loadTileset(tsRef.source!);
  if (ts.tilewidth !== map.tilewidth) fail('tileset tile size must match the map tile size.');

  const tileSize = map.tilewidth;
  const cols = map.width;
  const rows = map.height;
  const firstgid = tsRef.firstgid;

  // Surface per tile index, from the tileset's custom properties.
  const tileSurface = new Uint8Array(ts.tilecount);
  for (const t of ts.tiles ?? []) {
    const name = prop<string>(t.properties, 'surface', 'grass');
    const idx = SURFACES.indexOf(name as Surface);
    if (idx < 0) fail(`tileset tile ${t.id} has unknown surface "${name}" (use ${SURFACES.join(', ')}).`);
    tileSurface[t.id] = idx;
  }

  const layers = flattenLayers(map.layers);
  const tileLayers: TileLayer[] = [];
  for (const l of layers) {
    if (l.type !== 'tilelayer') continue;
    if (!Array.isArray(l.data)) fail(`layer "${l.name}" is compressed. Set Tile Layer Format to CSV in Map Properties.`);
    const data = l.data as number[];
    if (data.length !== cols * rows) fail(`layer "${l.name}" has the wrong size.`);
    const tiles = new Int32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const gid = data[i] & GID_MASK;
      tiles[i] = gid === 0 ? -1 : gid - firstgid;
    }
    const overhead = l.name.toLowerCase().startsWith('overhead') || prop(l.properties, 'overhead', false);
    tileLayers.push({ name: l.name, overhead, tiles });
  }

  const ground = tileLayers.find((l) => l.name.toLowerCase() === 'ground');
  if (!ground) fail('needs a tile layer named "ground".');
  const surface = new Uint8Array(cols * rows);
  for (let i = 0; i < surface.length; i++) {
    const t = ground!.tiles[i];
    surface[i] = t >= 0 ? tileSurface[t] : 0;
  }

  const objectsIn = (name: string): TiledObject[] =>
    layers.filter((l) => l.type === 'objectgroup' && l.name.toLowerCase() === name).flatMap((l) => l.objects ?? []);

  const rectOf = (o: TiledObject, layer: string): Rect => {
    if (o.point || o.ellipse || o.polygon || o.polyline || !o.width || !o.height) {
      fail(`object ${o.id} in "${layer}" must be a rectangle.`);
    }
    return { x: o.x, y: o.y, w: o.width!, h: o.height! };
  };

  const solids: Solid[] = objectsIn('solids').map((o) => ({ ...rectOf(o, 'solids'), kind: objectType(o) || 'solid' }));

  const leafZones: LeafZone[] = objectsIn('leaves').map((o) => {
    const count = prop<number>(o.properties, 'count', 20);
    if (!Number.isInteger(count) || count < 0) fail(`leaf zone ${o.id} needs a whole-number "count".`);
    return { ...rectOf(o, 'leaves'), count };
  });
  if (leafZones.reduce((s, z) => s + z.count, 0) === 0) fail('add at least one leaf zone in the "leaves" layer.');

  const tarps: Rect[] = [];
  const exits: Rect[] = [];
  for (const o of objectsIn('goals')) {
    const type = objectType(o);
    if (type === 'tarp') tarps.push(rectOf(o, 'goals'));
    else if (type === 'exit') exits.push(rectOf(o, 'goals'));
    else fail(`goal object ${o.id} has type "${type}"; use "tarp" or "exit".`);
  }

  const start = objectsIn('markers').find((o) => objectType(o) === 'player_start');
  if (!start) fail('add a point named or typed "player_start" in the "markers" layer.');

  const modeList = prop<string>(map.properties, 'modes', 'clear,pile')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  for (const m of modeList) if (!MODES.includes(m as Mode)) fail(`unknown mode "${m}" in "modes".`);
  const modes = modeList as Mode[];
  if (modes.length === 0) fail('"modes" must list at least one of: clear, pile.');
  if (modes.includes('pile') && tarps.length === 0) fail('Pile It mode needs a "tarp" in the "goals" layer.');
  if (modes.includes('clear') && exits.length === 0) fail('Clear It mode needs an "exit" in the "goals" layer.');

  const par: Partial<Record<Mode, number>> = {};
  const parClear = prop<number | null>(map.properties, 'parClear', null);
  const parPile = prop<number | null>(map.properties, 'parPile', null);
  if (parClear) par.clear = parClear;
  if (parPile) par.pile = parPile;

  const clearThreshold = prop<number>(map.properties, 'clearThreshold', 0.95);
  if (!(clearThreshold > 0 && clearThreshold <= 1)) fail('"clearThreshold" must be between 0 and 1.');

  return {
    id,
    name: prop<string>(map.properties, 'name', id),
    tileSize,
    cols,
    rows,
    width: cols * tileSize,
    height: rows * tileSize,
    surface,
    tileLayers,
    solids,
    leafZones,
    tarps,
    exits,
    playerStart: { x: start!.x, y: start!.y },
    modes,
    par,
    clearThreshold,
    placeholderSolids: prop(map.properties, 'placeholderSolids', true),
    tileset: { name: ts.name, columns: ts.columns, tileCount: ts.tilecount, image: joinPath(tsRef.source!, ts.image) },
  };
}
