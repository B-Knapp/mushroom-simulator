// Environment update: water and dissolved nutrients in the soil grid.
//
// Moisture is stored as saturation (0..1 of pore space). Each step:
//   1. rain lands on the top surface cell of each column
//   2. gravity drains water above field capacity downward, faster in
//      permeable soil; water blocked below spreads sideways
//   3. capillary wicking evens out relative wetness between neighbors
//   4. evaporation dries the top few cells, more when warm and by day
//   5. the bottom rows are fed by a water table
//   6. food sources leach nutrients into touching soil while it's moist
//   7. dissolved nutrients slowly diffuse
//
// The model is deliberately simple: believable behavior at game scale,
// not hydrology.

import { GW, GH, ENV_EVERY_TICKS, SIM_DT_MIN } from '../config.js';
import { AIR, ROCK, FC, PERM } from '../soilTypes.js';

const STEP_MIN = ENV_EVERY_TICKS * SIM_DT_MIN; // simulated minutes per env step

// Rates below are per 30 simulated minutes; S scales them to the step length.
const S = STEP_MIN / 30;
const DRAIN_RATE = Math.min(0.9, 0.6 * S); // fraction of excess (x permeability) that drains per step
const SIDE_RATE = 0.2;      // sideways spill when blocked below
const WICK = Math.min(0.24, 0.22 * S); // capillary exchange coefficient (<= 0.25 for stability)
const EVAP_BASE = 0.0045 * S; // fraction lost per step at the very top, at 15°C, midday
const EVAP_DEPTH = [1, 0.55, 0.3, 0.16, 0.08, 0.04];
const WATER_TABLE = 0.92;   // bottom row kept at this fraction of field capacity
const NUTRIENT_DIFF = 0.04;
const WICK_EPS = 2e-5;      // rows moving less than this are considered at rest
const WICK_REFRESH = 8;     // recompute every row at least this often (steps)
const NUTRIENT_EVERY = Math.max(1, Math.round(4 / S)); // diffuse nutrients every ~2 sim hours

export function createEnvironment(world) {
  const N = GW * GH;
  const { type } = world;

  // Per-cell material constants, precomputed.
  const fc = new Float32Array(N);
  const perm = new Float32Array(N);
  const wet = new Uint8Array(N); // 1 if the cell holds water
  for (let i = 0; i < N; i++) {
    fc[i] = FC[type[i]];
    perm[i] = PERM[type[i]];
    wet[i] = type[i] !== AIR && type[i] !== ROCK ? 1 : 0;
  }

  // Pair permeabilities for right and down neighbors.
  const kRight = new Float32Array(N);
  const kDown = new Float32Array(N);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (!wet[i]) continue;
      if (x < GW - 1 && wet[i + 1]) kRight[i] = Math.min(perm[i], perm[i + 1]);
      if (y < GH - 1 && wet[i + GW]) kDown[i] = Math.min(perm[i], perm[i + GW]);
    }
  }

  // Precomputed wicking coefficients per pair and 1/fc per cell.
  const invFc = new Float32Array(N);
  const cRight = new Float32Array(N);
  const cDown = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!wet[i]) continue;
    invFc[i] = 1 / fc[i];
    if (kRight[i] > 0) cRight[i] = (fc[i] * fc[i + 1]) / (fc[i] + fc[i + 1]) * kRight[i] * WICK;
    if (kDown[i] > 0) cDown[i] = (fc[i] * fc[i + GW]) / (fc[i] + fc[i + GW]) * kDown[i] * WICK;
  }

  // Nutrient diffusion coefficients (zero across food or dry boundaries).
  const food = world.food;
  const nRight = new Float32Array(N);
  const nDown = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (food[i] !== -1) continue;
    if (kRight[i] > 0 && food[i + 1] === -1) nRight[i] = NUTRIENT_DIFF * (0.3 + kRight[i]);
    if (kDown[i] > 0 && food[i + GW] === -1) nDown[i] = NUTRIENT_DIFF * (0.3 + kDown[i]);
  }

  return {
    world, fc, perm, wet, kRight, kDown, invFc, cRight, cDown, nRight, nDown,
    // Row activity for wicking: rows at rest are skipped between refreshes.
    rowAct: new Float32Array(GH).fill(1),
    rowTouched: new Uint8Array(GH).fill(1),
    steps: 0,
    rain: 0,        // current rain intensity (saturation added per step at the surface)
    rainLeft: 0,    // simulated minutes of rain remaining
  };
}

// Air temperature at the surface, °C. Seasons arrive in Phase 4.
export function airTemp(minute) {
  const hour = (minute % 1440) / 60;
  return 12 + 5 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
}

// Soil temperature at a given depth below the soil line (in cells).
export function soilTemp(minute, depthCells) {
  const damp = Math.exp(-Math.max(0, depthCells) / 10);
  return 11 + (airTemp(minute) - 11) * damp;
}

export function startRain(env, hours = 8, intensity = 0.5 * S) {
  env.rain = intensity;
  env.rainLeft = hours * 60;
}

export function stepEnvironment(env, minute) {
  const { world, fc, wet, kRight, kDown } = env;
  const m = world.moisture;
  const surface = world.surface;

  // 1. Rain.
  if (env.rainLeft > 0) {
    // Ease in and out so showers don't start and stop abruptly.
    const t = Math.min(1, env.rainLeft / 60);
    const amt = env.rain * t;
    for (let x = 0; x < GW; x++) {
      // Water that can't fit in the top cell infiltrates a few cells down;
      // anything left after that runs off.
      let left = amt;
      for (let y = surface[x], d = 0; y < GH && d < 6 && left > 0; y++, d++) {
        const i = y * GW + x;
        if (!wet[i]) break;
        const put = Math.min(left, 1 - m[i]);
        m[i] += put;
        env.rowTouched[y] = 1;
        left -= put;
      }
    }
    env.rainLeft -= STEP_MIN;
    if (env.rainLeft <= 0) { env.rainLeft = 0; env.rain = 0; }
  }

  const touched = env.rowTouched;

  // 2. Gravity drainage, top-down so a wetting front can advance several
  //    cells per step in permeable soil.
  for (let y = 0; y < GH - 1; y++) {
    const row = y * GW;
    for (let x = 0; x < GW; x++) {
      const i = row + x;
      let ex = m[i] - fc[i]; // air and rock: 0 - 0, skipped here
      if (ex <= 0) continue;
      const j = i + GW;
      const k = kDown[i];
      if (k > 0) {
        const f = Math.min(ex * k * DRAIN_RATE, 1 - m[j]);
        if (f > 0) { m[i] -= f; m[j] += f; ex -= f; touched[y] = 1; touched[y + 1] = 1; }
      }
      // Blocked or slow below: spill sideways toward the drier neighbor.
      if (ex > 0.02 && (k === 0 || m[j] > 0.98)) {
        const l = x > 0 && wet[i - 1] ? i - 1 : -1;
        const r = x < GW - 1 && wet[i + 1] ? i + 1 : -1;
        const tgt = l < 0 ? r : r < 0 ? l : (m[l] < m[r] ? l : r);
        if (tgt >= 0 && m[tgt] < m[i]) {
          const f = Math.min(ex * SIDE_RATE, (m[i] - m[tgt]) / 2);
          m[i] -= f; m[tgt] += f;
          touched[y] = 1;
        }
      }
    }
  }
  // Deep drainage out of the bottom.
  {
    const row = (GH - 1) * GW;
    for (let x = 0; x < GW; x++) {
      const i = row + x;
      if (wet[i] && m[i] > fc[i]) m[i] -= (m[i] - fc[i]) * env.perm[i] * 0.5;
    }
  }

  // 3. Capillary wicking: exchange toward equal relative wetness (m / fc).
  //    Applied in place (each pair updates both cells immediately), which
  //    conserves water and avoids a second pass. Rows where nothing is
  //    moving are skipped, except on periodic refresh steps.
  {
    const { invFc, cRight, cDown, rowAct } = env;
    const refresh = env.steps % WICK_REFRESH === 0;
    for (let y = 0; y < GH; y++) {
      if (!refresh && !touched[y] && rowAct[y] < WICK_EPS &&
          (y === 0 || rowAct[y - 1] < WICK_EPS) && (y === GH - 1 || rowAct[y + 1] < WICK_EPS)) continue;
      let act = 0;
      const row = y * GW;
      const end = row + GW;
      const hasDown = y < GH - 1;
      for (let i = row; i < end; i++) {
        const cr = cRight[i], cd = cDown[i];
        if (cr === 0 && cd === 0) continue;
        if (cr !== 0) {
          const e = (m[i] * invFc[i] - m[i + 1] * invFc[i + 1]) * cr;
          m[i] -= e; m[i + 1] += e;
          const a = e < 0 ? -e : e; if (a > act) act = a;
        }
        if (cd !== 0 && hasDown) {
          const e = (m[i] * invFc[i] - m[i + GW] * invFc[i + GW]) * cd;
          m[i] -= e; m[i + GW] += e;
          const a = e < 0 ? -e : e; if (a > act) act = a;
        }
      }
      rowAct[y] = act;
    }
    touched.fill(0);
  }

  // 4. Evaporation from the top cells, stronger when warm and in daylight.
  {
    const T = airTemp(minute);
    const hour = (minute % 1440) / 60;
    const daylight = Math.max(0.15, Math.sin(((hour - 6) / 12) * Math.PI));
    const rate = env.rainLeft > 0 ? 0 : EVAP_BASE * Math.max(0.2, 1 + (T - 15) / 12) * daylight;
    for (let x = 0; x < GW; x++) {
      const top = surface[x];
      for (let d = 0; d < EVAP_DEPTH.length; d++) {
        const y = top + d;
        if (y >= GH) break;
        const i = y * GW + x;
        if (wet[i]) { m[i] -= m[i] * rate * EVAP_DEPTH[d]; touched[y] = 1; }
      }
    }
  }

  // 5. Water table keeps the bottom row damp.
  {
    const row = (GH - 1) * GW;
    for (let x = 0; x < GW; x++) {
      const i = row + x;
      if (wet[i] && m[i] < fc[i] * WATER_TABLE) { m[i] = fc[i] * WATER_TABLE; touched[GH - 1] = 1; }
    }
  }

  // 6. Leaching from food sources into touching soil.
  const n = world.nutrient;
  for (const f of world.foods) {
    if (f.stock <= 0) continue;
    for (let h = 0; h < f.halo.length; h++) {
      const i = f.halo[h];
      const add = Math.min(f.stock, f.leach * S * (m[i] / Math.max(0.05, fc[i])) * (1 - n[i]));
      if (add <= 0) continue;
      n[i] += add;
      f.stock -= add;
    }
  }

  // 7. Slow nutrient diffusion through water-holding soil.
  env.steps++;
  if (env.steps % NUTRIENT_EVERY === 0) diffuseNutrients(env);
}

function diffuseNutrients(env) {
  const { world, nRight, nDown } = env;
  const n = world.nutrient;
  for (let i = 0; i < n.length; i++) {
    const cr = nRight[i], cd = nDown[i];
    if (cr === 0 && cd === 0) continue;
    if (cr !== 0) { const e = (n[i] - n[i + 1]) * cr; n[i] -= e; n[i + 1] += e; }
    if (cd !== 0) { const e = (n[i] - n[i + GW]) * cd; n[i] -= e; n[i + GW] += e; }
  }
}
