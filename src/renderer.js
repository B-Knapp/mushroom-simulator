// Draws the world under the camera. Rendering is decoupled from the
// simulation: it draws the latest snapshot at display rate.

import { WORLD_W, WORLD_H, CELL, GW } from './config.js';
import { Overlays } from './render/overlays.js';
import { NetworkView } from './render/network.js';

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = camera;
    this.dpr = 1;
    this.base = null;      // baked static world
    this.world = null;
    this.overlays = new Overlays();
    this.network = new NetworkView();
    this.resourceView = false;
    this.rainDrops = makeRain();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.setViewport(w, h);
  }

  setWorld(world, baked) {
    this.world = world;
    this.base = baked.base;
    this.foodLayer = baked.food;
    this.overlays.setWorld(world, baked.food);
  }

  clearWorld() {
    this.world = null;
    this.base = null;
    this.network.clear();
  }

  setNetwork(snap) {
    this.network.set(snap, performance.now());
  }

  updateDecay(eaten, colon) {
    this.overlays.updateDecay(eaten, colon);
  }

  updateGrids(moisture, nutrient) {
    this.overlays.update(moisture, nutrient);
  }

  draw(state, now) {
    const { ctx, cam, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#17110c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    ctx.imageSmoothingEnabled = true;

    if (!this.base) return;
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.foodLayer.canvas, 0, 0);

    if (this.resourceView) {
      ctx.fillStyle = 'rgba(8,6,4,0.8)';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.overlays.res.canvas, 0, 0, WORLD_W, WORLD_H);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(this.overlays.wet.canvas, 0, 0, WORLD_W, WORLD_H);
    }

    // Day and night: the world dims after dusk (which also lets the glow show).
    const night = state ? nightFactor(state.minute) : 0;
    if (!this.resourceView && night > 0.01) {
      ctx.fillStyle = `rgba(6,9,18,${0.32 * night})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    this.network.draw(ctx, cam, this.resourceView, now, dpr, state ? state.speed : 0, night);

    if (state && state.raining) this.drawRain(state, now);

    // Gentle vignette, in screen space.
    const W = this.canvas.width, H = this.canvas.height;
    if (!this.vignette || this.vigW !== W || this.vigH !== H) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.38)');
      this.vignette = g; this.vigW = W; this.vigH = H;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // Rain streaks falling through the air band to the litter.
  drawRain(state, now) {
    const { ctx, cam, world } = this;
    const fade = Math.min(1, state.rainLeft / 60);
    const x0 = Math.max(0, cam.x), x1 = Math.min(WORLD_W, cam.x + cam.vw / cam.zoom);
    ctx.strokeStyle = `rgba(190,205,220,${0.35 * fade})`;
    ctx.lineWidth = Math.max(0.6, 0.9 / cam.zoom);
    ctx.beginPath();
    const t = now / 1000;
    for (const d of this.rainDrops) {
      const x = (d.x * WORLD_W + t * 60) % WORLD_W;
      if (x < x0 || x > x1) continue;
      const gx = Math.min(GW - 1, Math.floor(x / CELL));
      const floor = (world ? surfaceAt(world, gx) : 30) * CELL;
      const y = ((d.y + t * d.v) % 1) * floor;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, Math.min(floor, y + 14));
    }
    ctx.stroke();
  }
}

// 0 at midday, 1 through the night, with soft dawn and dusk.
function nightFactor(minute) {
  const hour = (minute % 1440) / 60;
  const sun = Math.sin(((hour - 6) / 12) * Math.PI); // > 0 between 6:00 and 18:00
  const t = Math.max(0, Math.min(1, (sun + 0.15) / 0.5));
  return 1 - t * t * (3 - 2 * t);
}

function surfaceAt(w, gx) {
  if (!w.surface) {
    // Topmost non-air row per column.
    w.surface = new Int16Array(GW);
    for (let x = 0; x < GW; x++) {
      let y = 0;
      while (y < w.grid.GH && w.cellType[y * GW + x] === 0) y++;
      w.surface[x] = y;
    }
  }
  return w.surface[gx];
}

function makeRain() {
  const drops = [];
  for (let k = 0; k < 2500; k++) drops.push({ x: Math.random(), y: Math.random(), v: 0.9 + Math.random() * 0.6 });
  return drops;
}
