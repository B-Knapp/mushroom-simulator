// Draws the fungal network.
//
// Cords are grouped into width buckets by thickness and built into Path2D
// objects whenever a new snapshot arrives. When zoomed out, they're drawn
// into a cached image at most ~15 times a second; when zoomed in, they're
// stroked directly so they stay sharp.
//
// Drawn live every frame on top: flow pulses moving along busy cords, and
// growing tips extending smoothly between snapshots.
//
// Normal view: pale, soft, cottony threads. Resource view: glowing teal
// with amber flow.

const SEG = 6;
const BUCKETS = [
  { maxD: 0.9, w: 0.35, a: 0.4 },
  { maxD: 1.4, w: 0.6, a: 0.56 },
  { maxD: 2.0, w: 1.1, a: 0.72 },
  { maxD: 2.8, w: 1.8, a: 0.86 },
  { maxD: Infinity, w: 2.8, a: 0.95 },
];
const CACHE_MS = 66;
const PULSE_MIN = 0.03;   // flow below this shows no pulse
const PULSE_MAX = 2500;   // most pulses drawn

export class NetworkView {
  constructor() {
    this.cache = document.createElement('canvas');
    this.cctx = this.cache.getContext('2d');
    this.phase = 0;
    this.lastNow = 0;
    this.clear();
  }

  clear() {
    this.paths = BUCKETS.map(() => null);
    this.segs = null;
    this.cacheKey = '';
    this.tips = null;
    this.spore = null;
    this.edgeCount = 0;
    this.pulses = null;
    this.dirty = true;
  }

  set(snap, now) {
    const { nodeX: x, nodeY: y, edgeA: a, edgeB: b, edgeD: D, edgeQ: Q } = snap;
    const n = a.length;
    const segs = new Float32Array(n * 4);
    const bucket = new Uint8Array(n);
    const busy = [];
    for (let e = 0; e < n; e++) {
      segs[e * 4] = x[a[e]]; segs[e * 4 + 1] = y[a[e]];
      segs[e * 4 + 2] = x[b[e]]; segs[e * 4 + 3] = y[b[e]];
      let k = 0;
      while (D[e] > BUCKETS[k].maxD) k++;
      bucket[e] = k;
      if (Math.abs(Q[e]) > PULSE_MIN) busy.push(e);
    }
    // Pulses on the busiest cords, oriented with the flow.
    busy.sort((i, j) => Math.abs(Q[j]) - Math.abs(Q[i]));
    const m = Math.min(PULSE_MAX, busy.length);
    const pulses = new Float32Array(m * 5);
    const qTop = m ? Math.abs(Q[busy[0]]) : 1;
    for (let k = 0; k < m; k++) {
      const e = busy[k];
      const fwd = Q[e] > 0; // positive flow runs from a to b
      const from = fwd ? a[e] : b[e], to = fwd ? b[e] : a[e];
      pulses[k * 5] = x[from]; pulses[k * 5 + 1] = y[from];
      pulses[k * 5 + 2] = x[to]; pulses[k * 5 + 3] = y[to];
      pulses[k * 5 + 4] = Math.sqrt(Math.abs(Q[e]) / qTop);
    }
    this.segs = segs;
    this.bucket = bucket;
    this.pulses = pulses;
    this.tips = snap.tips;
    this.tipTime = now;
    this.spore = snap.spore;
    this.edgeCount = n;
    this.dirty = true;
  }

  draw(ctx, cam, glow, now, dpr, speed) {
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    // Pulses travel faster at higher sim speeds, but gently.
    this.phase += dt * (speed > 0 ? 0.9 * Math.pow(speed, 0.3) : 0);

    if (this.edgeCount > 0) {
      // Cords are drawn into a screen-sized cache, redrawn when the camera
      // moves or (at a limited rate) when the network changes.
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const key = `${cam.x},${cam.y},${cam.zoom},${glow},${W},${H}`;
      const every = Math.min(400, Math.max(CACHE_MS, this.edgeCount / 40));
      if (key !== this.cacheKey || (this.dirty && now - (this.cacheT || 0) > every)) {
        this.renderCache(cam, glow, dpr, W, H);
        this.cacheKey = key;
        this.cacheT = now;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (glow) ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.cache, 0, 0);
      ctx.restore();
      this.drawPulses(ctx, cam, glow);
    }
    this.drawTips(ctx, cam, glow, now, speed);
    this.drawSpore(ctx, cam.zoom, now);
  }

  renderCache(cam, glow, dpr, W, H) {
    if (this.cache.width !== W || this.cache.height !== H) {
      this.cache.width = W;
      this.cache.height = H;
    } else {
      this.cctx.setTransform(1, 0, 0, 1, 0, 0);
      this.cctx.clearRect(0, 0, W, H);
    }
    const z = cam.zoom * dpr;
    this.cctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    // Build paths for visible cords only.
    const m = 12 / cam.zoom;
    const x0 = cam.x - m, y0 = cam.y - m;
    const x1 = cam.x + cam.vw / cam.zoom + m, y1 = cam.y + cam.vh / cam.zoom + m;
    const paths = BUCKETS.map(() => new Path2D());
    const sg = this.segs, bk = this.bucket;
    for (let e = 0; e < this.edgeCount; e++) {
      const ax = sg[e * 4], ay = sg[e * 4 + 1], bx = sg[e * 4 + 2], by = sg[e * 4 + 3];
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
      const p = paths[bk[e]];
      p.moveTo(ax, ay);
      p.lineTo(bx, by);
    }
    this.paths = paths;
    this.strokeCords(this.cctx, cam.zoom, glow);
    this.dirty = false;
  }

  strokeCords(ctx, z, glow) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) ctx.globalCompositeOperation = 'lighter';
    // Soft halo first (the fuzzy look of mycelium), then the cord itself.
    for (let k = 0; k < BUCKETS.length; k++) {
      const p = this.paths[k];
      if (!p) continue;
      const b = BUCKETS[k];
      ctx.strokeStyle = glow ? 'rgba(90,255,200,0.08)' : 'rgba(240,234,218,0.07)';
      ctx.lineWidth = Math.max(b.w * 4, 3 / z);
      ctx.stroke(p);
    }
    for (let k = 0; k < BUCKETS.length; k++) {
      const p = this.paths[k];
      if (!p) continue;
      const b = BUCKETS[k];
      ctx.strokeStyle = glow ? `rgba(150,255,225,${b.a})` : `rgba(246,241,228,${b.a})`;
      ctx.lineWidth = Math.max(b.w, (0.45 + 0.15 * k) / z);
      ctx.stroke(p);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Bright specks marching along busy cords in the direction of flow,
  // drawn in a few brightness groups to keep it cheap.
  drawPulses(ctx, cam, glow) {
    const p = this.pulses;
    if (!p || !p.length) return;
    const z = cam.zoom;
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + cam.vw / z, vy1 = cam.y + cam.vh / z;
    const u = this.phase % 1;
    const base = Math.max(0.9, 1.4 / z);
    if (glow) ctx.globalCompositeOperation = 'lighter';
    for (let g = 0; g < 4; g++) {
      const lo = g / 4, hi = (g + 1) / 4, str = (lo + hi) / 2;
      ctx.fillStyle = glow
        ? `rgba(255,190,90,${0.35 + 0.6 * str})`
        : `rgba(255,252,240,${0.25 + 0.55 * str})`;
      const s = base * (0.6 + 0.8 * str), h = s / 2;
      for (let k = 0; k < p.length; k += 5) {
        const v = p[k + 4];
        if (v < lo || v >= hi + (g === 3 ? 1 : 0)) continue;
        if (p[k] < vx0 || p[k] > vx1 || p[k + 1] < vy0 || p[k + 1] > vy1) continue;
        ctx.fillRect(p[k] + (p[k + 2] - p[k]) * u - h, p[k + 1] + (p[k + 3] - p[k + 1]) * u - h, s, s);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Growing tips extend smoothly between snapshots; idle ones are dim.
  drawTips(ctx, cam, glow, now, speed) {
    const t = this.tips;
    if (!t || !t.length) return;
    const z = cam.zoom;
    const simHours = ((now - this.tipTime) / 1000) * speed;
    const r = Math.max(0.9, 1.3 / z);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.4, 0.7 / z);
    ctx.strokeStyle = glow ? 'rgba(150,255,225,0.6)' : 'rgba(246,241,228,0.55)';
    for (let i = 0; i < t.length; i += 6) {
      const x = t[i], y = t[i + 1], ang = t[i + 2];
      const ext = Math.min(SEG, t[i + 3] + t[i + 4] * simHours);
      const ex = x + Math.cos(ang) * ext, ey = y + Math.sin(ang) * ext;
      if (ext > 0.2) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.fillStyle = t[i + 5] ? 'rgba(200,190,170,0.35)' : (glow ? 'rgba(220,255,240,0.95)' : 'rgba(255,252,240,0.95)');
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The spore, pulsing gently until it germinates.
  drawSpore(ctx, z, now) {
    const s = this.spore;
    if (!s) return;
    const pulse = s.germinated ? 0 : (Math.sin(now / 400) + 1) / 2;
    ctx.fillStyle = 'rgba(255,248,230,0.95)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(1.6, 2.5 / z), 0, Math.PI * 2);
    ctx.fill();
    if (!s.germinated) {
      ctx.strokeStyle = `rgba(255,248,230,${0.25 + 0.5 * pulse})`;
      ctx.lineWidth = Math.max(0.8, 1.2 / z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(6, 9 / z) * (1 + pulse * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
