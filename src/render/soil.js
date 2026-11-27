// Bakes the static look of the world into one offscreen canvas: soil
// layers, grain, rocks, leaf litter, buried branches and the fallen log.
// Dynamic things (wetness, the network, overlays) are drawn on top.

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

  // --- Sky / air band ---------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, 34 * CELL);
  sky.addColorStop(0, '#1f1a16');
  sky.addColorStop(1, '#2e251d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // --- Soil layers from the type grid, smoothed ------------------------------
  {
    const small = document.createElement('canvas');
    small.width = GW;
    small.height = GH;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(GW, GH);
    for (let y = 0; y < GH; y++) {
      let prev = AIR;
      for (let x = 0; x < GW; x++) {
        let t = w.cellType[y * GW + x];
        // Rocks, wood and sand are drawn as shapes later; paint what's around them.
        if (t === ROCK || t === WOOD || t === SAND) t = prev;
        else prev = t;
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

  // --- Sand lenses, as soft shapes ------------------------------------------------
  for (const poly of w.sandPolys) {
    tracePoly(ctx, poly, CELL);
    ctx.fillStyle = 'rgba(150,118,80,0.5)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(150,118,80,0.25)';
    ctx.stroke();
  }

  // --- Grain -----------------------------------------------------------------
  const nGrain = Math.floor((WORLD_W * WORLD_H) / 40);
  for (let k = 0; k < nGrain; k++) {
    const x = rng() * WORLD_W, y = rng() * WORLD_H;
    const t = typeAt(x, y);
    if (t === AIR || t === LITTER) continue;
    const s = 0.4 + rng() * 1.5;
    if (t === SAND) ctx.fillStyle = rng() < 0.6 ? 'rgba(205,175,130,0.5)' : 'rgba(60,40,22,0.35)';
    else ctx.fillStyle = rng() < 0.55 ? 'rgba(30,18,10,0.42)' : 'rgba(175,140,100,0.26)';
    ctx.fillRect(x, y, s, s);
  }
  // Small pebbles for texture (not simulated).
  for (let k = 0; k < 160; k++) {
    const x = rng() * WORLD_W, y = rng() * WORLD_H;
    const t = typeAt(x, y);
    if (t === AIR || t === LITTER || t === ROCK || t === WOOD) continue;
    const r = 1 + rng() * 2.5;
    ctx.fillStyle = `hsl(35, ${8 + rng() * 10}%, ${36 + rng() * 18}%)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.55 + rng() * 0.35), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Rocks -----------------------------------------------------------------
  for (const poly of w.rocks) {
    const hue = 30 + rng() * 15, sat = 5 + rng() * 8, lit = 40 + rng() * 14;
    tracePoly(ctx, poly, CELL);
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lit}%)`;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lit - 18}%, 0.8)`;
    ctx.stroke();
    // Soft highlight toward the top-left.
    ctx.save();
    ctx.clip();
    const [cx, cy, r] = polyCircle(poly, CELL);
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lit + 14}%, 0.35)`;
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.6, r * 0.4, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- Leaf litter -------------------------------------------------------------
  const leafColors = ['#8a5a26', '#a6742f', '#6e4a22', '#93622b', '#5d3f1f'];
  const drawLeaf = (x, y, r, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.42, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let x = 0; x < GW; x++) {
    const top = w.litterTop[x] * CELL, bot = w.ground[x] * CELL;
    const n = Math.round((bot - top) / 5);
    for (let k = 0; k < n; k++) {
      const wx = (x + rng()) * CELL, wy = top + rng() * (bot - top);
      if (typeAt(wx, wy) !== LITTER) continue;
      drawLeaf(wx, wy, 2.5 + rng() * 4, leafColors[(rng() * leafColors.length) | 0]);
    }
  }
  // Leaf piles: fresher, more colorful leaves on top.
  for (const f of w.foods) {
    if (f.kind !== 'leaves') continue;
    const fresh = ['#b5782c', '#c48a35', '#9b5a1f', '#a8432a', '#c2a04a'];
    for (let k = 0; k < f.half * 30; k++) {
      const gx = f.cx + (rng() * 2 - 1) * f.half;
      const x = Math.min(GW - 1, Math.max(0, Math.floor(gx)));
      const top = w.litterTop[x] * CELL, bot = w.ground[x] * CELL;
      const wy = top + Math.pow(rng(), 1.6) * (bot - top);
      if (typeAt(gx * CELL, wy) !== LITTER) continue;
      drawLeaf(gx * CELL, wy, 3 + rng() * 5, fresh[(rng() * fresh.length) | 0]);
    }
  }

  // --- Buried branches ---------------------------------------------------------
  for (const f of w.foods) {
    if (f.kind !== 'branch') continue;
    tracePoly(ctx, f.poly, CELL);
    ctx.fillStyle = '#5c3d22';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(30,18,8,0.8)';
    ctx.stroke();
    // Grain lines along the branch.
    const [x0, y0, x1, y1] = [f.poly[0], f.poly[1], f.poly[2], f.poly[3]];
    const [x3, y3] = [f.poly[6], f.poly[7]];
    ctx.save();
    ctx.clip();
    for (let k = 1; k < 5; k++) {
      const t = k / 5 + (rng() - 0.5) * 0.08;
      ctx.strokeStyle = k % 2 ? 'rgba(140,98,58,0.5)' : 'rgba(40,24,10,0.45)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo((x0 + (x3 - x0) * t) * CELL, (y0 + (y3 - y0) * t) * CELL);
      ctx.lineTo((x1 + (f.poly[4] - x1) * t) * CELL, (y1 + (f.poly[5] - y1) * t) * CELL);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Fallen log ----------------------------------------------------------------
  for (const f of w.foods) {
    if (f.kind !== 'log') continue;
    const x = f.x0 * CELL, y = f.top * CELL;
    const lw = (f.x1 - f.x0) * CELL, lh = (f.bottom + 1 - f.top) * CELL;
    const r = Math.min(lh / 2, 14);
    ctx.save();
    roundRect(ctx, x, y, lw, lh, r);
    const bark = ctx.createLinearGradient(0, y, 0, y + lh);
    bark.addColorStop(0, '#6a4a2c');
    bark.addColorStop(0.45, '#57391f');
    bark.addColorStop(1, '#2f1f10');
    ctx.fillStyle = bark;
    ctx.fill();
    ctx.clip();
    // Bark furrows.
    for (let k = 0; k < 26; k++) {
      const fy = y + 3 + rng() * (lh - 6);
      const fx = x + rng() * lw * 0.7;
      ctx.strokeStyle = rng() < 0.6 ? 'rgba(25,15,6,0.55)' : 'rgba(150,110,70,0.35)';
      ctx.lineWidth = 0.8 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.bezierCurveTo(fx + lw * 0.1, fy + (rng() - 0.5) * 4, fx + lw * 0.2, fy + (rng() - 0.5) * 4, fx + lw * (0.15 + rng() * 0.25), fy + (rng() - 0.5) * 3);
      ctx.stroke();
    }
    // Moss on top.
    for (let k = 0; k < lw / 3; k++) {
      const mx = x + rng() * lw;
      ctx.fillStyle = `hsla(${85 + rng() * 25}, ${35 + rng() * 25}%, ${26 + rng() * 14}%, 0.85)`;
      ctx.beginPath();
      ctx.ellipse(mx, y + 2 + rng() * 5, 2 + rng() * 5, 1.5 + rng() * 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(20,12,5,0.8)';
    roundRect(ctx, x, y, lw, lh, r);
    ctx.stroke();
  }

  // --- A few sprigs and moss tufts along the litter --------------------------
  for (let k = 0; k < 120; k++) {
    const gx = Math.floor(rng() * GW);
    if (typeAt(gx * CELL, (w.litterTop[gx] - 1) * CELL) !== AIR) continue;
    const bx = (gx + rng()) * CELL, by = w.litterTop[gx] * CELL + 2;
    ctx.strokeStyle = `hsla(${80 + rng() * 30}, 35%, ${28 + rng() * 12}%, 0.9)`;
    ctx.lineWidth = 1;
    for (let b = 0; b < 3; b++) {
      const h = 4 + rng() * 10;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + (rng() - 0.5) * 6, by - h * 0.6, bx + (rng() - 0.5) * 8, by - h);
      ctx.stroke();
    }
  }

  return c;
}

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
