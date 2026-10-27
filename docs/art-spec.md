# Art spec

Everything on screen right now is placeholder: coloured boxes and a generated tileset. Real art drops in without code changes wherever possible.

## Ground rules

- **PNG, transparent background, 1× scale.** The game scales it up with crisp pixels, so don't upscale it yourself.
- **No anti-aliasing or soft brushes.** Use hard pixels only.
- **Top-down view**, with a slight front tilt (like Stardew Valley or classic Zelda), so walls and people show a little of their front.
- **Palette:** a limited palette keeps everything coherent. Pick one, such as [Endesga 32](https://lospec.com/palette-list/endesga-32) or a custom one built from the Staff Board browns and greens, and stick to it.
- **Scale reference:** one tile is 16 × 16 px, and the landscaper is about 10 px wide.

## Priority order

### 1. The landscaper (biggest impact)

- **Frame size:** 16 × 24 px. The body should be about 10 px wide and centred, with the feet on the bottom row.
- **Look:** work clothes, hi-vis vest, cap, ear defenders.
- **Leave the blower out of the body sprite.** Players can aim independently of walking direction, so the blower tube is a **separate sprite** (about 10 × 4 px, nozzle pointing right) that the game rotates.
- Animations, with each row a direction:

| Row | Direction | Frames |
|---|---|---|
| 1 | Down (facing camera) | idle ×2, walk ×4 |
| 2 | Up (facing away) | idle ×2, walk ×4 |
| 3 | Right (left is mirrored) | idle ×2, walk ×4 |

So one sheet is 6 frames × 3 rows, or 96 × 72 px.

### 2. Leaves

- 4 × 4 px each (5 × 5 at most).
- 4 dry colours (orange, red, yellow, brown) plus 4 darker, wetter versions.
- One sheet, 8 leaves in a row. Optionally add a second row with a slightly rotated "tumble" frame for each.

### 3. Ground tileset

Replace `levels/tilesets/placeholder.png` with the same grid of 16 × 16 tiles in 5 columns, and everything updates. The current slots are:

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

You can add more tiles, such as grass-to-driveway edges, corners or a lawn border. Extend the image, then set each new tile's `surface` in Tiled.

### 4. Obstacles

| Object | Size in yard-01 | Notes |
|---|---|---|
| House / garage roof | 160 × 52 | Seen from above. Can be built from tiles in an `overhead` layer. |
| Pickup truck | 36 × 56 | Top-down. A crew truck would be a nice touch. |
| Shrub | 16 × 16 | Round, dark green |
| Fence | 4 px wide, tiles vertically | Wooden |
| Tarp | 48 × 40 | Blue, with grommets. Ideally a 9-slice so it can be any size. |

### 5. Nice to have

- A pixel "BLOWN AWAY" wordmark for the menu
- Air puff particles (3–4 frames, white, 4 × 4)
- A leaf pile sprite for the tarp in Pile It (3 sizes)

## Hand-off

Drop files in `art/` with a short note on frame order, and I'll wire them in. Rough first drafts are fine and useful: I can wire them up early so we see how they read at phone size before you polish.
