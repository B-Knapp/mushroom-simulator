// Simulation worker. Owns all simulation state and advances it in fixed
// steps, independent of rendering. The main thread only sends commands
// (speed, reset) and receives snapshots.

import { SIM_DT_MIN, SIM_MIN_PER_SEC_AT_1X, START_MINUTE } from '../config.js';
import { makeRng, subSeed } from '../rng.js';

const LOOP_MS = 8;            // how often the loop wakes up
const BUDGET_MS = 10;         // max time spent ticking per wake-up
const SNAPSHOT_MS = 33;       // ~30 snapshots per second
const MAX_BACKLOG_STEPS = 200; // drop time rather than spiral if we fall behind

let sim = null;
let speed = 1;
let accMin = 0;
let lastNow = 0;
let lastSnapshot = 0;

// Rolling performance stats.
let tickMsAvg = 0;
let rateWindowStart = 0;
let rateWindowMin = 0;
let actualRate = 0; // achieved speed multiplier

function createSim(seed) {
  return {
    seed,
    rng: makeRng(subSeed(seed, 'sim')),
    minute: START_MINUTE, // simulated minutes since day 1, 00:00
    ticks: 0,
    edges: 0,             // fungal network edges (Phase 2+)
  };
}

function tick(s) {
  // Phase 0: only the clock advances. Systems plug in here later:
  // environment, growth, transport, organisms, seasons.
  s.minute += SIM_DT_MIN;
  s.ticks++;
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
    });
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
      break;
    case 'speed':
      speed = msg.value;
      accMin = 0;
      rateWindowMin = 0;
      rateWindowStart = performance.now();
      break;
  }
};

lastNow = performance.now();
rateWindowStart = lastNow;
loop();
