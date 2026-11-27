// The fungal network: a graph of nodes (junctions, tips, contact points)
// and edges (cords).
//
// Growth: a spore germinates; tips explore by sensing the soil just
// ahead (nutrients, food scent, moisture, resistance, crowding) and
// branch more where it's rich; tips that meet another thread can fuse
// with it, forming loops.
//
// Resources: the network keeps a shared store of biomass, filled by
// digesting food (and, weakly, from the soil) and spent on growth and
// upkeep. Supply has to travel, though: each growing tip draws on the
// easiest route back to a food source. Routes that many tips depend on
// carry more, thicken into highways and get easier still; branches that
// no longer lead to a growing tip carry nothing, thin out and die back.
// A tip at the end of a long, thin supply line grows slowly.
//
// Positions are in world units; one grid cell is CELL units.

import { GW, GH, CELL, WORLD_W, WORLD_H, SIM_DT_MIN, ENV_EVERY_TICKS } from '../config.js';
import { AIR, ROCK, SOIL, FC } from '../soilTypes.js';
import { soilTemp } from './environment.js';

// --- Growth ------------------------------------------------------------------
const SEG = 6;               // world units per segment
const BASE_SPEED = 3.4;      // units per simulated hour in ideal conditions
const SEG_COST = 0.6;        // biomass per new segment
const SPORE_RESERVE = 30;    // biomass a spore starts with
const SENSE_DIST = 14;       // how far ahead a tip samples, units
const TURN_STEPS = [-0.45, -0.22, 0, 0.22, 0.45];
const BRANCH_BASE = 0.05;    // branch chance per segment in poor soil
const BRANCH_RICH = 0.5;     // extra branch chance per unit of local nutrient
const BRANCH_FOOD = 0.2;     // extra branch chance inside food
const FED_BRANCH = 2;        // up to 3x branching when well fed and well supplied
const MAX_TIPS = 500;
const CROWD_LIMIT = 5;       // nodes per cell above which tips won't branch
const FUSE_RADIUS = 4.5;
const FUSE_CHANCE = 0.65;
const FUSE_MIN_SEGS = 6;     // a new tip can't fuse until it has grown this far

// The slow step (feeding, routes, upkeep, adaptation) runs with the
// environment, every SLOW_H simulated hours; per-hour rates are scaled by it.
const SLOW_H = (ENV_EVERY_TICKS * SIM_DT_MIN) / 60;

// --- Feeding and upkeep (per hour) ----------------------------------------------
const ABSORB = 0.02;         // per node, scaled by nutrient^1.5 and wetness
const ABSORB_YIELD = 6;      // biomass per unit of soil nutrient
const FOOD_RATE = 0.0035;    // food stock digested per node in food
const FOOD_YIELD = 6;        // biomass per unit of food stock
const STORE_BASE = 30;       // biomass the network can hold, plus...
const STORE_PER_EDGE = 0.3;  // ...this much per cord
const UPKEEP = 0.00025;      // biomass per unit thickness per segment length

// --- Supply routes and adaptation ------------------------------------------------
const ROUTE_EVERY = 3;       // recompute supply routes every N slow steps
const RES0 = 500;            // route resistance at which a tip grows at half speed
const UNREACHED_EFF = 0.3;   // growth efficiency of tips cut off from food
const D_NEW = 0.55;          // thickness of a new cord
const D_MIN = 0.3;           // floor thickness with no use
const D_DIE = 0.4;           // cords thinner than this (and old enough) die
const D_MAX = 4.0;
const D_GAIN = 2.2;          // target thickness = D_MIN + D_GAIN * sqrt(flow per hour)
const THICKEN = 0.06;        // per hour, toward a thicker target
const THIN = 0.006;          // per hour, toward a thinner target (unused cords fade over weeks)
const GRACE_H = 48;          // young cords can't die

// --- Food scent (coarse field) -------------------------------------------------------
const SC = 4;                // coarse cell = 4x4 grid cells (16 units)
const SW = Math.ceil(GW / SC), SH = Math.ceil(GH / SC);
const SCENT_RANGE = 900;     // units
const SCENT_WEIGHT = 6;
const SCENT_EVERY_H = 12;

export function createNetwork(world) {
  const cap = 4096;
  return {
    world,
    // Nodes.
    nx: new Float32Array(cap), ny: new Float32Array(cap),
    nOwner: new Int32Array(cap), nSeq: new Int32Array(cap),
    nBorn: new Float32Array(cap),
    nDeg: new Int16Array(cap), nAlive: new Uint8Array(cap),
    next: new Int32Array(cap),
    nodeCount: 0, deadNodes: 0,
    // Edges, in creation order.
    ea: new Int32Array(cap), eb: new Int32Array(cap),
    eLen: new Float32Array(cap), eD: new Float32Array(cap),
    eQ: new Float32Array(cap), eBorn: new Float32Array(cap),
    // When each cord started and finished growing (sim minutes), and which tip grew it,
    // so the renderer can replay growth smoothly.
    eT0: new Float32Array(cap), eT1: new Float32Array(cap), eOwner: new Int32Array(cap),
    edgeCount: 0, deadEdges: 0,
    // Spatial hash by grid cell.
    head: new Int32Array(GW * GH).fill(-1),
    density: new Uint16Array(GW * GH),
    scent: new Float32Array(SW * SH),
    tips: [],
    nextTipId: 1,
    pool: 0,
    root: -1,
    spore: null,
    fusions: 0,
    hours: 0,
    routeHours: 0,
    slowSteps: 0,
    version: 0,
    minute: 0,
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
  net.version++;
  return true;
}

function germinate(net, rng, minute) {
  const s = net.spore;
  s.germinated = true;
  net.minute = minute;
  const root = addNode(net, s.x, s.y, 0, 0, minute);
  net.root = root;
  net.pool = SPORE_RESERVE;
  const n = 4;
  const a0 = rng() * Math.PI * 2;
  for (let k = 0; k < n; k++) addTip(net, root, a0 + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3));
  computeScent(net);
  net.version++;
}

// --- Per tick: growth ------------------------------------------------------------------

export function stepNetwork(net, rng, minute) {
  const s = net.spore;
  if (!s || !s.germinated) return;
  const dtH = SIM_DT_MIN / 60;
  const w = net.world;
  net.minute = minute;
  const tips = net.tips;
  let active = 0;
  for (const t of tips) if (!t.dead) active++;

  for (let k = 0; k < tips.length; k++) {
    const tip = tips[k];
    if (tip.dead) continue;
    if (!net.nAlive[tip.node]) { tip.dead = true; continue; }
    const x = net.nx[tip.node], y = net.ny[tip.node];
    const c = cellAt(x, y);
    const f = growthFactor(w, c, y, minute);
    tip.dormant = f < 0.05;
    // Growth needs biomass in the store, and is slower at the end of a
    // long, thin supply line.
    tip.starved = net.pool < SEG_COST;
    tip.rate = tip.dormant || tip.starved ? 0 : BASE_SPEED * f * tip.eff; // units/hour
    // How long it's been stalled, so brief stalls don't make it flicker.
    tip.idleH = tip.rate === 0 ? (tip.idleH || 0) + dtH : 0;
    if (tip.rate === 0) continue;

    tip.acc += tip.rate * dtH;
    if (tip.acc < SEG) continue;
    tip.acc -= SEG;
    // When, within this tick, the segment was actually finished.
    const t1 = minute - (tip.acc / tip.rate) * 60;
    const t0 = tip.segStart ?? t1;
    tip.segStart = t1;

    // The direction was chosen when this segment started, so what's drawn
    // while it grows is where it ends up. (Re-choose if it's now blocked.)
    let px = x + Math.cos(tip.ang) * SEG, py = y + Math.sin(tip.ang) * SEG;
    if (!passable(w, px, py)) {
      tip.acc = 0;
      if (!chooseDirection(net, tip, x, y, rng) && ++tip.blocked > 6) tip.dead = true;
      continue;
    }

    // Fusion with another thread (anastomosis).
    if (tip.segs >= FUSE_MIN_SEGS) {
      const j = findFusion(net, tip, px, py);
      if (j >= 0 && rng() < FUSE_CHANCE) {
        const fe = addEdge(net, tip.node, j, Math.hypot(net.nx[j] - x, net.ny[j] - y), minute);
        setEdgeTiming(net, fe, t0, t1, tip.id);
        tip.dead = true;
        net.fusions++;
        net.version++;
        continue;
      }
    }

    // Extend. A new cord starts a little thinner than the one behind it.
    tip.segs++;
    const nd = addNode(net, px, py, tip.id, tip.segs, minute);
    const ne = addEdge(net, tip.node, nd, SEG, minute);
    setEdgeTiming(net, ne, t0, t1, tip.id);
    if (tip.lastEdge >= 0 && net.ea[tip.lastEdge] >= 0) net.eD[ne] = Math.max(D_NEW, net.eD[tip.lastEdge] * 0.85);
    tip.lastEdge = ne;
    tip.node = nd;
    tip.spent += SEG_COST;
    net.pool -= SEG_COST;
    net.version++;
    // Pick the direction of the next segment now, sensing ahead.
    if (!chooseDirection(net, tip, px, py, rng)) tip.blocked++;

    // Branching: more where it's rich and the tip is well supplied.
    const pc = cellAt(px, py);
    if (active < MAX_TIPS && pc >= 0 && net.density[pc] < CROWD_LIMIT && tip.segs - tip.lastBranch > 2) {
      const inFood = w.food[pc] !== -1 && w.cellStock[pc] > 0;
      const fed = 1 + FED_BRANCH * Math.min(1, net.pool / storeCap(net)) * tip.eff;
      const p = (BRANCH_BASE + BRANCH_RICH * w.nutrient[pc] + (inFood ? BRANCH_FOOD : 0)) * fed;
      if (rng() < p) {
        const side = rng() < 0.5 ? -1 : 1;
        addTip(net, nd, tip.ang + side * rng.range(0.5, 1.1), tip.eff);
        tip.lastBranch = tip.segs;
        active++;
      }
    }
  }

  if (tips.length > 64 && tips.length > active * 2) net.tips = tips.filter((t) => !t.dead);
}

// --- Slow step: germination, feeding, routes, upkeep, adaptation ----------------------------

export function hourlyNetwork(net, rng, minute) {
  const s = net.spore;
  if (!s) return;
  const w = net.world;

  if (!s.germinated) {
    const c = cellAt(s.x, s.y);
    const rel = w.moisture[c] / Math.max(0.2, FC[w.type[c]]);
    if (rel > 0.45 && soilTemp(minute, 0) > 4) s.wetHours += SLOW_H;
    if (s.wetHours >= 4) germinate(net, rng, minute);
    return;
  }
  net.hours += SLOW_H;

  feed(net);
  if (net.slowSteps++ % ROUTE_EVERY === 0) route(net);
  upkeepAndAdapt(net, minute);
  if (net.hours % SCENT_EVERY_H < SLOW_H) computeScent(net);
  if (net.deadEdges > 256 && net.deadEdges > net.edgeCount * 0.2) compactEdges(net);
  if (net.deadNodes > 2048 && net.deadNodes > net.nodeCount * 0.35) compactNodes(net);
}

// Nodes absorb from their cell; inside wood or leaf litter they digest the
// food itself (this fungus is a decomposer).
function feed(net) {
  const w = net.world;
  const n = w.nutrient, m = w.moisture, food = w.food, stock = w.cellStock;
  const cap = storeCap(net);
  for (let i = 0; i < net.nodeCount; i++) {
    if (net.pool >= cap) break; // full: no more uptake this step
    if (!net.nAlive[i]) continue;
    const c = cellAt(net.nx[i], net.ny[i]);
    if (c < 0) continue;
    const wet = Math.min(1, m[c] / Math.max(0.2, FC[w.type[c]]));
    const fid = food[c];
    if (fid !== -1 && stock[c] > 0) {
      const take = Math.min(stock[c], FOOD_RATE * SLOW_H * wet);
      stock[c] -= take;
      w.foods[fid].stock -= take;
      net.pool += take * FOOD_YIELD;
    } else if (n[c] > 0.002) {
      const take = Math.min(n[c], ABSORB * SLOW_H * n[c] * Math.sqrt(n[c]) * wet);
      n[c] -= take;
      net.pool += take * ABSORB_YIELD;
    }
  }
}

// Supply routes: a multi-source shortest-path tree from every node touching
// uneaten food (or the spore, before any food is found), where a cord's
// cost is its length over its capacity (thickness squared). Each growing
// tip's demand is then summed up the tree toward its source, giving the
// flow every cord carries.
function route(net) {
  const N = net.nodeCount, E = net.edgeCount;
  const w = net.world;
  // Adjacency (CSR).
  const off = new Int32Array(N + 1);
  for (let e = 0; e < E; e++) {
    if (net.ea[e] < 0) continue;
    off[net.ea[e] + 1]++; off[net.eb[e] + 1]++;
  }
  for (let i = 0; i < N; i++) off[i + 1] += off[i];
  const adj = new Int32Array(off[N]);
  const fill = off.slice(0, N);
  for (let e = 0; e < E; e++) {
    if (net.ea[e] < 0) continue;
    adj[fill[net.ea[e]]++] = e; adj[fill[net.eb[e]]++] = e;
  }

  const dist = new Float32Array(N).fill(Infinity);
  const parentEdge = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  let nOrder = 0;
  const heap = new MinHeap(N);
  let sources = 0;
  for (let i = 0; i < N; i++) {
    if (!net.nAlive[i]) continue;
    const c = cellAt(net.nx[i], net.ny[i]);
    if (c >= 0 && w.food[c] !== -1 && w.cellStock[c] > 0.02) { dist[i] = 0; heap.push(i, 0); sources++; }
  }
  if (sources === 0 && net.root >= 0 && net.nAlive[net.root]) { dist[net.root] = 0; heap.push(net.root, 0); }

  while (heap.size) {
    const u = heap.peekId(), du = heap.peekPr();
    heap.pop();
    if (du > dist[u]) continue;
    order[nOrder++] = u;
    for (let k = off[u]; k < off[u + 1]; k++) {
      const e = adj[k];
      const v = net.ea[e] === u ? net.eb[e] : net.ea[e];
      const D = net.eD[e];
      const nd = du + net.eLen[e] / (D * D);
      if (nd < dist[v]) { dist[v] = nd; parentEdge[v] = e; heap.push(v, nd); }
    }
  }

  // What each tip actually spent on growth since the last routing, summed
  // toward the sources: the flow each cord carried.
  const hours = Math.max(SLOW_H, net.hours - net.routeHours);
  net.routeHours = net.hours;
  const acc = new Float32Array(N);
  for (const t of net.tips) {
    if (t.dead || !net.nAlive[t.node]) continue;
    const reached = dist[t.node] < Infinity;
    t.eff = reached ? 1 / (1 + dist[t.node] / RES0) : UNREACHED_EFF;
    acc[t.node] += t.spent / hours; // biomass per hour
    t.spent = 0;
  }
  net.eQ.fill(0, 0, E);
  for (let k = nOrder - 1; k >= 0; k--) {
    const v = order[k];
    const e = parentEdge[v];
    if (e < 0 || acc[v] === 0) continue;
    const u = net.ea[e] === v ? net.eb[e] : net.ea[e];
    net.eQ[e] = net.ea[e] === u ? acc[v] : -acc[v]; // positive: flows a -> b
    acc[u] += acc[v];
  }
}

function upkeepAndAdapt(net, minute) {
  const { ea, eD, eQ, eLen, eBorn } = net;
  // Upkeep: living cords cost something to maintain. If the store can't
  // pay, everything starts to wither.
  let cost = 0;
  for (let e = 0; e < net.edgeCount; e++) if (ea[e] >= 0) cost += eD[e] * eLen[e];
  cost *= (UPKEEP * SLOW_H) / SEG;
  const starving = cost > net.pool;
  net.pool = Math.max(0, net.pool - cost);

  for (let e = 0; e < net.edgeCount; e++) {
    if (ea[e] < 0) continue;
    // Thickness follows use.
    const target = Math.min(D_MAX, D_MIN + D_GAIN * Math.sqrt(Math.abs(eQ[e])));
    eD[e] += (target - eD[e]) * Math.min(1, (target > eD[e] ? THICKEN : THIN) * SLOW_H);
    if (starving) eD[e] *= 1 - 0.02 * SLOW_H;
    // Unused, thin, old cords die.
    if (eD[e] < D_DIE && minute - eBorn[e] > GRACE_H * 60) killEdge(net, e);
  }
}

// --- Food scent ---------------------------------------------------------------------

// Distance from each coarse cell to the nearest uneaten food, turned into a
// smell that fades out at SCENT_RANGE. Two-pass chamfer distance transform.
function computeScent(net) {
  const w = net.world;
  const INF = 1e9;
  const d = new Float32Array(SW * SH).fill(INF);
  for (const f of w.foods) {
    if (f.stock <= 0) continue;
    for (const i of f.cells) {
      if (w.cellStock[i] <= 0.02) continue;
      const x = ((i % GW) / SC) | 0, y = (((i / GW) | 0) / SC) | 0;
      d[y * SW + x] = 0;
    }
  }
  const o = SC * CELL, dg = o * Math.SQRT2;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + o);
      if (y > 0) {
        v = Math.min(v, d[i - SW] + o);
        if (x > 0) v = Math.min(v, d[i - SW - 1] + dg);
        if (x < SW - 1) v = Math.min(v, d[i - SW + 1] + dg);
      }
      d[i] = v;
    }
  }
  for (let y = SH - 1; y >= 0; y--) {
    for (let x = SW - 1; x >= 0; x--) {
      const i = y * SW + x;
      let v = d[i];
      if (x < SW - 1) v = Math.min(v, d[i + 1] + o);
      if (y < SH - 1) {
        v = Math.min(v, d[i + SW] + o);
        if (x < SW - 1) v = Math.min(v, d[i + SW + 1] + dg);
        if (x > 0) v = Math.min(v, d[i + SW - 1] + dg);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) net.scent[i] = Math.max(0, 1 - d[i] / SCENT_RANGE);
}

function scentAt(net, x, y) {
  const fx = Math.max(0, Math.min(SW - 1.001, x / (SC * CELL) - 0.5));
  const fy = Math.max(0, Math.min(SH - 1.001, y / (SC * CELL) - 0.5));
  const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
  const s = net.scent, i = y0 * SW + x0;
  return (s[i] * (1 - tx) + s[i + 1] * tx) * (1 - ty) + (s[i + SW] * (1 - tx) + s[i + SW + 1] * tx) * ty;
}

// --- Snapshots for the renderer ---------------------------------------------------------

export function networkSnapshot(net) {
  const live = [];
  for (let e = 0; e < net.edgeCount; e++) if (net.ea[e] >= 0) live.push(e);
  const m = live.length;
  const edgeA = new Int32Array(m), edgeB = new Int32Array(m);
  const edgeD = new Float32Array(m), edgeQ = new Float32Array(m);
  const edgeT0 = new Float32Array(m), edgeT1 = new Float32Array(m), edgeOwner = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    const e = live[k];
    edgeA[k] = net.ea[e]; edgeB[k] = net.eb[e];
    edgeD[k] = net.eD[e]; edgeQ[k] = net.eQ[e];
    edgeT0[k] = net.eT0[e]; edgeT1[k] = net.eT1[e]; edgeOwner[k] = net.eOwner[e];
  }
  // Tips: x, y, angle, progress (units), rate (units/hour), idle flag, id, segment start (minute).
  const tipsArr = [];
  for (const t of net.tips) {
    if (t.dead) continue;
    // Idle flag only for tips stalled for a while (dry soil or no food).
    tipsArr.push(net.nx[t.node], net.ny[t.node], t.ang, t.acc, t.rate || 0, (t.idleH || 0) > 6 ? 1 : 0, t.id, t.segStart ?? net.minute);
  }
  return {
    nodeX: net.nx.slice(0, net.nodeCount),
    nodeY: net.ny.slice(0, net.nodeCount),
    edgeA, edgeB, edgeD, edgeQ, edgeT0, edgeT1, edgeOwner,
    minute: net.minute,
    tips: Float32Array.from(tipsArr),
    spore: net.spore ? { x: net.spore.x, y: net.spore.y, germinated: net.spore.germinated } : null,
  };
}

export function networkStats(net) {
  let active = 0, idle = 0;
  for (const t of net.tips) {
    if (t.dead) continue;
    if ((t.idleH || 0) > 6) idle++; else active++;
  }
  return {
    nodes: net.nodeCount - net.deadNodes, edges: net.edgeCount - net.deadEdges,
    tips: active, dormant: idle, pool: net.pool, fusions: net.fusions,
    spore: net.spore ? (net.spore.germinated ? 'germinated' : 'waiting') : 'none',
  };
}

// Food decay: per grid cell, how much is eaten (0..255) and whether hyphae
// have colonized it.
export function decaySnapshot(net) {
  const w = net.world;
  const eaten = new Uint8Array(GW * GH);
  const colon = new Uint8Array(GW * GH);
  for (const f of w.foods) {
    for (const i of f.cells) {
      eaten[i] = Math.round(255 * (1 - Math.max(0, w.cellStock[i]) / f.perCell));
      colon[i] = net.density[i] > 0 ? 255 : 0;
    }
  }
  return { eaten, colon };
}

// --- Helpers ---------------------------------------------------------------------------

function storeCap(net) {
  return STORE_BASE + (net.edgeCount - net.deadEdges) * STORE_PER_EDGE;
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

// How fast a tip can grow here, 0..1: moisture, temperature, soil
// resistance and oxygen (scarce deep down).
function growthFactor(w, c, y, minute) {
  if (c < 0) return 0;
  const t = w.type[c];
  const sat = w.moisture[c];
  const rel = sat / Math.max(0.2, FC[t]);
  let fm = smooth(0.3, 0.75, rel);
  if (sat > 0.95) fm *= 0.5;
  const depth = y / CELL - 30;
  const T = soilTemp(minute, depth);
  const fT = Math.max(0, Math.min(1, (T - 3) / 17));
  const fR = 1 - SOIL[t].resist * 0.75;
  const fO = 1 - smooth(45, 140, depth) * 0.85;
  return fm * fT * fR * fO;
}

// Desirability of a point ahead of a tip.
function senseScore(net, x, y) {
  const w = net.world;
  const c = cellAt(x, y);
  if (c < 0) return -3;
  const t = w.type[c];
  if (t === AIR || t === ROCK) return -2.5;
  const rel = w.moisture[c] / Math.max(0.2, FC[t]);
  let s = 3.0 * w.nutrient[c];
  if (w.food[c] !== -1 && w.cellStock[c] > 0) s += 2.0;
  s += SCENT_WEIGHT * scentAt(net, x, y);
  s += 0.8 * Math.min(1, rel);
  s -= 1.1 * SOIL[t].resist;
  s -= 0.35 * Math.min(6, net.density[c]);
  s -= 0.012 * Math.max(0, y / CELL - 40);
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
        if (j === tip.node || !net.nAlive[j]) continue;
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

// Choose a tip's heading by sensing ahead: toward food scent and richer,
// damper soil, mostly straight on. Returns false if every way is blocked.
function chooseDirection(net, tip, x, y, rng) {
  const w = net.world;
  let best = -Infinity, bestAng = tip.ang;
  for (const d of TURN_STEPS) {
    const a = tip.ang + d + rng.range(-0.08, 0.08);
    const px = x + Math.cos(a) * SEG, py = y + Math.sin(a) * SEG;
    if (!passable(w, px, py)) continue;
    const sx = x + Math.cos(a) * SENSE_DIST, sy = y + Math.sin(a) * SENSE_DIST;
    const score = senseScore(net, sx, sy) + Math.cos(d) * 1.2 + rng() * 0.3;
    if (score > best) { best = score; bestAng = a; }
  }
  if (best === -Infinity) {
    tip.ang += rng() < 0.5 ? 1.2 : -1.2;
    return false;
  }
  tip.blocked = 0;
  tip.ang = bestAng;
  return true;
}

function setEdgeTiming(net, e, t0, t1, owner) {
  net.eT0[e] = t0; net.eT1[e] = t1; net.eOwner[e] = owner;
}

function addTip(net, node, ang, eff = 1) {
  net.tips.push({
    id: net.nextTipId++,
    parentId: net.nOwner[node],
    branchSeq: net.nSeq[node],
    node, ang, acc: 0, rate: 0, segStart: net.minute, segs: 0, lastBranch: 0, blocked: 0, eff, lastEdge: -1, spent: 0,
    dormant: false, starved: false, dead: false,
  });
}

function addNode(net, x, y, owner, seq, minute) {
  if (net.nodeCount === net.nx.length) growNodes(net);
  const i = net.nodeCount++;
  net.nx[i] = x; net.ny[i] = y;
  net.nOwner[i] = owner; net.nSeq[i] = seq; net.nBorn[i] = minute;
  net.nDeg[i] = 0; net.nAlive[i] = 1;
  const c = cellAt(x, y);
  net.next[i] = net.head[c];
  net.head[c] = i;
  if (net.density[c] < 65535) net.density[c]++;
  return i;
}

function addEdge(net, a, b, len, minute) {
  if (net.edgeCount === net.ea.length) growEdges(net);
  const e = net.edgeCount++;
  net.ea[e] = a; net.eb[e] = b; net.eLen[e] = Math.max(1, len);
  net.eD[e] = D_NEW; net.eQ[e] = 0; net.eBorn[e] = minute;
  net.eT0[e] = minute; net.eT1[e] = minute; net.eOwner[e] = -1;
  net.nDeg[a]++; net.nDeg[b]++;
  return e;
}

function killEdge(net, e) {
  const a = net.ea[e], b = net.eb[e];
  net.ea[e] = -1;
  net.deadEdges++;
  net.version++;
  if (--net.nDeg[a] <= 0) killNode(net, a);
  if (--net.nDeg[b] <= 0) killNode(net, b);
}

function killNode(net, i) {
  if (!net.nAlive[i]) return;
  net.nAlive[i] = 0;
  net.deadNodes++;
  const c = cellAt(net.nx[i], net.ny[i]);
  if (c >= 0 && net.density[c] > 0) net.density[c]--;
}

// Remove dead edges, keeping creation order.
function compactEdges(net) {
  const remapE = new Int32Array(net.edgeCount).fill(-1);
  let k = 0;
  for (let e = 0; e < net.edgeCount; e++) {
    if (net.ea[e] < 0) continue;
    remapE[e] = k;
    if (k !== e) {
      net.ea[k] = net.ea[e]; net.eb[k] = net.eb[e]; net.eLen[k] = net.eLen[e];
      net.eD[k] = net.eD[e]; net.eQ[k] = net.eQ[e]; net.eBorn[k] = net.eBorn[e];
      net.eT0[k] = net.eT0[e]; net.eT1[k] = net.eT1[e]; net.eOwner[k] = net.eOwner[e];
    }
    k++;
  }
  net.edgeCount = k;
  net.deadEdges = 0;
  for (const t of net.tips) t.lastEdge = t.lastEdge >= 0 ? remapE[t.lastEdge] : -1;
}

// Remove dead nodes, remapping edges and tips, and rebuild the hash.
function compactNodes(net) {
  compactEdges(net);
  const remap = new Int32Array(net.nodeCount).fill(-1);
  let k = 0;
  for (let i = 0; i < net.nodeCount; i++) {
    if (!net.nAlive[i]) continue;
    remap[i] = k;
    if (k !== i) {
      net.nx[k] = net.nx[i]; net.ny[k] = net.ny[i];
      net.nOwner[k] = net.nOwner[i]; net.nSeq[k] = net.nSeq[i];
      net.nBorn[k] = net.nBorn[i]; net.nDeg[k] = net.nDeg[i]; net.nAlive[k] = 1;
    }
    k++;
  }
  net.nodeCount = k;
  net.deadNodes = 0;
  for (let e = 0; e < net.edgeCount; e++) {
    net.ea[e] = remap[net.ea[e]];
    net.eb[e] = remap[net.eb[e]];
  }
  for (const t of net.tips) {
    if (t.dead) continue;
    const r = remap[t.node];
    if (r < 0) t.dead = true; else t.node = r;
  }
  net.root = net.root >= 0 ? remap[net.root] : -1;
  net.head.fill(-1);
  for (let i = 0; i < k; i++) {
    const c = cellAt(net.nx[i], net.ny[i]);
    net.next[i] = net.head[c];
    net.head[c] = i;
  }
  net.version++;
}

function growNodes(net) {
  for (const key of ['nx', 'ny', 'nOwner', 'nSeq', 'nBorn', 'nDeg', 'nAlive', 'next']) net[key] = grow(net[key]);
}

function growEdges(net) {
  for (const key of ['ea', 'eb', 'eLen', 'eD', 'eQ', 'eBorn', 'eT0', 'eT1', 'eOwner']) net[key] = grow(net[key]);
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

// Binary min-heap of (node, priority) for the route search.
class MinHeap {
  constructor(cap) {
    this.id = new Int32Array(Math.max(16, cap));
    this.pr = new Float32Array(Math.max(16, cap));
    this.size = 0;
  }
  peekId() { return this.id[0]; }
  peekPr() { return this.pr[0]; }
  push(i, p) {
    if (this.size === this.id.length) {
      const id = new Int32Array(this.size * 2); id.set(this.id); this.id = id;
      const pr = new Float32Array(this.size * 2); pr.set(this.pr); this.pr = pr;
    }
    let k = this.size++;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (this.pr[parent] <= p) break;
      this.id[k] = this.id[parent]; this.pr[k] = this.pr[parent];
      k = parent;
    }
    this.id[k] = i; this.pr[k] = p;
  }
  pop() {
    const i = this.id[--this.size], p = this.pr[this.size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pr[c + 1] < this.pr[c]) c++;
      if (this.pr[c] >= p) break;
      this.id[k] = this.id[c]; this.pr[k] = this.pr[c];
      k = c;
    }
    this.id[k] = i; this.pr[k] = p;
  }
}
