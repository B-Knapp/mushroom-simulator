// The hyphal mat: the fine, cottony web of single hyphae around the cords.
//
// Each cord, once it has grown on screen, deposits a few dozen fine,
// curving hyphae into a world-sized image that builds up over time — so a
// well-explored patch of soil turns into a dense white mat, the way real
// mycelium does, at no per-frame cost. The mat slowly fades (old hyphae
// die and are reabsorbed), so it marks where the colony has been recently
// rather than forever.

import { WORLD_W, WORLD_H } from '../config.js';

const RES = 2;               // mat pixels per world unit
const HALF_LIFE_MIN = 15 * 1440; // the mat halves in 15 simulated days
const FADE_STEP = 0.03;      // fade in steps of at least 3%
const CELL = 16;             // coverage grid, world units
const FULL = 60;             // deposits per cell before the mat stops thickening

export class HyphalMat {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = null;
    this.pendingFade = 0;
    this.lastT = undefined;
    this.cover = new Float32Array(Math.ceil(WORLD_W / CELL) * Math.ceil(WORLD_H / CELL));
  }

  clear() {
    if (this.ctx) this.ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    this.cover.fill(0);
    this.pendingFade = 0;
    this.lastT = undefined;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    this.canvas.width = WORLD_W * RES;
    this.canvas.height = WORLD_H * RES;
    const c = this.canvas.getContext('2d');
    c.setTransform(RES, 0, 0, RES, 0, 0);
    c.lineCap = 'round';
    this.ctx = c;
    return c;
  }

  // Lay down hyphae around the given cords (segs: x0,y0,x1,y1 per cord).
  deposit(list, segs, D) {
    if (!list.length) return;
    const c = this.ensure();
    const faint = new Path2D(), soft = new Path2D(), fibre = new Path2D();
    for (const e of list) {
      const ax = segs[e * 4], ay = segs[e * 4 + 1], bx = segs[e * 4 + 2], by = segs[e * 4 + 3];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy, dx);
      const nx = -dy / len, ny = dx / len;
      let h = hash(ax, ay, bx, by);
      const r = () => ((h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0) / 4294967296);

      // Fibres running along the cord, slightly wavy.
      for (let k = 0; k < 2; k++) {
        const o1 = (r() - 0.5) * 1.6, o2 = (r() - 0.5) * 1.6;
        fibre.moveTo(ax + nx * o1, ay + ny * o1);
        fibre.quadraticCurveTo((ax + bx) / 2 + nx * (r() - 0.5) * 2.4, (ay + by) / 2 + ny * (r() - 0.5) * 2.4,
          bx + nx * o2, by + ny * o2);
      }

      // Hyphae fanning out from the cord, more around thicker cords, fewer
      // where the mat is already thick (so dense patches don't blow out).
      const ci = Math.floor((ay + by) / 2 / CELL) * Math.ceil(WORLD_W / CELL) + Math.floor((ax + bx) / 2 / CELL);
      const room = Math.max(0, 1 - (this.cover[ci] || 0) / FULL);
      const n = Math.round((14 + Math.min(10, Math.floor((D ? D[e] : 0.5) * 4))) * room);
      if (ci >= 0 && ci < this.cover.length) this.cover[ci] += 1;
      for (let k = 0; k < n; k++) {
        const u = r();
        const sx = ax + dx * u, sy = ay + dy * u;
        const side = r() < 0.5 ? -1 : 1;
        // Mostly forward-leaning, like real branching hyphae.
        let a = ang + side * (0.3 + r() * 1.3);
        const L = 3 + r() * r() * 30;
        const bend = (r() - 0.5) * 0.9;
        const mx = sx + Math.cos(a) * L * 0.5, my = sy + Math.sin(a) * L * 0.5;
        a += bend;
        const ex = mx + Math.cos(a) * L * 0.5, ey = my + Math.sin(a) * L * 0.5;
        const p = r() < 0.35 ? soft : faint;
        p.moveTo(sx, sy);
        p.quadraticCurveTo(mx, my, ex, ey);
        // Sometimes a side branch off the hypha.
        if (r() < 0.55) {
          const a2 = a + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6);
          const L2 = L * (0.3 + r() * 0.4);
          faint.moveTo(mx, my);
          faint.quadraticCurveTo(mx + Math.cos(a2) * L2 * 0.6, my + Math.sin(a2) * L2 * 0.6,
            mx + Math.cos(a2 + bend) * L2, my + Math.sin(a2 + bend) * L2);
        }
      }
    }
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = 'rgba(242,238,228,0.085)';
    c.lineWidth = 0.32;
    c.stroke(faint);
    c.strokeStyle = 'rgba(246,242,232,0.16)';
    c.lineWidth = 0.35;
    c.stroke(soft);
    c.strokeStyle = 'rgba(248,244,236,0.12)';
    c.lineWidth = 0.35;
    c.stroke(fibre);
  }

  // Age the mat by the simulated time that has passed.
  age(simT) {
    if (!this.ctx || simT === undefined) { this.lastT = simT; return; }
    if (this.lastT !== undefined && simT > this.lastT) {
      const keep = Math.pow(0.5, (simT - this.lastT) / HALF_LIFE_MIN);
      this.pendingFade = 1 - (1 - this.pendingFade) * keep;
    }
    this.lastT = simT;
    if (this.pendingFade < FADE_STEP) return;
    const c = this.ctx;
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = `rgba(0,0,0,${this.pendingFade})`;
    c.fillRect(0, 0, WORLD_W, WORLD_H);
    c.globalCompositeOperation = 'source-over';
    const keep = 1 - this.pendingFade;
    for (let i = 0; i < this.cover.length; i++) this.cover[i] *= keep;
    this.pendingFade = 0;
  }

  // Draw in world coordinates (the context already holds the camera transform).
  draw(ctx) {
    if (!this.ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, WORLD_W, WORLD_H);
  }
}

function hash(ax, ay, bx, by) {
  let h = Math.imul((ax * 16) | 0, 0x9e3779b1) ^ Math.imul((ay * 16) | 0, 0x85ebca6b);
  h = Math.imul(h ^ ((bx * 16) | 0), 0xc2b2ae35) ^ Math.imul((by * 16) | 0, 0x27d4eb2f);
  return (h ^ (h >>> 16)) >>> 0;
}
