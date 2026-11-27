// Bakes the static look of the world into one offscreen canvas: the dim
// forest above ground, soil layers with mottling, roots and grain, rocks,
// leaf litter, buried branches and the fallen log. Dynamic things
// (wetness, decay, the network, overlays) are drawn on top.

import { WORLD_W, WORLD_H, CELL, GW, GH } from '../config.js';
import { SOIL, AIR, ROCK, WOOD, LITTER, SAND } from '../soilTypes.js';
import { makeRng, subSeed } from '../rng.js';

export function bakeWorld(w) {
  const rng = makeRng(subSeed(w.seed, 'paint'));
  const c = document.createElement('canvas');
  c.width = WORLD_W;
  c.height = WORLD_H;
  const ctx = c.getContext('2d');
  const typeAt = (wx, wy) => {
    const x = Math.min(GW - 1, Math.max(0, Math.floor(wx / CELL)));
    const y = Math.min(GH - 1, Math.max(0, Math.floor(wy / CELL)));
    return w.cellType[y * GW + x];
  };
  const groundY = (wx) => w.ground[Math.min(GW - 1, Math.max(0, Math.floor(wx / CELL)))] * CELL;
  const litterY = (wx) => w.litterTop[Math.min(GW - 1, Math.max(0, Math.floor(wx / CELL)))] * CELL;

  paintForest(ctx, rng, litterY);
  paintSoilLayers(ctx, w);

  // Everything below the litter top: clip so soil effects stay in the soil.
  const soilClip = new Path2D();
  soilClip.moveTo(0, WORLD_H);
  for (let x = 0; x <= WORLD_W; x += CELL) soilClip.lineTo(x, litterY(x) + 2);
  soilClip.lineTo(WORLD_W, WORLD_H);
  soilClip.closePath();

  ctx.save();
  ctx.clip(soilClip);
  paintMottling(ctx, rng);
  paintSand(ctx, w);
  paintGrain(ctx, rng, typeAt);
  paintRoots(ctx, rng, groundY, typeAt);
  paintDepthShade(ctx, groundY);
  ctx.restore();

  paintRocks(ctx, rng, w);
  paintLitter(ctx, rng, w, typeAt);
  paintSprigs(ctx, rng, w, typeAt);

  // Food goes on its own layer, so it can bleach and crumble away as the
  // fungus eats it.
  const wood = document.createElement('canvas');
  wood.width = WORLD_W;
  wood.height = WORLD_H;
  const wctx = wood.getContext('2d');
  for (const f of w.foods) if (f.kind === 'branch') paintBranch(wctx, rng, f);
  for (const f of w.foods) if (f.kind === 'log') paintLog(wctx, rng, f);
  const leaves = pileLeaves(rng, w, typeAt);
  return { base: c, food: new FoodLayer(wood, leaves) };
}

// The edible things: wood (one picture, eaten away with soft-edged holes)
// and leaf piles (individual leaves, each vanishing once its spot is eaten).
export class FoodLayer {
  constructor(wood, leaves) {
    this.wood = wood;
    this.leaves = leaves;
    this.canvas = document.createElement('canvas');
    this.canvas.width = WORLD_W;
    this.canvas.height = WORLD_H;
    this.render(null, null, null);
  }

  // eaten: per-cell 0..255; holes/bleach: grid-size canvases (or null).
  render(eaten, holes, bleach, crumble) {
    const c = this.canvas.getContext('2d');
    c.globalCompositeOperation = 'copy';
    c.drawImage(this.wood, 0, 0);
    c.globalCompositeOperation = 'source-over';
    if (holes) {
      c.globalCompositeOperation = 'destination-out';
      c.imageSmoothingEnabled = true;
      c.drawImage(holes, 0, 0, WORLD_W, WORLD_H);
      c.globalCompositeOperation = 'source-over';
    }
    for (const L of this.leaves) {
      if (eaten && eaten[L.cell] / 255 > crumble[L.cell]) continue;
      drawLeafP(c, L);
    }
    if (bleach) {
      c.globalCompositeOperation = 'source-atop';
      c.drawImage(bleach, 0, 0, WORLD_W, WORLD_H);
      c.globalCompositeOperation = 'source-over';
    }
  }
}

// --- Above ground ---------------------------------------------------------------

function paintForest(ctx, rng, litterY) {
  const bottom = 34 * CELL;
  const sky = ctx.createLinearGradient(0, 0, 0, bottom);
  sky.addColorStop(0, '#191714');
  sky.addColorStop(0.6, '#24201a');
  sky.addColorStop(1, '#30291f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Distant trunks, faint and soft.
  for (let k = 0; k < 26; k++) {
    const x = rng() * WORLD_W;
    const wdt = 14 + rng() * 40;
    const a = 0.12 + rng() * 0.14;
    const g = ctx.createLinearGradient(x - wdt / 2, 0, x + wdt / 2, 0);
    g.addColorStop(0, `rgba(10,8,6,${a * 0.4})`);
    g.addColorStop(0.35, `rgba(12,10,8,${a})`);
    g.addColorStop(1, `rgba(10,8,6,${a * 0.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(x - wdt / 2, 0, wdt, litterY(x) + 4);
  }
  // Low undergrowth silhouettes along the ground.
  for (let k = 0; k < 220; k++) {
    const x = rng() * WORLD_W;
    const base = litterY(x) + 3;
    const h = 10 + rng() * 34;
    const spread = 8 + rng() * 22;
    ctx.fillStyle = `rgba(${16 + rng() * 8},${18 + rng() * 8},${12 + rng() * 5},${0.12 + rng() * 0.14})`;
    ctx.beginPath();
    ctx.moveTo(x - spread, base);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      ctx.lineTo(x - spread + t * spread * 2, base - h * Math.sin(t * Math.PI) * (0.6 + rng() * 0.4));
    }
    ctx.closePath();
    ctx.fill();
  }
  // A soft haze near the ground.
  const haze = ctx.createLinearGradient(0, bottom - 60, 0, bottom);
  haze.addColorStop(0, 'rgba(70,60,45,0)');
  haze.addColorStop(1, 'rgba(70,60,45,0.18)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, bottom - 60, WORLD_W, 60);
}

// --- Soil ---------------------------------------------------------------------------

function paintSoilLayers(ctx, w) {
  const small = document.createElement('canvas');
  small.width = GW;
  small.height = GH;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(GW, GH);
  for (let y = 0; y < GH; y++) {
    let prev = AIR;
    for (let x = 0; x < GW; x++) {
      let t = w.cellType[y * GW + x];
      if (t === ROCK || t === WOOD || t === SAND) t = prev;
      else prev = t;
      // Leaf-pile cells are drawn as leaves on the food layer instead.
      if (t === LITTER && w.food[y * GW + x] !== -1 && y < w.ground[x] - 1) t = AIR;
      const k = (y * GW + x) * 4;
      if (t === AIR) { img.data[k + 3] = 0; continue; }
      const [r, g, b] = SOIL[t].color;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, WORLD_W, WORLD_H);
}

// Large soft blotches of lighter and darker earth.
function paintMottling(ctx, rng) {
  for (let k = 0; k < 900; k++) {
    const x = rng() * WORLD_W, y = 100 + rng() * (WORLD_H - 100);
    const r = 12 + rng() * 70;
    const dark = rng() < 0.55;
    const a = 0.035 + rng() * 0.05;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? `rgba(20,12,6,${a})` : `rgba(190,150,105,${a})`);
    g.addColorStop(1, dark ? 'rgba(20,12,6,0)' : 'rgba(190,150,105,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.4 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintSand(ctx, w) {
  for (const poly of w.sandPolys) {
    tracePoly(ctx, poly, CELL);
    ctx.fillStyle = 'rgba(160,128,88,0.45)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(160,128,88,0.18)';
    ctx.stroke();
  }
}

function paintGrain(ctx, rng, typeAt) {
  const n = Math.floor((WORLD_W * WORLD_H) / 30);
  for (let k = 0; k < n; k++) {
    const x = rng() * WORLD_W, y = rng() * WORLD_H;
    const t = typeAt(x, y);
    if (t === AIR || t === LITTER) continue;
    const s = 0.4 + rng() * 1.4;
    if (t === SAND) ctx.fillStyle = rng() < 0.6 ? 'rgba(215,185,140,0.5)' : 'rgba(60,40,22,0.35)';
    else {
      const r = rng();
      ctx.fillStyle = r < 0.5 ? 'rgba(28,17,9,0.42)' : r < 0.9 ? 'rgba(170,135,95,0.24)' : 'rgba(225,210,185,0.3)';
    }
    ctx.fillRect(x, y, s, s);
  }
  // Small pebbles for texture (not simulated), lightly shaded.
  for (let k = 0; k < 260; k++) {
    const x = rng() * WORLD_W, y = rng() * WORLD_H;
    const t = typeAt(x, y);
    if (t === AIR || t === LITTER || t === ROCK || t === WOOD) continue;
    const r = 0.8 + rng() * 2.4;
    const l = 34 + rng() * 20;
    ctx.fillStyle = `hsl(32, ${8 + rng() * 10}%, ${l}%)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rng() * 0.35), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(32, 10%, ${l + 18}%, 0.5)`;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25, y - r * 0.3, r * 0.45, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Old root fragments: dark fibrous threads, densest near the surface.
function paintRoots(ctx, rng, groundY, typeAt) {
  ctx.lineCap = 'round';
  for (let k = 0; k < 110; k++) {
    let x = rng() * WORLD_W;
    let y = groundY(x) + 6 + Math.pow(rng(), 1.8) * 320;
    let a = Math.PI / 2 + (rng() - 0.5) * 1.6;
    const steps = 6 + ((rng() * 18) | 0);
    const pale = rng() < 0.25;
    ctx.strokeStyle = pale ? 'rgba(150,118,80,0.45)' : 'rgba(34,21,11,0.55)';
    ctx.lineWidth = 0.6 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < steps; i++) {
      a += (rng() - 0.5) * 0.7;
      x += Math.cos(a) * 6; y += Math.sin(a) * 6;
      const t = typeAt(x, y);
      if (t === AIR || t === ROCK) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Soil gets darker with depth, and a little shadow sits under the litter.
function paintDepthShade(ctx, groundY) {
  const g = ctx.createLinearGradient(0, 120, 0, WORLD_H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.35, 'rgba(10,6,3,0.12)');
  g.addColorStop(1, 'rgba(10,6,3,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.beginPath();
  for (let x = 0; x <= WORLD_W; x += CELL) ctx.lineTo(x, groundY(x));
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(15,9,4,0.18)';
  ctx.stroke();
}

// --- Rocks ---------------------------------------------------------------------------

function paintRocks(ctx, rng, w) {
  for (const poly of w.rocks) {
    const [cx, cy, r] = polyCircle(poly, CELL);
    const hue = 28 + rng() * 16, sat = 4 + rng() * 8, lit = 38 + rng() * 14;
    // Contact shadow.
    ctx.fillStyle = 'rgba(15,9,4,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.08, cy + r * 0.12, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    tracePoly(ctx, poly, CELL);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.2);
    g.addColorStop(0, `hsl(${hue}, ${sat}%, ${lit + 16}%)`);
    g.addColorStop(0.6, `hsl(${hue}, ${sat}%, ${lit}%)`);
    g.addColorStop(1, `hsl(${hue}, ${sat}%, ${lit - 16}%)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Speckles and a few fracture lines.
    for (let k = 0; k < r * 3; k++) {
      ctx.fillStyle = rng() < 0.5 ? `hsla(${hue}, 8%, ${lit - 20}%, 0.35)` : `hsla(${hue}, 8%, ${lit + 22}%, 0.3)`;
      ctx.fillRect(cx + (rng() - 0.5) * r * 2, cy + (rng() - 0.5) * r * 2, 1, 1);
    }
    if (r > 10) {
      ctx.strokeStyle = `hsla(${hue}, 8%, ${lit - 22}%, 0.4)`;
      ctx.lineWidth = 0.8;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        let x = cx + (rng() - 0.5) * r, y = cy - r;
        ctx.moveTo(x, y);
        for (let i = 0; i < 5; i++) { x += (rng() - 0.5) * r * 0.4; y += r * 0.4; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }
    ctx.restore();
    tracePoly(ctx, poly, CELL);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lit - 25}%, 0.7)`;
    ctx.stroke();
  }
}

// --- Leaf litter -------------------------------------------------------------------------

const DRY = ['#7a4f24', '#8f5e2a', '#6a4520', '#9a6a33', '#5b3c1c', '#84582a'];
const FRESH = ['#b97a2c', '#c98d36', '#a2581f', '#b0452a', '#c7a24c', '#8e3f22', '#d0a040'];

function drawLeaf(ctx, rng, x, y, len, col) {
  const a = rng() * Math.PI;
  const wdt = len * (0.32 + rng() * 0.18);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.quadraticCurveTo(-len * 0.1, -wdt, len / 2, 0);
  ctx.quadraticCurveTo(-len * 0.1, wdt, -len / 2, 0);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,18,8,0.45)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.beginPath(); // midrib
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.strokeStyle = 'rgba(240,210,160,0.25)';
  ctx.stroke();
  ctx.restore();
}

function paintLitter(ctx, rng, w, typeAt) {
  const isFood = (wx, wy) => {
    const x = Math.min(GW - 1, Math.max(0, Math.floor(wx / CELL)));
    const y = Math.min(GH - 1, Math.max(0, Math.floor(wy / CELL)));
    return w.food[y * GW + x] !== -1;
  };
  for (let x = 0; x < GW; x++) {
    const top = w.litterTop[x] * CELL, bot = w.ground[x] * CELL;
    // Under a leaf pile, only a thin dark humus layer is left once it's gone.
    if (isFood(x * CELL + 2, bot - 2)) {
      for (let k = 0; k < 3; k++) {
        drawLeaf(ctx, rng, (x + rng()) * CELL, bot - 1 - rng() * 5, 4 + rng() * 6, rng() < 0.5 ? '#3a2716' : '#4a321a');
      }
    }
    const n = Math.round((bot - top) / 4);
    for (let k = 0; k < n; k++) {
      const wx = (x + rng()) * CELL, wy = top + rng() * (bot - top);
      if (typeAt(wx, wy) !== LITTER || isFood(wx, wy)) continue;
      // Deeper litter is older and darker.
      const depth = (wy - top) / Math.max(1, bot - top);
      const col = depth > 0.6 && rng() < 0.6 ? '#4a321a' : DRY[(rng() * DRY.length) | 0];
      drawLeaf(ctx, rng, wx, wy, 5 + rng() * 8, col);
    }
  }
}

// Leaf piles: older leaves underneath, fresher and more colorful on top.
// Returned as a list so the pile can be redrawn as it's eaten.
function pileLeaves(rng, w, typeAt) {
  const out = [];
  for (const f of w.foods) {
    if (f.kind !== 'leaves') continue;
    for (let k = 0; k < f.half * 40; k++) {
      const gx = f.cx + (rng() * 2 - 1) * f.half;
      const x = Math.min(GW - 1, Math.max(0, Math.floor(gx)));
      const top = w.litterTop[x] * CELL, bot = w.ground[x] * CELL;
      const t = rng();
      const wy = top + t * (bot - top);
      const col = t > 0.55 ? DRY[(rng() * DRY.length) | 0] : FRESH[(rng() * FRESH.length) | 0];
      const len = 7 + rng() * 9, rot = rng() * Math.PI, wr = 0.32 + rng() * 0.18;
      if (typeAt(gx * CELL, wy) !== LITTER) continue;
      const cell = Math.floor(wy / CELL) * GW + x;
      out.push({ x: gx * CELL, y: wy, len, rot, wr, col, cell });
    }
  }
  // Older leaves (lower down) first, so fresh ones sit on top.
  out.sort((a, b) => b.y - a.y);
  return out;
}

function drawLeafP(ctx, L) {
  const wdt = L.len * L.wr;
  ctx.save();
  ctx.translate(L.x, L.y);
  ctx.rotate(L.rot);
  ctx.beginPath();
  ctx.moveTo(-L.len / 2, 0);
  ctx.quadraticCurveTo(-L.len * 0.1, -wdt, L.len / 2, 0);
  ctx.quadraticCurveTo(-L.len * 0.1, wdt, -L.len / 2, 0);
  ctx.fillStyle = L.col;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,18,8,0.45)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-L.len / 2, 0);
  ctx.lineTo(L.len / 2, 0);
  ctx.strokeStyle = 'rgba(240,210,160,0.25)';
  ctx.stroke();
  ctx.restore();
}

// --- Wood ------------------------------------------------------------------------------

function paintBranch(ctx, rng, f) {
  const p = f.poly;
  // Axis from the midpoints of the short sides.
  const ax = ((p[0] + p[6]) / 2) * CELL, ay = ((p[1] + p[7]) / 2) * CELL;
  const bx = ((p[2] + p[4]) / 2) * CELL, by = ((p[3] + p[5]) / 2) * CELL;
  const thick = f.thick * CELL;
  const len = Math.hypot(bx - ax, by - ay);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(by - ay, bx - ax));
  const g = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
  g.addColorStop(0, '#7a5332');
  g.addColorStop(0.4, '#5e3e22');
  g.addColorStop(1, '#2e1d0e');
  roundRect(ctx, 0, -thick / 2, len, thick, thick / 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  for (let k = 0; k < 10; k++) {
    const y = (rng() - 0.5) * thick * 0.8;
    ctx.strokeStyle = rng() < 0.6 ? 'rgba(25,14,5,0.5)' : 'rgba(160,120,80,0.35)';
    ctx.lineWidth = 0.6 + rng() * 0.8;
    ctx.beginPath();
    const x0 = rng() * len * 0.6;
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + len * (0.2 + rng() * 0.4), y + (rng() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintLog(ctx, rng, f) {
  const x = f.x0 * CELL, y = f.top * CELL;
  const lw = (f.x1 - f.x0) * CELL, lh = (f.bottom + 1 - f.top) * CELL;
  const r = Math.min(lh / 2, 16);

  // Ground shadow.
  ctx.fillStyle = 'rgba(10,6,3,0.4)';
  ctx.beginPath();
  ctx.ellipse(x + lw / 2, y + lh - 2, lw / 2 + 6, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body: rounded shading top to bottom.
  ctx.save();
  roundRect(ctx, x, y, lw, lh, r);
  const body = ctx.createLinearGradient(0, y, 0, y + lh);
  body.addColorStop(0, '#5a3f26');
  body.addColorStop(0.18, '#7b5a39');
  body.addColorStop(0.45, '#5e4127');
  body.addColorStop(0.8, '#3a2716');
  body.addColorStop(1, '#22170c');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();

  // Bark plates and furrows running along the log.
  for (let k = 0; k < 90; k++) {
    const fy = y + 2 + rng() * (lh - 4);
    const fx = x + rng() * lw;
    const flen = 20 + rng() * 90;
    const shade = (fy - y) / lh;
    ctx.strokeStyle = rng() < 0.65 ? `rgba(18,10,4,${0.35 + shade * 0.3})` : `rgba(165,125,85,${Math.max(0.05, 0.28 - shade * 0.2)})`;
    ctx.lineWidth = 0.7 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.bezierCurveTo(fx + flen * 0.33, fy + (rng() - 0.5) * 3, fx + flen * 0.66, fy + (rng() - 0.5) * 3, fx + flen, fy + (rng() - 0.5) * 2);
    ctx.stroke();
  }
  // Soft highlight along the top.
  const hl = ctx.createLinearGradient(0, y, 0, y + lh * 0.35);
  hl.addColorStop(0, 'rgba(210,180,140,0)');
  hl.addColorStop(0.45, 'rgba(210,180,140,0.12)');
  hl.addColorStop(1, 'rgba(210,180,140,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(x, y, lw, lh * 0.35);
  // Moss on top.
  for (let k = 0; k < lw / 2; k++) {
    const mx = x + rng() * lw;
    const my = y + 1 + Math.pow(rng(), 2) * lh * 0.35;
    ctx.fillStyle = `hsla(${70 + rng() * 30}, ${25 + rng() * 20}%, ${20 + rng() * 12}%, ${0.55 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(mx, my, 1.5 + rng() * 4.5, 1 + rng() * 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Cut ends showing growth rings.
  for (const ex of [x + r * 0.55, x + lw - r * 0.55]) {
    const cy = y + lh / 2, rx = r * 0.55, ry = lh / 2 - 1;
    ctx.fillStyle = '#9c7a52';
    ctx.beginPath();
    ctx.ellipse(ex, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,22,0.55)';
    ctx.lineWidth = 0.6;
    for (let k = 1; k < 7; k++) {
      ctx.beginPath();
      ctx.ellipse(ex, cy, rx * (k / 7), ry * (k / 7), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(30,18,8,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(ex, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(15,9,4,0.85)';
  roundRect(ctx, x, y, lw, lh, r);
  ctx.stroke();
}

// --- Sprigs and moss tufts along the litter ------------------------------------------

function paintSprigs(ctx, rng, w, typeAt) {
  ctx.lineCap = 'round';
  for (let k = 0; k < 170; k++) {
    const gx = Math.floor(rng() * GW);
    if (typeAt(gx * CELL, (w.litterTop[gx] - 1) * CELL) !== AIR) continue;
    const bx = (gx + rng()) * CELL, by = w.litterTop[gx] * CELL + 2;
    if (rng() < 0.35) {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `hsla(${70 + rng() * 25}, ${22 + rng() * 15}%, ${20 + rng() * 10}%, 0.8)`;
        ctx.beginPath();
        ctx.ellipse(bx + (rng() - 0.5) * 10, by - rng() * 3, 2 + rng() * 3, 1.2 + rng() * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    for (let b = 0; b < 4; b++) {
      const h = 5 + rng() * 14;
      ctx.strokeStyle = `hsla(${62 + rng() * 30}, ${18 + rng() * 15}%, ${22 + rng() * 12}%, 0.8)`;
      ctx.lineWidth = 0.7 + rng() * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + (rng() - 0.5) * 6, by - h * 0.6, bx + (rng() - 0.5) * 10, by - h);
      ctx.stroke();
    }
  }
}

// --- Helpers ---------------------------------------------------------------------------

function tracePoly(ctx, poly, s) {
  ctx.beginPath();
  ctx.moveTo(poly[0] * s, poly[1] * s);
  for (let k = 2; k < poly.length; k += 2) ctx.lineTo(poly[k] * s, poly[k + 1] * s);
  ctx.closePath();
}

function polyCircle(poly, s) {
  let cx = 0, cy = 0;
  const n = poly.length / 2;
  for (let k = 0; k < poly.length; k += 2) { cx += poly[k]; cy += poly[k + 1]; }
  cx /= n; cy /= n;
  let r = 0;
  for (let k = 0; k < poly.length; k += 2) r += Math.hypot(poly[k] - cx, poly[k + 1] - cy);
  return [cx * s, cy * s, (r / n) * s];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
