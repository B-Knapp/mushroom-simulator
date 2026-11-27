// The fungal network: a graph of nodes (junctions, tips, contact points)
// and edges (cords). Phase 2 covers growth only: a spore germinates,
// tips explore by sensing the soil just ahead, branch more where it's
// rich, and fuse with other threads to form loops. Growth is paid for
// from a single biomass pool that the network fills by absorbing
// nutrients. (Phase 3 replaces the pool with real transport.)
//
// Positions are in world units; one grid cell is CELL units.

import { GW, GH, CELL, WORLD_W, WORLD_H, SIM_DT_MIN } from '../config.js';
import { AIR, ROCK, SOIL, FC } from '../soilTypes.js';
import { soilTemp } from './environment.js';

// --- Growth tuning -------------------------------------------------------------
const SEG = 6;               // world units per segment
const BASE_SPEED = 2.6;      // units per simulated hour in ideal conditions
const SEG_COST = 1.0;        // biomass per new segment
const SPORE_RESERVE = 45;    // biomass a spore starts with
const UPKEEP = 0.0006;       // biomass per edge per hour
const SENSE_DIST = 14;       // how far ahead a tip samples, units
const TURN_STEPS = [-0.45, -0.22, 0, 0.22, 0.45];
const BRANCH_BASE = 0.06;    // branch chance per segment in poor soil
const BRANCH_RICH = 0.5;     // extra branch chance per unit of local nutrient
const BRANCH_FOOD = 0.22;    // extra branch chance inside food
const MAX_TIPS = 600;
const CROWD_LIMIT = 5;       // nodes per cell above which tips won't branch
const FUSE_RADIUS = 4.5;
const FUSE_CHANCE = 0.65;
const FUSE_MIN_SEGS = 6;     // a new tip can't fuse until it has grown this far

// --- Feeding ---------------------------------------------------------------------
const ABSORB = 0.03;         // per node per hour, scaled by nutrient^1.3
const ABSORB_YIELD = 6;      // biomass per unit of soil nutrient
const FOOD_RATE = 0.005;     // stock consumed per node in food per hour
const FOOD_YIELD = 6;        // biomass per unit of food stock
const STORE_BASE = 40;       // biomass the network can hold, plus...
const STORE_PER_EDGE = 0.35; // ...this much per edge
const FED_BRANCH = 2;        // up to 3x branching when the store is full

export function createNetwork(world) {
  return {
    world,
    // Nodes (growable typed arrays).
    nx: new Float32Array(4096),
    ny: new Float32Array(4096),
    nOwner: new Int32Array(4096),   // tip id that created the node
    nSeq: new Int32Array(4096),     // that tip's segment number
    nBorn: new Float32Array(4096),  // minute created
    nodeCount: 0,
    // Edges.
    ea: new Int32Array(4096),
    eb: new Int32Array(4096),
    eBorn: new Float32Array(4096),
    edgeCount: 0,
    // Spatial hash by grid cell: linked lists of nodes.
    head: new Int32Array(GW * GH).fill(-1),
    next: new Int32Array(4096),
    density: new Uint16Array(GW * GH),
    tips: [],
    nextTipId: 1,
    pool: 0,
    spore: null,
    fusions: 0,
    version: 0,
  };
}

// --- Planting and germination ------------------------------------------------------

export function plantSpore(net, x, y, minute) {
  if (net.spore) return false;
  const c = cellAt(x, y);
  if (c < 0) return false;
  const t = net.world.type[c];
  if (t === AIR || t === ROCK) return false;
  net.spore = { x, y, germinated: false, wetHours: 0, planted: minute };
  net.pool = SPORE_RESERVE;
  net.version++;
  return true;
}

function germinate(net, rng, minute) {
  const s = net.spore;
  s.germinated = true;
  const root = addNode(net, s.x, s.y, 0, 0, minute);
  const n = 4;
  const a0 = rng() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    addTip(net, root, a0 + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3));
  }
  net.version++;
}

// --- Per-tick growth -----------------------------------------------------------------

export function stepNetwork(net, rng, minute) {
  const s = net.spore;
  if (!s || !s.germinated) return;
  const dtH = SIM_DT_MIN / 60;
  const w = net.world;
  const tips = net.tips;
  let active = 0;
  for (const t of tips) if (!t.dead) active++;

  for (let k = 0; k < tips.length; k++) {
    const tip = tips[k];
    if (tip.dead) continue;
    const x = net.nx[tip.node], y = net.ny[tip.node];
    const c = cellAt(x, y);
    const f = growthFactor(w, c, y, minute);
    tip.dormant = f < 0.05;
    if (tip.dormant || net.pool < SEG_COST) continue;

    tip.acc += BASE_SPEED * f * dtH;
    if (tip.acc < SEG) continue;
    tip.acc -= SEG;

    // Choose a direction by sensing ahead.
    let best = -Infinity, bestAng = tip.ang;
    for (const d of TURN_STEPS) {
      const a = tip.ang + d + rng.range(-0.08, 0.08);
      const sx = x + Math.cos(a) * SENSE_DIST, sy = y + Math.sin(a) * SENSE_DIST;
      const px = x + Math.cos(a) * SEG, py = y + Math.sin(a) * SEG;
      if (!passable(w, px, py)) continue;
      const score = senseScore(net, sx, sy, minute) + Math.cos(d) * 1.2 + rng() * 0.35;
      if (score > best) { best = score; bestAng = a; }
    }
    if (best === -Infinity) {
      // Blocked: swing around and try again next segment.
      tip.ang += rng() < 0.5 ? 1.2 : -1.2;
      if (++tip.blocked > 6) tip.dead = true;
      continue;
    }
    tip.blocked = 0;
    tip.ang = bestAng;
    const px = x + Math.cos(bestAng) * SEG, py = y + Math.sin(bestAng) * SEG;

    // Fusion with another thread (anastomosis).
    if (tip.segs >= FUSE_MIN_SEGS) {
      const j = findFusion(net, tip, px, py);
      if (j >= 0 && rng() < FUSE_CHANCE) {
        addEdge(net, tip.node, j, minute);
        tip.dead = true;
        net.fusions++;
        net.version++;
        continue;
      }
    }

    tip.segs++;
    const nd = addNode(net, px, py, tip.id, tip.segs, minute);
    addEdge(net, tip.node, nd, minute);
    tip.node = nd;
    net.pool -= SEG_COST;
    net.version++;

    // Branching: more where it's rich, less where it's crowded.
    const pc = cellAt(px, py);
    if (active < MAX_TIPS && pc >= 0 && net.density[pc] < CROWD_LIMIT && tip.segs - tip.lastBranch > 2) {
      const n = w.nutrient[pc];
      const inFood = w.food[pc] !== -1;
      const fed = 1 + FED_BRANCH * Math.min(1, net.pool / storeCap(net));
      const p = (BRANCH_BASE + BRANCH_RICH * n + (inFood ? BRANCH_FOOD : 0)) * fed;
      if (rng() < p) {
        const side = rng() < 0.5 ? -1 : 1;
        addTip(net, nd, tip.ang + side * rng.range(0.5, 1.1));
        tip.lastBranch = tip.segs;
        active++;
      }
    }
  }

  // Drop dead tips now and then so the list doesn't grow forever.
  if (tips.length > 64 && tips.length > active * 2) net.tips = tips.filter((t) => !t.dead);
}

// --- Hourly: germination check, feeding, upkeep ------------------------------------------

export function hourlyNetwork(net, rng, minute) {
  const s = net.spore;
  if (!s) return;
  const w = net.world;

  if (!s.germinated) {
    const c = cellAt(s.x, s.y);
    const rel = w.moisture[c] / Math.max(0.2, FC[w.type[c]]);
    if (rel > 0.45 && soilTemp(minute, 0) > 4) s.wetHours++;
    if (s.wetHours >= 4) germinate(net, rng, minute);
    return;
  }

  // Feeding: each node absorbs from its cell. Nodes inside wood or leaf
  // piles digest the food itself (this fungus is a decomposer).
  const n = w.nutrient, m = w.moisture, food = w.food;
  const cap = storeCap(net);
  for (let i = 0; i < net.nodeCount; i++) {
    if (net.pool >= cap) break; // full: no more uptake this hour
    const c = cellAt(net.nx[i], net.ny[i]);
    if (c < 0) continue;
    const wet = Math.min(1, m[c] / Math.max(0.2, FC[w.type[c]]));
    const fid = food[c];
    if (fid !== -1) {
      const f = w.foods[fid];
      if (f.stock > 0) {
        const take = Math.min(f.stock, FOOD_RATE * wet);
        f.stock -= take;
        net.pool += take * FOOD_YIELD;
      }
    } else if (n[c] > 0.002) {
      const take = Math.min(n[c], ABSORB * Math.pow(n[c], 1.3) * wet);
      n[c] -= take;
      net.pool += take * ABSORB_YIELD;
    }
  }

  // Upkeep: living cords cost something to maintain.
  net.pool = Math.max(0, net.pool - net.edgeCount * UPKEEP);
}

// --- Snapshot for the renderer ---------------------------------------------------------

export function networkSnapshot(net) {
  const tipsArr = [];
  for (const t of net.tips) {
    if (t.dead) continue;
    tipsArr.push(net.nx[t.node], net.ny[t.node], t.dormant ? 1 : 0);
  }
  return {
    nodeX: net.nx.slice(0, net.nodeCount),
    nodeY: net.ny.slice(0, net.nodeCount),
    nodeBorn: net.nBorn.slice(0, net.nodeCount),
    edgeA: net.ea.slice(0, net.edgeCount),
    edgeB: net.eb.slice(0, net.edgeCount),
    edgeBorn: net.eBorn.slice(0, net.edgeCount),
    tips: Float32Array.from(tipsArr),
    spore: net.spore ? { x: net.spore.x, y: net.spore.y, germinated: net.spore.germinated } : null,
  };
}

export function networkStats(net) {
  let active = 0, dormant = 0;
  for (const t of net.tips) {
    if (t.dead) continue;
    if (t.dormant) dormant++; else active++;
  }
  return {
    nodes: net.nodeCount, edges: net.edgeCount, tips: active, dormant,
    pool: net.pool, fusions: net.fusions,
    spore: net.spore ? (net.spore.germinated ? 'germinated' : 'waiting') : 'none',
  };
}

// --- Helpers ---------------------------------------------------------------------------

function storeCap(net) {
  return STORE_BASE + net.edgeCount * STORE_PER_EDGE;
}

function cellAt(x, y) {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return -1;
  return ((y / CELL) | 0) * GW + ((x / CELL) | 0);
}

function passable(w, x, y) {
  const c = cellAt(x, y);
  if (c < 0) return false;
  const t = w.type[c];
  return t !== AIR && t !== ROCK;
}

// How fast a tip can grow here, 0..1: moisture, temperature, soil resistance.
function growthFactor(w, c, y, minute) {
  if (c < 0) return 0;
  const t = w.type[c];
  const sat = w.moisture[c];
  const rel = sat / Math.max(0.2, FC[t]);
  let fm = smooth(0.3, 0.75, rel);
  if (sat > 0.95) fm *= 0.5; // waterlogged
  const depth = y / CELL - 30;
  const T = soilTemp(minute, depth);
  const fT = Math.max(0, Math.min(1, (T - 3) / 17));
  const fR = 1 - SOIL[t].resist * 0.75;
  // Oxygen runs short deep in the soil.
  const fO = 1 - smooth(45, 140, depth) * 0.85;
  return fm * fT * fR * fO;
}

// Desirability of a point ahead of a tip.
function senseScore(net, x, y, minute) {
  const w = net.world;
  const c = cellAt(x, y);
  if (c < 0) return -3;
  const t = w.type[c];
  if (t === AIR || t === ROCK) return -2.5;
  const rel = w.moisture[c] / Math.max(0.2, FC[t]);
  let s = 3.0 * w.nutrient[c];
  if (w.food[c] !== -1) s += 2.0;
  s += 0.8 * Math.min(1, rel);
  s -= 1.1 * SOIL[t].resist;
  s -= 0.35 * Math.min(6, net.density[c]);
  s -= 0.012 * Math.max(0, y / CELL - 40); // prefers the aerated upper soil
  return s;
}

function findFusion(net, tip, x, y) {
  const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
  const r2 = FUSE_RADIUS * FUSE_RADIUS;
  let best = -1, bestD = r2;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = gy + dy;
    if (yy < 0 || yy >= GH) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = gx + dx;
      if (xx < 0 || xx >= GW) continue;
      for (let j = net.head[yy * GW + xx]; j !== -1; j = net.next[j]) {
        if (j === tip.node) continue;
        if (net.nOwner[j] === tip.id && tip.segs - net.nSeq[j] < 15) continue;
        if (net.nOwner[j] === tip.parentId && Math.abs(net.nSeq[j] - tip.branchSeq) < 6) continue;
        const ddx = net.nx[j] - x, ddy = net.ny[j] - y;
        const d = ddx * ddx + ddy * ddy;
        if (d < bestD) { bestD = d; best = j; }
      }
    }
  }
  return best;
}

function addTip(net, node, ang) {
  net.tips.push({
    id: net.nextTipId++,
    parentId: net.nOwner[node],
    branchSeq: net.nSeq[node],
    node, ang, acc: 0, segs: 0, lastBranch: 0, blocked: 0, dormant: false, dead: false,
  });
}

function addNode(net, x, y, owner, seq, minute) {
  if (net.nodeCount === net.nx.length) growNodes(net);
  const i = net.nodeCount++;
  net.nx[i] = x; net.ny[i] = y;
  net.nOwner[i] = owner; net.nSeq[i] = seq; net.nBorn[i] = minute;
  const c = cellAt(x, y);
  net.next[i] = net.head[c];
  net.head[c] = i;
  if (net.density[c] < 65535) net.density[c]++;
  return i;
}

function addEdge(net, a, b, minute) {
  if (net.edgeCount === net.ea.length) {
    net.ea = grow(net.ea); net.eb = grow(net.eb); net.eBorn = grow(net.eBorn);
  }
  const e = net.edgeCount++;
  net.ea[e] = a; net.eb[e] = b; net.eBorn[e] = minute;
  return e;
}

function growNodes(net) {
  net.nx = grow(net.nx); net.ny = grow(net.ny);
  net.nOwner = grow(net.nOwner); net.nSeq = grow(net.nSeq);
  net.nBorn = grow(net.nBorn); net.next = grow(net.next);
}

function grow(arr) {
  const out = new arr.constructor(arr.length * 2);
  out.set(arr);
  return out;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
