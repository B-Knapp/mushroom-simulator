// Procedural world generation: a cross-section of woodland soil.
// Everything is in grid cells (see config GW x GH). Shapes are kept as
// polygons too, so the renderer can draw them crisply.

import { GW, GH, GROUND_ROW } from '../config.js';
import { AIR, LITTER, LOAM, SAND, CLAY_LOAM, CLAY, ROCK, WOOD, FC } from '../soilTypes.js';
import { makeRng, subSeed } from '../rng.js';
import { wave1d, pointInPoly, rectPoly, blobPoly } from '../noise.js';

export function generateWorld(seed) {
  const rng = makeRng(subSeed(seed, 'world'));
  const N = GW * GH;
  const type = new Uint8Array(N);
  const food = new Int16Array(N).fill(-1); // index into foods, or -1
  const moisture = new Float32Array(N);
  const nutrient = new Float32Array(N);

  const at = (x, y) => y * GW + x;

  // --- Ground line and leaf litter ---------------------------------------
  const groundWave = wave1d(rng, GW, 70, 1.6);
  const litterWave = wave1d(rng, GW, 45, 1.2);
  const ground = new Int16Array(GW);     // first mineral-soil row
  const litterTop = new Int16Array(GW);  // first litter row

  // Leaf piles: thicker litter, rich in nutrients. Placed first so litter
  // thickness can bulge under them.
  const foods = [];
  const piles = [];
  const nPiles = rng.int(3, 5);
  for (let k = 0; k < nPiles; k++) {
    piles.push({ cx: rng.range(40, GW - 40), half: rng.range(14, 30), h: rng.range(3, 6) });
  }

  for (let x = 0; x < GW; x++) {
    ground[x] = Math.round(GROUND_ROW + groundWave(x));
    let thick = 3.5 + litterWave(x);
    for (const p of piles) {
      const d = Math.abs(x - p.cx) / p.half;
      if (d < 1) thick += p.h * (1 - d * d);
    }
    litterTop[x] = ground[x] - Math.max(2, Math.round(thick));
  }

  // --- Mineral soil layers -------------------------------------------------
  const subWave = wave1d(rng, GW, 40, 9);
  const deepWave = wave1d(rng, GW, 55, 7);
  for (let x = 0; x < GW; x++) {
    const sub = Math.round(95 + subWave(x));
    const deep = Math.round(165 + deepWave(x));
    for (let y = 0; y < GH; y++) {
      let t;
      if (y < litterTop[x]) t = AIR;
      else if (y < ground[x]) t = LITTER;
      else if (y < sub) t = LOAM;
      else if (y < deep) t = CLAY_LOAM;
      else t = CLAY;
      type[at(x, y)] = t;
    }
  }

  // Sand pockets: fast-draining lenses in the upper soil.
  const sandPolys = [];
  for (let k = rng.int(4, 7); k > 0; k--) {
    const poly = blobPoly(rng, rng.range(20, GW - 20), rng.range(GROUND_ROW + 15, 140),
      rng.range(8, 22), rng.range(0.3, 0.55), rng.range(-0.3, 0.3));
    sandPolys.push(poly);
    fillPoly(poly, (i) => { if (type[i] !== AIR && type[i] !== LITTER) type[i] = SAND; });
  }

  // --- Rocks ---------------------------------------------------------------
  const rocks = [];
  const addRock = (cx, cy, r) => {
    const poly = blobPoly(rng, cx, cy, r, rng.range(0.55, 0.85), rng.range(0, Math.PI), 16);
    rocks.push(poly);
    fillPoly(poly, (i) => { if (type[i] !== AIR && type[i] !== LITTER) type[i] = ROCK; });
  };
  for (let k = rng.int(2, 3); k > 0; k--) addRock(rng.range(60, GW - 60), rng.range(120, 220), rng.range(10, 17));
  for (let k = rng.int(28, 40); k > 0; k--) {
    const r = rng.range(1.5, 6);
    addRock(rng.range(5, GW - 5), rng.range(GROUND_ROW + 8 + r, GH - 4), r);
  }

  // --- Food sources ----------------------------------------------------------
  // Leaf piles become food: their litter cells are marked.
  for (const p of piles) {
    const id = foods.length;
    const cells = [];
    for (let x = Math.max(0, Math.floor(p.cx - p.half)); x < Math.min(GW, Math.ceil(p.cx + p.half)); x++) {
      for (let y = litterTop[x]; y < ground[x]; y++) {
        const i = at(x, y);
        if (type[i] === LITTER) { food[i] = id; cells.push(i); }
      }
    }
    foods.push({ id, kind: 'leaves', cx: p.cx, half: p.half, h: p.h, cells, leach: 0.0009 });
  }

  // Buried branches: dead wood in the topsoil.
  for (let k = rng.int(1, 2); k > 0; k--) {
    const len = rng.range(40, 80);
    const thick = rng.range(3, 4.5);
    const cx = rng.range(len / 2 + 10, GW - len / 2 - 10);
    const cy = rng.range(GROUND_ROW + 14, 75);
    const poly = rectPoly(cx, cy, len, thick, rng.range(-0.35, 0.35));
    const id = foods.length;
    const cells = [];
    fillPoly(poly, (i) => { type[i] = WOOD; food[i] = id; cells.push(i); });
    foods.push({ id, kind: 'branch', poly, len, thick, cells, leach: 0.00035 });
  }

  // A fallen log lying on the litter, slightly sunk in.
  {
    const len = rng.range(120, 180);
    const diam = rng.range(12, 15);
    const x0 = Math.round(rng.range(30, GW - len - 30));
    const x1 = Math.round(x0 + len);
    let base = 0;
    for (let x = x0; x < x1; x++) base = Math.max(base, litterTop[x]);
    const bottom = base + 1;               // sunk one row into the litter
    const top = Math.round(bottom - diam);
    const id = foods.length;
    const cells = [];
    for (let x = x0; x < x1; x++) {
      // Rounded ends.
      const e = Math.min(x - x0, x1 - 1 - x);
      const inset = e < 3 ? 3 - e : 0;
      for (let y = top + inset; y <= bottom - Math.floor(inset / 2); y++) {
        const i = at(x, y);
        type[i] = WOOD; food[i] = id; cells.push(i);
      }
    }
    foods.push({ id, kind: 'log', x0, x1, top, bottom, diam, cells, leach: 0.0004 });
  }

  // --- Derived data ----------------------------------------------------------
  // Topmost non-air cell per column (where rain lands, where evaporation acts).
  const surface = new Int16Array(GW);
  for (let x = 0; x < GW; x++) {
    let y = 0;
    while (y < GH && type[at(x, y)] === AIR) y++;
    surface[x] = y;
  }

  // Halo: non-food, water-holding cells touching a food cell. Nutrients
  // leach from food into these.
  for (const f of foods) {
    const seen = new Set();
    for (const i of f.cells) {
      const x = i % GW, y = (i / GW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = at(nx, ny);
        const t = type[j];
        if (food[j] === -1 && t !== AIR && t !== ROCK && !seen.has(j)) { seen.add(j); }
      }
    }
    f.halo = Int32Array.from(seen);
    f.stock = f.cells.length * (f.kind === 'leaves' ? 0.6 : 1.0);
    f.initialStock = f.stock;
  }

  // --- Initial moisture and nutrients -----------------------------------------
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = at(x, y);
      const t = type[i];
      const depth = Math.max(0, y - ground[x]);
      // Dead wood starts soaked: it's a water store for the soil beneath.
      moisture[i] = t === WOOD ? 0.85 : FC[t] * Math.min(1, 0.55 + depth / 200);
      let n = 0;
      if (t === LITTER) n = 0.22;
      else if (t === LOAM) n = 0.16 * Math.exp(-depth / 60);
      else if (t === SAND) n = 0.05;
      else if (t === CLAY_LOAM) n = 0.06;
      else if (t === CLAY) n = 0.03;
      if (food[i] !== -1) n = 0; // food stock is tracked on the food itself
      nutrient[i] = n;
    }
  }

  return {
    seed, type, food, moisture, nutrient, ground, litterTop, surface,
    foods, rocks, sandPolys,
  };

  function fillPoly(poly, fn) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < poly.length; k += 2) {
      minX = Math.min(minX, poly[k]); maxX = Math.max(maxX, poly[k]);
      minY = Math.min(minY, poly[k + 1]); maxY = Math.max(maxY, poly[k + 1]);
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(GH - 1, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(GW - 1, Math.ceil(maxX)); x++) {
        if (pointInPoly(x + 0.5, y + 0.5, poly)) fn(at(x, y));
      }
    }
  }
}
