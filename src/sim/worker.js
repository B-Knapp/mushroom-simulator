// Simulation worker. Owns all simulation state and advances it in fixed
// steps, independent of rendering. The main thread only sends commands
// (speed, reset, rain) and receives snapshots.

import { SIM_DT_MIN, SIM_MIN_PER_SEC_AT_1X, START_MINUTE, ENV_EVERY_TICKS, GW, GH } from '../config.js';
import { makeRng, subSeed } from '../rng.js';
import { generateWorld } from './world.js';
import { createEnvironment, stepEnvironment, startRain, airTemp } from './environment.js';

const LOOP_MS = 8;             // how often the loop wakes up
const BUDGET_MS = 10;          // max time spent ticking per wake-up
const SNAPSHOT_MS = 33;        // ~30 state snapshots per second
const GRIDS_MS = 120;          // moisture/nutrient grids ~8 per second
const MAX_BACKLOG_STEPS = 200; // drop time rather than spiral if we fall behind
const WARMUP_DAYS = 3;         // settle the water profile before play

let sim = null;
let speed = 1;
let accMin = 0;
let lastNow = 0;
let lastSnapshot = 0;
let lastGrids = 0;

// Rolling performance stats.
let tickMsAvg = 0;
let rateWindowStart = 0;
let rateWindowMin = 0;
let actualRate = 0;

function createSim(seed) {
  const world = generateWorld(seed);
  const env = createEnvironment(world);
  const s = {
    seed,
    rng: makeRng(subSeed(seed, 'sim')),
    minute: START_MINUTE - WARMUP_DAYS * 1440,
    ticks: 0,
    edges: 0, // fungal network edges (Phase 2+)
    world,
    env,
  };
  // Warm up without counting toward the visible clock.
  while (s.minute < START_MINUTE) tick(s);
  s.ticks = 0;
  return s;
}

function tick(s) {
  s.minute += SIM_DT_MIN;
  s.ticks++;
  if (s.ticks % ENV_EVERY_TICKS === 0) stepEnvironment(s.env, s.minute);
  // Later phases plug in here: growth, transport, organisms, seasons.
}

function sendWorld(s) {
  const w = s.world;
  postMessage({
    type: 'world',
    seed: s.seed,
    grid: { GW, GH },
    cellType: w.type,
    food: w.food,
    ground: w.ground,
    litterTop: w.litterTop,
    rocks: w.rocks,
    sandPolys: w.sandPolys,
    foods: w.foods.map(({ cells, halo, ...rest }) => rest),
  });
}

function toBytes(src, scale) {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] * scale;
    out[i] = v > 255 ? 255 : v;
  }
  return out;
}

function sendGrids(s) {
  const moisture = toBytes(s.world.moisture, 255);
  const nutrient = toBytes(s.world.nutrient, 255);
  postMessage({ type: 'grids', seed: s.seed, moisture, nutrient }, [moisture.buffer, nutrient.buffer]);
}

function loop() {
  const now = performance.now();
  const realDt = Math.min(250, now - lastNow);
  lastNow = now;

  if (sim && speed > 0) {
    accMin += (realDt / 1000) * speed * SIM_MIN_PER_SEC_AT_1X;
    accMin = Math.min(accMin, SIM_DT_MIN * MAX_BACKLOG_STEPS);

    const deadline = now + BUDGET_MS;
    let steps = 0;
    const t0 = performance.now();
    while (accMin >= SIM_DT_MIN && performance.now() < deadline) {
      tick(sim);
      accMin -= SIM_DT_MIN;
      steps++;
    }
    if (steps > 0) {
      const per = (performance.now() - t0) / steps;
      tickMsAvg = tickMsAvg * 0.9 + per * 0.1;
      rateWindowMin += steps * SIM_DT_MIN;
    }
  }

  if (now - rateWindowStart >= 1000) {
    actualRate = rateWindowMin / SIM_MIN_PER_SEC_AT_1X / ((now - rateWindowStart) / 1000);
    rateWindowStart = now;
    rateWindowMin = 0;
  }

  if (sim && now - lastSnapshot >= SNAPSHOT_MS) {
    lastSnapshot = now;
    postMessage({
      type: 'state',
      seed: sim.seed,
      minute: sim.minute,
      ticks: sim.ticks,
      edges: sim.edges,
      speed,
      actualRate: speed > 0 ? actualRate : 0,
      tickMs: tickMsAvg,
      raining: sim.env.rainLeft > 0,
      rainLeft: sim.env.rainLeft,
      airTemp: airTemp(sim.minute),
    });
  }

  if (sim && now - lastGrids >= GRIDS_MS) {
    lastGrids = now;
    sendGrids(sim);
  }

  setTimeout(loop, LOOP_MS);
}

onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
    case 'reset':
      sim = createSim(msg.seed);
      accMin = 0;
      lastSnapshot = 0;
      lastGrids = 0;
      sendWorld(sim);
      break;
    case 'speed':
      speed = msg.value;
      accMin = 0;
      rateWindowMin = 0;
      rateWindowStart = performance.now();
      break;
    case 'rain':
      if (sim) startRain(sim.env, msg.hours ?? 8);
      break;
  }
};

lastNow = performance.now();
rateWindowStart = lastNow;
loop();
