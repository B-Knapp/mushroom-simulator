// Shared constants used by both the main thread and the simulation worker.

// World size in world units. One unit is one screen pixel at zoom 1.
// The world is about 3-4 screens wide and starts zoomed to fit.
export const WORLD_W = 3200;
export const WORLD_H = 800;

// Height of the strip above the soil line (air + leaf litter).
export const SURFACE_Y = 60;

// Environment grid cell size in world units (used from Phase 1).
export const CELL = 4;

// Fixed simulation step, in simulated minutes.
export const SIM_DT_MIN = 5;

// At 1x, one real second is this many simulated minutes (1 sim hour).
export const SIM_MIN_PER_SEC_AT_1X = 60;

export const SPEEDS = [0, 1, 10, 100];

// Simulation starts on day 1 at this time.
export const START_MINUTE = 6 * 60;
