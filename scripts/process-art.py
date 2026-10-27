#!/usr/bin/env python3
"""
Turns the large AI-generated art in art/raw/ into game-ready pixel art.

    python3 scripts/process-art.py          # needs: pip install pillow numpy

AI "pixel art" comes out at ~1000 px with art pixels of 8-25 screen pixels
that don't sit on an exact grid, so it can't simply be scaled down. For each asset this script:
  1. cuts it out (fixed grid cells, or by transparency),
  2. builds a small colour palette from the asset's opaque pixels,
  3. shrinks it to game size by taking the most common palette colour in each
     block ("mode" downsampling), which keeps outlines crisp where averaging
     would blur them,
  4. makes alpha strictly on/off.

Outputs go to src/render/sprites/ and levels/tilesets/. Re-run it whenever
art/raw/ changes, then check the result in the game.
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
SPRITES = ROOT / "src" / "render" / "sprites"
TILESETS = ROOT / "levels" / "tilesets"

ALPHA_CUTOFF = 160  # drops the soft glow some generators add around sprites


# --- helpers -----------------------------------------------------------------


def load(name: str) -> np.ndarray:
    return np.array(Image.open(RAW / name).convert("RGBA"))


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def palette_for(pixels: np.ndarray, colours: int) -> Image.Image:
    """A P-mode image holding a palette fitted to the given RGB pixels (N×3)."""
    strip = Image.fromarray(pixels.reshape(1, -1, 3).astype(np.uint8), "RGB")
    return strip.quantize(colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def index_with(rgb: np.ndarray, pal: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Map an RGB image onto a palette. Returns (index image, palette colours)."""
    q = Image.fromarray(rgb.astype(np.uint8), "RGB").quantize(palette=pal, dither=Image.Dither.NONE)
    colours = np.array(pal.getpalette()[: 256 * 3], dtype=np.uint8).reshape(-1, 3)
    return np.array(q), colours


def mode_downsample(
    rgba: np.ndarray, out_w: int, out_h: int, pal: Image.Image, inner: float = 0.7, opaque: bool = False
) -> np.ndarray:
    """
    Shrink to out_w×out_h. Each output pixel takes the most common palette
    colour in the middle `inner` fraction of its source block.
    """
    h, w = rgba.shape[:2]
    idx, colours = index_with(rgba[..., :3], pal)
    alpha = rgba[..., 3] >= ALPHA_CUTOFF
    out = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    margin = (1 - inner) / 2
    for j in range(out_h):
        y0 = int((j + margin) * h / out_h)
        y1 = max(y0 + 1, int((j + 1 - margin) * h / out_h))
        for i in range(out_w):
            x0 = int((i + margin) * w / out_w)
            x1 = max(x0 + 1, int((i + 1 - margin) * w / out_w))
            a = alpha[y0:y1, x0:x1]
            if not opaque and a.mean() < 0.5:
                continue
            block = idx[y0:y1, x0:x1][a] if a.any() else idx[y0:y1, x0:x1].ravel()
            c = np.bincount(block.ravel()).argmax()
            out[j, i, :3] = colours[c]
            out[j, i, 3] = 255
    return out


def components(mask: np.ndarray, min_area: int, step: int = 4) -> list[tuple[int, int, int, int]]:
    """Bounding boxes of separate objects in a sheet (flood fill on a coarse grid)."""
    small = mask[::step, ::step]
    seen = np.zeros_like(small, dtype=bool)
    h, w = small.shape
    boxes = []
    for y in range(h):
        for x in range(w):
            if not small[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            ys, xs = [y], [x]
            while q:
                cy, cx = q.popleft()
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
                        ys.append(ny)
                        xs.append(nx)
            if len(ys) * step * step >= min_area:
                boxes.append((min(xs) * step, min(ys) * step, (max(xs) + 1) * step, (max(ys) + 1) * step))
    return boxes


def save(arr: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGBA").save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {arr.shape[1]}×{arr.shape[0]}")


# --- assets ------------------------------------------------------------------


def landscaper() -> dict:
    """6 columns × 3 rows (down, up, right; 2 idle + 4 walk). One shared scale."""
    src = load("PixelConstructionWorkerSpriteSheet.png")
    H, W = src.shape[:2]
    cells = []
    for r in range(3):
        for c in range(6):
            cell = src[r * H // 3 : (r + 1) * H // 3, c * W // 6 : (c + 1) * W // 6]
            x0, y0, x1, y1 = bbox(cell[..., 3] >= ALPHA_CUTOFF)
            cells.append(cell[y0:y1, x0:x1])

    # One palette and one art-pixel size for every frame, so frames match.
    opaque = np.concatenate([c[..., :3][c[..., 3] >= ALPHA_CUTOFF] for c in cells])
    pal = palette_for(opaque, 28)
    s = cells[0].shape[0] / LANDSCAPER_HEIGHT
    print(f"  {s:.2f} source px per game px")

    frames = []
    for cell in cells:
        h, w = cell.shape[:2]
        frames.append(mode_downsample(cell, max(1, round(w / s)), max(1, round(h / s)), pal))

    fw = max(f.shape[1] for f in frames) + 2
    fh = max(f.shape[0] for f in frames) + 1
    sheet = np.zeros((fh * 3, fw * 6, 4), dtype=np.uint8)
    for k, f in enumerate(frames):
        r, c = divmod(k, 6)
        ox = c * fw + (fw - f.shape[1]) // 2  # centred
        oy = r * fh + fh - f.shape[0]  # feet on the bottom row
        sheet[oy : oy + f.shape[0], ox : ox + f.shape[1]] = f
    save(sheet, SPRITES / "landscaper.png")
    return {"frameWidth": fw, "frameHeight": fh}


# Height of the front-facing idle frame in game pixels. Every frame uses the
# same scale. 26 px is chunky and readable on a phone; the collision body is
# 10 px wide regardless.
LANDSCAPER_HEIGHT = 26


def blower() -> None:
    src = load("PixelArtLeafBlowerSprite.png")
    x0, y0, x1, y1 = bbox(src[..., 3] >= ALPHA_CUTOFF)
    crop = src[y0:y1, x0:x1]
    pal = palette_for(crop[..., :3][crop[..., 3] >= ALPHA_CUTOFF], 10)
    h = 5
    w = round(crop.shape[1] / crop.shape[0] * h)
    save(mode_downsample(crop, w, h, pal, inner=0.5), SPRITES / "blower.png")


def leaves() -> None:
    """4 columns × 2 rows (dry, wet) → one 8-frame strip of SIZE×SIZE cells."""
    SIZE = 6
    src = load("Pixel-ArtAutumnLeafSpriteSheet.png")
    H, W = src.shape[:2]
    out = np.zeros((SIZE, SIZE * 8, 4), dtype=np.uint8)
    for r in range(2):
        for c in range(4):
            cell = src[r * H // 2 : (r + 1) * H // 2, c * W // 4 : (c + 1) * W // 4]
            x0, y0, x1, y1 = bbox(cell[..., 3] >= ALPHA_CUTOFF)
            crop = cell[y0:y1, x0:x1]
            pal = palette_for(crop[..., :3][crop[..., 3] >= ALPHA_CUTOFF], 4)
            side = SIZE - 1
            scale = side / max(crop.shape[:2])
            w = max(2, round(crop.shape[1] * scale))
            h = max(2, round(crop.shape[0] * scale))
            leaf = mode_downsample(crop, w, h, pal, inner=0.6)
            k = r * 4 + c
            ox = k * SIZE + (SIZE - w) // 2
            oy = (SIZE - h) // 2
            out[oy : oy + h, ox : ox + w] = leaf
    save(out, SPRITES / "leaves.png")


# Object sheet: name → (game width, game height). Sizes match the solids in
# the yard; the truck and tarp keep their art's proportions.
OBJECTS = {
    "truck": (36, 77),
    "shrub": (16, 16),
    "tarp": (48, 34),
    "fence": None,  # special: rotated into a vertical, tileable strip
    "house": (184, 72),
}


def objects() -> None:
    src = load("Pixel-ArtRooftopandYardAssetSheet.png")
    mask = src[..., 3] >= ALPHA_CUTOFF
    boxes = components(mask, min_area=4000)
    # Identify by position and shape: truck is tall, fence is very wide and thin,
    # house is the biggest, shrub roughly square, tarp the remaining one.
    by_area = sorted(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    named: dict[str, tuple[int, int, int, int]] = {"house": by_area[0]}
    rest = by_area[1:]
    named["truck"] = max(rest, key=lambda b: (b[3] - b[1]) / (b[2] - b[0]))
    rest.remove(named["truck"])
    named["fence"] = max(rest, key=lambda b: (b[2] - b[0]) / (b[3] - b[1]))
    rest.remove(named["fence"])
    named["shrub"] = min(rest, key=lambda b: abs((b[2] - b[0]) / (b[3] - b[1]) - 1))
    rest.remove(named["shrub"])
    named["tarp"] = rest[0]

    for name, (x0, y0, x1, y1) in named.items():
        crop = src[y0:y1, x0:x1]
        tight = bbox(crop[..., 3] >= ALPHA_CUTOFF)
        crop = crop[tight[1] : tight[3], tight[0] : tight[2]]
        # The house needs more colours, or its small front bushes lose their green.
        pal = palette_for(crop[..., :3][crop[..., 3] >= ALPHA_CUTOFF], 96 if name == "house" else 48)
        if name == "fence":
            # Rotate the side-on fence into a top-down vertical strip, 6 px wide.
            crop = np.rot90(crop, k=1).copy()
            w = 6
            h = round(crop.shape[0] / crop.shape[1] * w)
            out = mode_downsample(crop, w, h, pal, inner=0.6)
        else:
            w, h = OBJECTS[name]
            out = mode_downsample(crop, w, h, pal, inner=0.6)
        save(out, SPRITES / f"{name}.png")


TILE_LABELS = [
    ("grass", "grass"),
    ("grass-stripe", "grass"),
    ("driveway", "pavement"),
    ("sidewalk", "pavement"),
    ("street", "pavement"),
    ("curb", "pavement"),
    ("mulch", "mulch"),
    ("gravel", "gravel"),
    ("flowerbed", "mulch"),
    ("patio", "pavement"),
]


def tiles(source: str = "PixelArtTerrainTileAtlas2.png") -> None:
    """5×2 atlas of ground tiles → 16×16 tiles in the same slots as the map uses."""
    T = 16
    src = load(source)
    src[..., 3] = 255
    H, W = src.shape[:2]
    out = np.zeros((T * 2, T * 5, 4), dtype=np.uint8)
    for k in range(10):
        r, c = divmod(k, 5)
        cell = src[r * H // 2 : (r + 1) * H // 2, c * W // 5 : (c + 1) * W // 5]
        # Trim a sliver off each edge: generators often leave a seam line there.
        m = max(2, cell.shape[0] // 60)
        cell = cell[m:-m, m:-m]
        pal = palette_for(cell[..., :3].reshape(-1, 3), 12)
        out[r * T : (r + 1) * T, c * T : (c + 1) * T] = mode_downsample(cell, T, T, pal, inner=0.8, opaque=True)
    save(out, TILESETS / "yard.png")
    tsj = {
        "type": "tileset",
        "version": "1.10",
        "tiledversion": "1.11.2",
        "name": "yard",
        "tilewidth": T,
        "tileheight": T,
        "tilecount": 10,
        "columns": 5,
        "image": "yard.png",
        "imagewidth": T * 5,
        "imageheight": T * 2,
        "margin": 0,
        "spacing": 0,
        "tiles": [
            {
                "id": i,
                "properties": [
                    {"name": "label", "type": "string", "value": label},
                    {"name": "surface", "type": "string", "value": surface},
                ],
            }
            for i, (label, surface) in enumerate(TILE_LABELS)
        ],
    }
    (TILESETS / "yard.tsj").write_text(json.dumps(tsj, indent=1) + "\n")
    print(f"  levels/tilesets/yard.tsj")


def main() -> None:
    print("Landscaper")
    frame = landscaper()
    print("Blower")
    blower()
    print("Leaves")
    leaves()
    print("Yard objects")
    objects()
    print("Ground tiles")
    tiles()
    (SPRITES / "sprites.json").write_text(json.dumps({"landscaper": frame}, indent=1) + "\n")
    print("  src/render/sprites/sprites.json")


if __name__ == "__main__":
    main()
