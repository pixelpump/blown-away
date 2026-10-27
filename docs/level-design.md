# Level design with Tiled

Levels are [Tiled](https://www.mapeditor.org) maps in `levels/`. Every `.tmj` file there is picked up automatically, and the file name becomes the level id (`yard-01`).

Open `levels/yard-01.tmj` in Tiled to see a working example. The quickest way to make a new yard is to copy it.

## Map settings

| Setting | Value |
|---|---|
| Orientation | Orthogonal |
| Tile size | 16 × 16 |
| Map size | 12 × 18 tiles fits a phone in portrait (192 × 288 px) |
| Infinite | Off |
| Tile layer format | CSV (the default) |
| Tileset | Exactly one, external (`.tsj`), e.g. `tilesets/placeholder.tsj` |

### Map properties

| Property | Type | Example | Meaning |
|---|---|---|---|
| `name` | string | `Maple Court` | Shown in the menu |
| `modes` | string | `clear,pile` | Modes this yard supports |
| `parClear` | float | `50` | 3-star time in seconds for Clear It |
| `parPile` | float | `80` | 3-star time in seconds for Pile It |
| `clearThreshold` | float | `0.95` | Fraction of leaves needed to stop the clock |
| `placeholderSolids` | bool | `true` | Draw coloured boxes for solids. Turn it off once real art covers them. |

## Layers

| Layer | Kind | What goes in it |
|---|---|---|
| `ground` | Tile layer | **Required.** Grass, driveway, beds… Each tile's `surface` sets how leaves behave. |
| `overhead…` | Tile layer | Optional. Drawn above the player (roof edges, tree canopies). Any name starting with `overhead`. |
| `solids` | Object layer | Rectangles that block the player and leaves. Set the object **Class** to `house`, `fence`, `car`, `shrub` or `tree` (used for placeholder colours). |
| `leaves` | Object layer | Rectangles where leaves spawn. Add an int property `count`. Around 300 leaves total per yard is a good target. |
| `goals` | Object layer | Rectangles with Class `tarp` (Pile It) and/or `exit` (Clear It). |
| `markers` | Object layer | A **point** with Class or name `player_start`. |

Leaves never spawn inside solids or goals.

## Surfaces

Set the custom property `surface` on tiles in the tileset (Tileset editor → select tile → Custom Properties).

| surface | Feel |
|---|---|
| `grass` | Default. Leaves slow down quickly. |
| `pavement` | Leaves slide far and the wind moves them. |
| `mulch` | Leaves stick. You need to get close. |
| `gravel` | Between grass and pavement. |

## Design tips

- **Leave walking room, and avoid dead-end nooks.** The player is about 10 px wide. Leaves blow into any gap, but the player can only follow into gaps wider than about 12 px. Run walls right up to fences rather than leaving a slot.
- **Corners are the hard part.** The last 5% of leaves decide the time, so every corner should be reachable.
- **Exits** in Clear It work best along a whole edge, like the street. Small exits turn into puzzles, which can be fun later.
- **Tarps** work best near the middle, so players can sweep toward them from several sides.
- Set par times only after playing a yard a few times. Three stars should take some effort.

If a map has a problem, the game throws an error explaining what to fix, for example *"Pile It mode needs a "tarp" in the "goals" layer."*

## Stuck-leaf check

`npm test` also runs a **stuck-leaf lint** on every level and mode. It puts a leaf at every spot along every wall, edge and corner, and checks that the player can walk somewhere and blow it closer to the goal (allowing two blows, e.g. off the top of a shrub, then down). A failure lists the exact coordinates:

```
expected [ { x: 6.5, y: 2.5 }, … ] to deeply equal []
```

Find that spot in Tiled (the coordinates are in pixels) and open it up. The usual culprit is a dead-end nook narrower than the player, about 12 px. Fix the map instead of loosening the test.
