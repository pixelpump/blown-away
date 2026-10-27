import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { joinPath, LevelError, parseLevel } from './map';
import { loadLevelFromDisk, makeMap, TEST_TILESET } from './testing';

describe('joinPath', () => {
  it('resolves relative to the base file', () => {
    expect(joinPath('../../levels/yard-01.tmj', 'tilesets/a.tsj')).toBe('../../levels/tilesets/a.tsj');
    expect(joinPath('tilesets/a.tsj', '../art/a.png')).toBe('art/a.png');
    expect(joinPath('a.tsj', 'a.png')).toBe('a.png');
  });
});

describe('every level in /levels', () => {
  const ids = readdirSync(new URL('../../levels/', import.meta.url)).filter((f) => f.endsWith('.tmj')).map((f) => f.replace(/\.tmj$/, ''));

  it('has at least one level', () => expect(ids.length).toBeGreaterThan(0));

  for (const id of ids) {
    it(`${id} loads and spawns leaves in every mode`, async () => {
      const { Sim } = await import('./sim');
      const { WEATHER_PRESETS } = await import('./weather');
      const level = loadLevelFromDisk(id);
      for (const mode of level.modes) {
        const sim = new Sim(level, { mode, weather: WEATHER_PRESETS.dry, seed: 1 });
        expect(sim.count).toBeGreaterThan(0);
      }
    });
  }
});

describe('yard-01', () => {
  const level = loadLevelFromDisk('yard-01');

  it('loads with both modes and goals', () => {
    expect(level.name).toBe('Maple Court');
    expect(level.modes).toEqual(['clear', 'pile']);
    expect(level.tarps.length).toBeGreaterThan(0);
    expect(level.exits.length).toBeGreaterThan(0);
    expect(level.width).toBe(192);
    expect(level.height).toBe(288);
    expect(level.leafZones.reduce((s, z) => s + z.count, 0)).toBe(300);
  });

  it('reads surfaces from the tileset', () => {
    const at = (c: number, r: number) => level.surface[r * level.cols + c];
    expect(at(3, 8)).toBe(0); // grass
    expect(at(9, 8)).toBe(1); // driveway = pavement
    expect(at(3, 4)).toBe(2); // flower bed = mulch
    expect(at(7, 8)).toBe(3); // gravel
  });
});

describe('parseLevel errors', () => {
  const base = { cols: 4, rows: 4, start: { x: 8, y: 8 }, leaves: [{ x: 0, y: 0, w: 32, h: 32, count: 5 }] };

  it('requires a tarp for pile mode', () => {
    const map = makeMap({ ...base, modes: 'pile' });
    expect(() => parseLevel('t', map, () => TEST_TILESET)).toThrow(/tarp/);
  });

  it('requires a player start', () => {
    const map = makeMap({ ...base, modes: 'clear', goals: [{ type: 'exit', x: 0, y: 48, w: 64, h: 16 }] });
    map.layers = map.layers.filter((l) => l.name !== 'markers');
    expect(() => parseLevel('t', map, () => TEST_TILESET)).toThrow(LevelError);
  });

  it('explains compressed layers', () => {
    const map = makeMap({ ...base, modes: 'clear', goals: [{ type: 'exit', x: 0, y: 48, w: 64, h: 16 }] });
    map.layers[0].data = 'eJxjYGBgAAAABAAB';
    expect(() => parseLevel('t', map, () => TEST_TILESET)).toThrow(/CSV/);
  });
});
