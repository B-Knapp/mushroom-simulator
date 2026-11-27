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
    this.base = baked;
    this.overlays.setWorld(world);
  }

  clearWorld() {
    this.world = null;
    this.base = null;
    this.network.clear();
  }

  setNetwork(snap, minute) {
    this.network.set(snap, minute);
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

    if (this.resourceView) {
      ctx.fillStyle = 'rgba(8,6,4,0.8)';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.overlays.res.canvas, 0, 0, WORLD_W, WORLD_H);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(this.overlays.wet.canvas, 0, 0, WORLD_W, WORLD_H);
    }

    this.network.draw(ctx, cam, this.resourceView, now, dpr);

    if (state && state.raining) this.drawRain(state, now);

    ctx.strokeStyle = 'rgba(239,230,212,0.10)';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
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
