/**
 * Every number that affects game feel lives here.
 *
 * Units: pixels, seconds, px/s (speed), px/s² (acceleration).
 * Changing any value changes run times, so leaderboard data recorded
 * under old values should be treated as a separate season.
 */

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const PLAYER_RADIUS = 5;
export const PLAYER_SPEED = 72;
/**
 * One-thumb play: walking within ±45° of straight backwards keeps the
 * blower aimed ahead (cos 135° ≈ -0.7). Set to -2 to turn this off.
 */
export const BACK_UP_COS = -0.7;

/** How far in front of the player's centre the air comes out. */
export const NOZZLE_OFFSET = 7;
export const BLOWER_RANGE = 62;
/** cos(half-angle) of the air cone. 0.88 ≈ 28°. */
export const BLOWER_COS_HALF = 0.88;
/** Acceleration applied to a dry leaf right at the nozzle, centre of the cone. */
export const BLOWER_POWER = 1500;
/** Within this distance of the nozzle the air catches leaves in a wider arc. */
export const NEAR_WASH = 13;
/** Standing still revs the engine to full in this long; walking drops it in REV_DOWN_S. */
export const REV_UP_S = 1;
export const REV_DOWN_S = 0.25;
/** At full revs: extra power, extra reach, and a wider cone (lower cos of half-angle). */
export const REV_POWER = 0.5;
export const REV_RANGE = 0.25;
export const REV_WIDEN = 0.06;
/** Aim stick: a light push gives this much power… */
export const THROTTLE_MIN = 0.3;
/** …and this fraction of the reach; full power from this much push. */
export const THROTTLE_RANGE = 0.6;
export const THROTTLE_FULL = 0.9;

/** 0 = air pushes straight along the aim, 1 = pushes radially away from the nozzle. */
export const BLOWER_SPREAD = 0.3;

export const LEAF_RADIUS = 1.5;
export const LEAF_MAX_SPEED = 230;
/** Below this speed a leaf with no strong force on it comes to rest. */
export const LEAF_REST_SPEED = 4;
/** Fraction of speed kept when bouncing off walls. */
export const LEAF_BOUNCE = 0.35;

/** When the air stream hits a wall it reflects as a wider, weaker cone. */
export const BOUNCE_COS_HALF = 0.72;
/** Fraction of the remaining range and power the reflected cone keeps. */
export const BOUNCE_RANGE = 0.8;
export const BOUNCE_POWER = 0.65;

/** Air hitting a wall within this distance of a leaf bounces off it… */
export const WALL_DEFLECT_DIST = 3;
/** …keeping this fraction of the push (0 = absorbed, 1 = perfect bounce). */
export const WALL_DEFLECT = 0.8;
/** Extra push straight off a wall for leaves lying against it, as a fraction of the air's push. */
export const WALL_LIFT = 0.3;

export const WET_MASS = 1.7;
export const WET_GRIP = 1.3;

/** Max extra wind acceleration during a gust, scaled by weather gustiness. */
export const GUST_ACCEL = 70;
export const GUST_MIN_GAP_S = 2.5;
export const GUST_MAX_GAP_S = 6;
export const GUST_MIN_LEN_S = 0.8;
export const GUST_MAX_LEN_S = 2;

export const SURFACES = ['grass', 'pavement', 'mulch', 'gravel'] as const;
export type Surface = (typeof SURFACES)[number];

export interface SurfaceTuning {
  /** Fraction of velocity lost per second while sliding. */
  drag: number;
  /** A resting leaf ignores any push weaker than this (px/s²). */
  grip: number;
}

/** Indexed by position in SURFACES. */
export const SURFACE_TUNING: readonly SurfaceTuning[] = [
  { drag: 3.2, grip: 55 }, // grass
  { drag: 1.1, grip: 14 }, // pavement
  { drag: 6.5, grip: 220 }, // mulch: leaves get stuck in flower beds
  { drag: 2.4, grip: 40 }, // gravel
];
