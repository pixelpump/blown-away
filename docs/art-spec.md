# Art

The game's art starts as large AI-generated images in `art/raw/`. A script turns them into small, crisp game sprites:

```
npm run art          # = python3 scripts/process-art.py  (needs: pip install pillow numpy)
```

It writes the sprites to `src/render/sprites/` and the ground tileset to `levels/tilesets/yard.png`. Re-run it whenever something in `art/raw/` changes, then check the result in the game.

## Replacing a piece of art

Keep the **same file name and the same layout**, and the script and game pick it up with no code changes.

| File in `art/raw/` | Layout | Becomes |
|---|---|---|
| `PixelConstructionWorkerSpriteSheet.png` | 6 columns × 3 rows: facing down, up, right. Each row has 2 idle frames then 4 walk frames. Left is mirrored. | `landscaper.png`, 26 px tall |
| `PixelArtLeafBlowerSprite.png` | One blower, nozzle pointing right | `blower.png`, 20 × 5 |
| `Pixel-ArtAutumnLeafSpriteSheet.png` | 4 columns × 2 rows: dry, then the same leaves wet | `leaves.png`, 8 leaves at 6 × 6 |
| `Pixel-ArtRooftopandYardAssetSheet.png` | Truck, shrub, tarp, fence and house roof on one sheet, separated by transparency | `truck.png`, `shrub.png`, `tarp.png`, `fence.png`, `house.png` |
| `PixelArtTerrainTileAtlas2.png` | 5 columns × 2 rows of ground tiles (slots below) | `levels/tilesets/yard.png`, 16 × 16 tiles |

`RetroRPGTerrainTextureAtlas.png` is an alternative ground set with the same layout. To use it instead, change the file name in `tiles()` in the script.

On the objects sheet, the script tells objects apart by shape: the house is the biggest, the truck the tallest, the fence the widest and thinnest, the shrub the squarest, and the tarp is what's left. Keep them roughly like that when you replace the sheet.

### Ground tile slots

| # | Tile | Surface |
|---|---|---|
| 0 | Grass | grass |
| 1 | Grass, mowed stripe | grass |
| 2 | Driveway (concrete) | pavement |
| 3 | Sidewalk slab | pavement |
| 4 | Street (asphalt) | pavement |
| 5 | Curb + street | pavement |
| 6 | Mulch | mulch |
| 7 | Gravel | gravel |
| 8 | Flower bed | mulch |
| 9 | Patio / porch stone | pavement |

## Adding new art

New objects, such as a tree, a trampoline or a second vehicle, need:
1. a few lines in `scripts/process-art.py`, to cut the object out and give it a size, and
2. an entry in `SOLID_SPRITES` in `src/render/textures.ts`, so solids of that Tiled class draw it.

Solids whose class has no art are drawn as coloured boxes, so a new object can go into a level before its art exists.

## Style notes for new pieces

- Top-down with a slight front tilt; light from the top-left.
- Warm autumn palette, dark-brown outlines, hard pixels with no soft brushes.
- Transparent background (ground tiles excepted).
- Generate big. The script shrinks it, and bold, simple shapes survive the shrink best. Fine detail such as small flowers or text gets lost.
- **Scale reference:** one tile is 16 px. The landscaper is 26 px tall, the truck 36 × 77, the house 184 × 72.
