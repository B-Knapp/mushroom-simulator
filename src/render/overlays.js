// Grid-resolution layers drawn over the baked soil, scaled up with
// smoothing: wet-soil darkening (normal view) and the glowing resource
// view (moisture in blue, nutrients in amber).

import { GW, GH } from '../config.js';
import { FC, AIR, ROCK, WOOD } from '../soilTypes.js';

export class Overlays {
  constructor() {
    this.wet = makeLayer();
    this.res = makeLayer();
    this.wetA = new Float32Array(GW * GH);
    this.tmpA = new Float32Array(GW * GH);
    this.cellType = null;
    this.food = null;
  }

  setWorld(w, foodLayer) {
    this.cellType = w.cellType;
    this.food = w.food;
    this.foodLayer = foodLayer;
    this.lastDecayT = 0;
    // Each food cell crumbles at its own point, so edges look ragged.
    this.crumble = new Float32Array(w.food.length);
    let h = 2166136261;
    for (let i = 0; i < w.food.length; i++) {
      h = Math.imul(h ^ i, 16777619) >>> 0;
      this.crumble[i] = 0.4 + ((h >>> 8) & 1023) / 1023 * 0.45;
    }
  }

  // Colonized food bleaches pale (as wood-rotting fungi do), then crumbles
  // away as it's eaten. Redrawn at most about once a second.
  updateDecay(eaten, colon) {
    if (!this.food || !this.foodLayer) return;
    const now = performance.now();
    if (now - this.lastDecayT < 900) return;
    this.lastDecayT = now;
    if (!this.holes) {
      this.holes = makeLayer();
      this.bleach = makeLayer();
    }
    const hd = this.holes.img.data, bd = this.bleach.img.data;
    const food = this.food;
    for (let i = 0; i < food.length; i++) {
      const k = i * 4;
      if (food[i] === -1) { hd[k + 3] = 0; bd[k + 3] = 0; continue; }
      const e = eaten[i] / 255;
      hd[k + 3] = e > this.crumble[i] ? 255 : 0;
      const a = (colon[i] ? 0.22 : 0) + 0.4 * Math.min(1, e * 1.6);
      bd[k] = 232; bd[k + 1] = 224; bd[k + 2] = 204; bd[k + 3] = Math.min(0.6, a) * 255;
    }
    this.holes.ctx.putImageData(this.holes.img, 0, 0);
    this.bleach.ctx.putImageData(this.bleach.img, 0, 0);
    this.foodLayer.render(eaten, this.holes.canvas, this.bleach.canvas, this.crumble);
  }

  // moisture, nutrient: Uint8Array (0..255) from the worker.
  update(moisture, nutrient) {
    if (!this.cellType) return;
    const t = this.cellType, food = this.food;
    const wd = this.wet.img.data, rd = this.res.img.data;
    for (let i = 0; i < t.length; i++) {
      const k = i * 4;
      const ty = t[i];
      if (ty === AIR || ty === ROCK) {
        this.wetA[i] = -1;
        rd[k] = rd[k + 1] = rd[k + 2] = 0; rd[k + 3] = 255;
        continue;
      }
      const sat = moisture[i] / 255;
      // Normal view: soil darkens as it gets wetter, relative to how much
      // water that soil normally holds. Blurred below, so it reads as damp
      // earth rather than a grid.
      const rel = sat / Math.max(0.2, FC[ty]);
      let a = Math.min(1, Math.max(0, (rel - 0.4) / 1.3)) * 0.42;
      if (ty === WOOD) a *= 0.6;
      this.wetA[i] = a;

      // Resource view: additive blue for water, amber for nutrients.
      const n = food[i] !== -1 ? 0.85 : Math.min(1, (nutrient[i] / 255) * 2.2);
      // Blue shows wetness relative to what this soil normally holds, so
      // damp clay reads as normal and fresh rain or dry spots stand out.
      const wv = Math.pow(Math.min(1, Math.max(0, (rel - 0.55) / 1.2)), 1.2) * 0.8;
      rd[k] = Math.min(255, 40 * wv + 255 * n);
      rd[k + 1] = Math.min(255, 140 * wv + 160 * n);
      rd[k + 2] = Math.min(255, 255 * wv + 40 * n);
      rd[k + 3] = 255;
    }
    blurAlpha(this.wetA, this.tmpA);
    blurAlpha(this.wetA, this.tmpA);
    for (let i = 0; i < t.length; i++) {
      const k = i * 4;
      wd[k] = 22; wd[k + 1] = 13; wd[k + 2] = 6;
      wd[k + 3] = this.wetA[i] > 0 ? this.wetA[i] * 255 : 0;
    }
    this.wet.ctx.putImageData(this.wet.img, 0, 0);
    this.res.ctx.putImageData(this.res.img, 0, 0);
  }
}

function makeLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = GW;
  canvas.height = GH;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx, img: ctx.createImageData(GW, GH) };
}

// Box blur (radius 2) of a grid of alphas, skipping cells marked -1
// (air and rock), which neither give nor receive.
function blurAlpha(a, tmp) {
  const R = 2;
  for (let y = 0; y < GH; y++) {
    const row = y * GW;
    for (let x = 0; x < GW; x++) {
      const i = row + x;
      if (a[i] < 0) { tmp[i] = -1; continue; }
      let sum = 0, n = 0;
      for (let d = -R; d <= R; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= GW) continue;
        const v = a[row + xx];
        if (v >= 0) { sum += v; n++; }
      }
      tmp[i] = sum / n;
    }
  }
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (tmp[i] < 0) { a[i] = -1; continue; }
      let sum = 0, n = 0;
      for (let d = -R; d <= R; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= GH) continue;
        const v = tmp[yy * GW + x];
        if (v >= 0) { sum += v; n++; }
      }
      a[i] = sum / n;
    }
  }
}
