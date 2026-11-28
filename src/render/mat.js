// The hyphal mat: the fine, cottony web of single hyphae around the cords.
//
// Each cord, once it has grown on screen, sprouts a few dozen fine,
// wavy hyphae that grow out over a couple of seconds and then settle into a world-sized image that builds up over time — so a
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
const GROW_S = 2.2;          // seconds for new hairs to grow out
const MAX_LIVE = 9000;       // most hairs animating at once

export class HyphalMat {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = null;
    this.pendingFade = 0;
    this.lastT = undefined;
    this.batches = [];
    this.live = 0;
    this.clock = 0;
    this.cover = new Float32Array(Math.ceil(WORLD_W / CELL) * Math.ceil(WORLD_H / CELL));
  }

  clear() {
    if (this.ctx) this.ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    this.cover.fill(0);
    this.batches = [];
    this.live = 0;
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

  // Lay down hyphae around the given cords (segs: x0,y0,x1,y1 per cord;
  // mid: the wobbled middle of each cord). The hairs don't appear at once:
  // they're queued and grow outward over a couple of seconds (see grow).
  deposit(list, segs, D, mid) {
    if (!list.length) return;
    this.ensure();
    const pts = [], cls = [], delay = [];
    for (const e of list) {
      const ax = segs[e * 4], ay = segs[e * 4 + 1], bx = segs[e * 4 + 2], by = segs[e * 4 + 3];
      const mx = mid ? mid[e * 2] : (ax + bx) / 2, my = mid ? mid[e * 2 + 1] : (ay + by) / 2;
      const ang = Math.atan2(by - ay, bx - ax);
      let h = hash(ax, ay, bx, by);
      const r = () => ((h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0) / 4294967296);
      // A point on the (wobbly) cord: along a -> mid -> b.
      const along = (u) => u < 0.5
        ? [ax + (mx - ax) * u * 2, ay + (my - ay) * u * 2]
        : [mx + (bx - mx) * (u - 0.5) * 2, my + (by - my) * (u - 0.5) * 2];

      // Fewer hairs where the mat is already thick (so dense patches don't
      // blow out); otherwise an uneven number per cord, more on thick ones.
      const ci = Math.floor(my / CELL) * Math.ceil(WORLD_W / CELL) + Math.floor(mx / CELL);
      const room = Math.max(0, 1 - (this.cover[ci] || 0) / FULL);
      if (ci >= 0 && ci < this.cover.length) this.cover[ci] += 1;
      const base = 10 + Math.min(10, (D ? D[e] : 0.5) * 4);
      const n = Math.round(base * (0.2 + r() * 1.6) * room);

      // A fibre running along the cord.
      if (room > 0.1) {
        const o = (r() - 0.5) * 1.4;
        const nx = -Math.sin(ang) * o, ny = Math.cos(ang) * o;
        pts.push(ax + nx, ay + ny, mx + nx * 1.5, my + ny * 1.5, (mx + bx) / 2 + nx, (my + by) / 2 + ny, bx + nx * 0.5, by + ny * 0.5);
        cls.push(2); delay.push(r() * 0.3);
      }
      for (let k = 0; k < n; k++) {
        const [sx, sy] = along(r());
        // Any direction, but more often forward and out to the sides.
        let a = ang + (r() < 0.5 ? -1 : 1) * (0.25 + Math.pow(r(), 1.4) * 2.6);
        const L = 2 + Math.pow(r(), 2.2) * 34;
        let x = sx, y = sy;
        pts.push(x, y);
        for (let s = 0; s < 3; s++) {
          a += (r() - 0.5) * 0.9;
          x += Math.cos(a) * L / 3; y += Math.sin(a) * L / 3;
          pts.push(x, y);
        }
        cls.push(r() < 0.3 ? 1 : 0);
        delay.push(r() * 0.6);
        // Some hairs branch.
        if (r() < 0.35) {
          const i = pts.length - 6;
          let bx2 = pts[i], by2 = pts[i + 1], a2 = a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7);
          const L2 = L * (0.25 + r() * 0.4);
          pts.push(bx2, by2);
          for (let s = 0; s < 3; s++) {
            a2 += (r() - 0.5) * 0.8;
            bx2 += Math.cos(a2) * L2 / 3; by2 += Math.sin(a2) * L2 / 3;
            pts.push(bx2, by2);
          }
          cls.push(0); delay.push(0.4 + r() * 0.5);
        }
      }
    }
    if (!cls.length) return;
    this.batches.push({ pts: Float32Array.from(pts), cls: Uint8Array.from(cls), delay: Float32Array.from(delay), t0: this.clock });
    this.live += cls.length;
    // Keep the per-frame work bounded: finish the oldest growth early.
    while (this.live > MAX_LIVE && this.batches.length > 1) this.commit(this.batches.shift());
  }

  // Advance the growth animation (seconds of animation time; pass 0 when paused).
  grow(dt) {
    this.clock += dt;
    while (this.batches.length && this.clock - this.batches[0].t0 > GROW_S * 1.7) this.commit(this.batches.shift());
  }

  commit(b) {
    this.live -= b.cls.length;
    this.strokeHairs(this.ctx, b, 1);
  }

  // Hairs still growing, drawn on top of the mat in world coordinates.
  drawGrowing(ctx) {
    for (const b of this.batches) {
      const u = (this.clock - b.t0) / GROW_S;
      this.strokeHairs(ctx, b, u);
    }
  }

  strokeHairs(c, b, u) {
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    const P = b.pts;
    for (let i = 0, k = 0; k < b.cls.length; k++, i += 8) {
      // Each hair starts after its own delay and grows over the rest.
      let f = u >= 1 ? 1 : Math.max(0, Math.min(1, (u - b.delay[k]) / (1 - b.delay[k] * 0.6)));
      if (f <= 0) continue;
      f = 1 - (1 - f) * (1 - f); // ease out: fast start, slow finish
      const p = paths[b.cls[k]];
      p.moveTo(P[i], P[i + 1]);
      const segs = f * 3;
      for (let s = 0; s < 3; s++) {
        const j = i + 2 + s * 2;
        if (s + 1 <= segs) { p.lineTo(P[j], P[j + 1]); continue; }
        const t = segs - s;
        p.lineTo(P[j - 2] + (P[j] - P[j - 2]) * t, P[j - 1] + (P[j + 1] - P[j - 1]) * t);
        break;
      }
    }
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(242,238,228,0.085)';
    c.lineWidth = 0.3;
    c.stroke(paths[0]);
    c.strokeStyle = 'rgba(246,242,232,0.16)';
    c.lineWidth = 0.34;
    c.stroke(paths[1]);
    c.strokeStyle = 'rgba(248,244,236,0.12)';
    c.lineWidth = 0.4;
    c.stroke(paths[2]);
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
