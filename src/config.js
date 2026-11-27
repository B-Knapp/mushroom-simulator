// Shared constants used by both the main thread and the simulation worker.

// World size in world units. One unit is one screen pixel at zoom 1.
// The world is about 3-4 screens wide and starts zoomed to fit.
export const WORLD_W = 3200;
export const WORLD_H = 1000;

// Environment grid: one cell is CELL x CELL world units.
export const CELL = 4;
export const GW = WORLD_W / CELL; // 800 columns
export const GH = WORLD_H / CELL; // 250 rows

// Average soil line (top of mineral soil), in grid rows. Above it are
// leaf litter and air, with room for a fallen log and, later, mushrooms.
export const GROUND_ROW = 30;

// Fixed simulation step, in simulated minutes.
export const SIM_DT_MIN = 5;

// The environment (water, nutrients) updates every this many ticks.
export const ENV_EVERY_TICKS = 12; // 1 simulated hour

// At 1x, one real second is this many simulated minutes (1 sim hour).
export const SIM_MIN_PER_SEC_AT_1X = 60;

export const SPEEDS = [0, 1, 10, 100];

// Simulation starts on day 1 at this time.
export const START_MINUTE = 6 * 60;
