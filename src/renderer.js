// Draws the world under the camera. Rendering is decoupled from the
// simulation: it draws the latest snapshot at display rate.

import { WORLD_W, WORLD_H } from './config.js';

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = camera;
    this.dpr = 1;
    this.soil = null;
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.setViewport(w, h);
  }

  setSoil(soilCanvas) {
    this.soil = soilCanvas;
  }

  draw(/* state */) {
    const { ctx, cam, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b140f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    ctx.imageSmoothingEnabled = true;

    if (this.soil) ctx.drawImage(this.soil, 0, 0);

    // World border, so the edges read when zoomed out.
    ctx.strokeStyle = 'rgba(239,230,212,0.10)';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  }
}
