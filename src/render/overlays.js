// Grid-resolution layers drawn over the baked soil, scaled up with
// smoothing: wet-soil darkening (normal view) and the glowing resource
// view (moisture in blue, nutrients in amber).

import { GW, GH } from '../config.js';
import { FC, AIR, ROCK, WOOD } from '../soilTypes.js';

export class Overlays {
  constructor() {
    this.wet = makeLayer();
    this.res = makeLayer();
    this.decay = makeLayer();
    this.hasDecay = false;
    this.cellType = null;
    this.food = null;
  }

  setWorld(w) {
    this.cellType = w.cellType;
    this.food = w.food;
    this.world = w;
    this.hasDecay = false;
    // What shows through once a food cell is eaten away.
    this.under = new Uint8Array(GW * GH * 3);
    for (let i = 0; i < w.food.length; i++) {
      const fid = w.food[i];
      if (fid === -1) continue;
      const kind = w.foods[fid].kind;
      const x = i % GW, y = (i / GW) | 0;
      let c;
      if (kind === 'branch') c = [107, 76, 52];               // loam
      else if (kind === 'log') c = y >= w.litterTop[x] ? [62, 44, 29] : [43, 34, 27];
      else c = y >= w.ground[x] - 3 ? [96, 66, 36] : [43, 34, 27]; // thin litter, else air
      this.under.set(c, i * 3);
    }
  }

  // Colonized food bleaches pale (as wood-rotting fungi do), then crumbles
  // away as it's eaten.
  updateDecay(eaten, colon) {
    if (!this.food) return;
    const d = this.decay.img.data;
    const food = this.food, under = this.under;
    let any = false;
    for (let i = 0; i < food.length; i++) {
      const k = i * 4;
      if (food[i] === -1) { d[k + 3] = 0; continue; }
      const e = eaten[i] / 255;
      if (e > 0.55) {
        const a = Math.min(1, (e - 0.55) / 0.4);
        d[k] = under[i * 3]; d[k + 1] = under[i * 3 + 1]; d[k + 2] = under[i * 3 + 2];
        d[k + 3] = a * 255;
        any = true;
      } else if (colon[i] || e > 0.05) {
        const a = (colon[i] ? 0.22 : 0) + 0.5 * Math.min(1, e * 1.8);
        d[k] = 232; d[k + 1] = 222; d[k + 2] = 198;
        d[k + 3] = Math.min(0.7, a) * 255;
        any = true;
      } else {
        d[k + 3] = 0;
      }
    }
    this.decay.ctx.putImageData(this.decay.img, 0, 0);
    this.hasDecay = any;
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
        wd[k + 3] = 0;
        rd[k] = rd[k + 1] = rd[k + 2] = 0; rd[k + 3] = 255;
        continue;
      }
      const sat = moisture[i] / 255;
      // Normal view: soil darkens as it gets wetter, relative to how much
      // water that soil normally holds.
      const rel = sat / Math.max(0.2, FC[ty]);
      let a = Math.min(1, Math.max(0, (rel - 0.35) / 1.4)) * 0.6;
      if (ty === WOOD) a *= 0.6;
      wd[k] = 22; wd[k + 1] = 13; wd[k + 2] = 6; wd[k + 3] = a * 255;

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
