// Global constants. 1 game unit = 1 metre in the game world.

/** Real metres per game metre, horizontal. The real sound is compressed 10:1. */
export const H_SCALE = 10;

/** Deepest point of the source data (m, real) and its depth in the game (m). */
export const REAL_MAX_DEPTH = 260;
export const GAME_MAX_DEPTH = 32;
/** Depth curve exponent (< 1 makes shallow areas deeper so more of the sound is navigable). */
export const DEPTH_GAMMA = 0.75;

export const WATER_LEVEL = 0;

/** Terrain chunks. */
export const CHUNK_SIZE = 128;
export const LOD0_RES = 2; // m between vertices
export const LOD1_RES = 8;
export const LOD0_RADIUS = 2; // chunks (Chebyshev)
export const LOD1_RADIUS = 6;

/** Boat. */
export const BOAT_DRAFT = 0.7;
export const BOAT_MAX_SPEED = 7.5; // m/s
export const KNOTS_PER_MS = 1.943844;

/** Towfish. */
export const CABLE_MAX = 90;
export const WINCH_RATE = 3.0; // m/s

/** Sonar. */
export const SONAR_BINS = 400; // per side
export const SONAR_HISTORY = 1400; // pings kept in memory

export function realToGameDepth(real: number): number {
  if (real <= 0) return 0;
  return GAME_MAX_DEPTH * Math.pow(real / REAL_MAX_DEPTH, DEPTH_GAMMA);
}

declare global {
  const __SINGLE_FILE__: boolean;
}
