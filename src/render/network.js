// Draws the fungal network. Cords are grouped into a few width buckets
// (Phase 2: thicker with age; Phase 3: thicker with flow) and built into
// Path2D objects whenever a new snapshot arrives.
//
// Normal view: pale, soft, cottony threads. Resource view: glowing teal.
//
// When zoomed out, the network is drawn into a cached image a limited
// number of times per second; when zoomed in, it's stroked directly so it
// stays sharp.

import { WORLD_W, WORLD_H } from '../config.js';

const DAY = 1440;
const BUCKETS = [
  { maxAge: 4, w: 0.35, a: 0.55 },
  { maxAge: 15, w: 0.55, a: 0.68 },
  { maxAge: Infinity, w: 0.85, a: 0.78 },
];
const CACHE_MS = 66;

export class NetworkView {
  constructor() {
    this.cache = document.createElement('canvas');
    this.cctx = this.cache.getContext('2d');
    this.clear();
  }

  clear() {
    this.paths = BUCKETS.map(() => null);
    this.tips = null;
    this.spore = null;
    this.edgeCount = 0;
    this.dirty = true;
  }

  set(snap, minute) {
    const paths = BUCKETS.map(() => new Path2D());
    const { nodeX: x, nodeY: y, edgeA: a, edgeB: b, edgeBorn: born } = snap;
    for (let e = 0; e < a.length; e++) {
      const age = (minute - born[e]) / DAY;
      let k = 0;
      while (age > BUCKETS[k].maxAge) k++;
      const p = paths[k];
      p.moveTo(x[a[e]], y[a[e]]);
      p.lineTo(x[b[e]], y[b[e]]);
    }
    this.paths = paths;
    this.tips = snap.tips;
    this.spore = snap.spore;
    this.edgeCount = a.length;
    this.dirty = true;
  }

  draw(ctx, cam, glow, now, dpr) {
    const scale = cam.zoom * dpr;
    if (this.edgeCount > 0) {
      if (scale <= 1.05) {
        // Cached: render at screen resolution for the whole world.
        const s = Math.max(0.2, Math.round(scale * 20) / 20);
        if (this.cacheScale !== s || this.cacheGlow !== glow ||
            (this.dirty && now - (this.cacheT || 0) > CACHE_MS)) {
          this.renderCache(s, glow, cam.zoom);
          this.cacheT = now;
        }
        if (glow) ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.cache, 0, 0, WORLD_W, WORLD_H);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        this.strokeCords(ctx, cam.zoom, glow);
      }
    }
    this.drawTips(ctx, cam.zoom, glow);
    this.drawSpore(ctx, cam.zoom, now);
  }

  renderCache(s, glow, zoom) {
    const w = Math.ceil(WORLD_W * s), h = Math.ceil(WORLD_H * s);
    if (this.cache.width !== w || this.cache.height !== h) {
      this.cache.width = w;
      this.cache.height = h;
    } else {
      this.cctx.clearRect(0, 0, w, h);
    }
    this.cctx.setTransform(s, 0, 0, s, 0, 0);
    this.strokeCords(this.cctx, zoom, glow);
    this.cacheScale = s;
    this.cacheGlow = glow;
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
      ctx.strokeStyle = glow ? 'rgba(90,255,200,0.09)' : 'rgba(240,234,218,0.07)';
      ctx.lineWidth = Math.max(b.w * 6, 3 / z);
      ctx.stroke(p);
    }
    for (let k = 0; k < BUCKETS.length; k++) {
      const p = this.paths[k];
      if (!p) continue;
      const b = BUCKETS[k];
      ctx.strokeStyle = glow ? `rgba(150,255,225,${b.a})` : `rgba(246,241,228,${b.a})`;
      ctx.lineWidth = Math.max(b.w, 0.7 / z);
      ctx.stroke(p);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Growing tips: small bright points; dormant ones dimmer.
  drawTips(ctx, z, glow) {
    const t = this.tips;
    if (!t || !t.length) return;
    const r = Math.max(0.9, 1.3 / z);
    for (let i = 0; i < t.length; i += 3) {
      ctx.fillStyle = t[i + 2] ? 'rgba(200,190,170,0.35)' : (glow ? 'rgba(220,255,240,0.95)' : 'rgba(255,252,240,0.95)');
      ctx.beginPath();
      ctx.arc(t[i], t[i + 1], r, 0, Math.PI * 2);
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
