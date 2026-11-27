// Draws the fungal network.
//
// Look: soft, cottony threads (a blurred haze around cream cords, made by
// drawing at low resolution and scaling up), feathery fans at the growing
// tips, and a "foxfire" glow: busy supply routes glow green in proportion
// to the flow they carry, motes of light drift along them toward the
// growing tips, and fronts have a soft halo. The glow is strongest at
// night. The simulation underneath stays realistic; the glow is
// embellishment.
//
// Cords are cached in a screen-sized image (redrawn when the camera moves
// or, at a limited rate, when the network changes). Tips, fans and glow are
// drawn live every frame.
//
// Smooth growth: every cord carries the sim time it started and finished
// growing. The view runs its own display clock a moment behind the
// simulation and replays growth against it, so cords extend continuously
// instead of appearing a segment at a time. Cords finished since the last
// cache are drawn live until the next one.

const SEG = 6;
const TIP_STRIDE = 8; // x, y, angle, progress, rate, idle, id, segment start
const BUCKETS = [
  { maxD: 0.75, w: 0.32, a: 0.42 },
  { maxD: 0.95, w: 0.44, a: 0.5 },
  { maxD: 1.2, w: 0.6, a: 0.58 },
  { maxD: 1.5, w: 0.8, a: 0.66 },
  { maxD: 1.9, w: 1.0, a: 0.74 },
  { maxD: 2.4, w: 1.3, a: 0.8 },
  { maxD: 3.0, w: 1.6, a: 0.86 },
  { maxD: 3.5, w: 1.95, a: 0.9 },
  { maxD: Infinity, w: 2.3, a: 0.93 },
];
const CACHE_MS = 66;
const FLOW_GROUPS = 4;     // glow brightness levels
const MOTES = 700;         // light motes on the busiest cords
const GLOW_RES = 0.25;     // glow layer resolution (lower = softer)

export class NetworkView {
  constructor() {
    this.cache = document.createElement('canvas');
    this.cctx = this.cache.getContext('2d');
    this.haze1 = document.createElement('canvas');
    this.haze2 = document.createElement('canvas');
    this.glow = document.createElement('canvas');
    this.routeGlow = document.createElement('canvas');
    this.sprite = makeSprite();
    this.phase = 0;
    this.lastNow = 0;
    this.glowSetting = 0.6;
    this.clear();
  }

  clear() {
    this.segs = null;
    this.edgeCount = 0;
    this.tips = null;
    this.spore = null;
    this.flowPaths = null;
    this.motes = null;
    this.cacheKey = '';
    this.cacheCam = null;
    this.cacheSimT = -Infinity;
    this.simT = undefined;
    this.fronts = null;
    this.stemLen = null;
    this.dirty = true;
    // Nothing from the previous world may linger in the glow.
    this.routeGlow.width = 0;
    this.glow.getContext('2d').clearRect(0, 0, this.glow.width, this.glow.height);
  }

  set(snap, now) {
    const { nodeX: x, nodeY: y, edgeA: a, edgeB: b, edgeD: D, edgeQ: Q } = snap;
    const n = a.length;
    const segs = new Float32Array(n * 4);
    const bucket = new Uint8Array(n);
    let qTop = 0;
    for (let e = 0; e < n; e++) {
      segs[e * 4] = x[a[e]]; segs[e * 4 + 1] = y[a[e]];
      segs[e * 4 + 2] = x[b[e]]; segs[e * 4 + 3] = y[b[e]];
      let k = 0;
      while (D[e] > BUCKETS[k].maxD) k++;
      bucket[e] = k;
      const q = Math.abs(Q[e]);
      if (q > qTop) qTop = q;
    }

    // Glow paths grouped by how much flow each cord carries, and motes on
    // the busiest cords, oriented with the flow.
    const flowPaths = [];
    for (let g = 0; g < FLOW_GROUPS; g++) flowPaths.push(new Path2D());
    const busy = [];
    if (qTop > 0) {
      for (let e = 0; e < n; e++) {
        const f = Math.sqrt(Math.abs(Q[e]) / qTop);
        if (f < 0.08) continue;
        const g = Math.min(FLOW_GROUPS - 1, Math.floor(f * FLOW_GROUPS));
        flowPaths[g].moveTo(segs[e * 4], segs[e * 4 + 1]);
        flowPaths[g].lineTo(segs[e * 4 + 2], segs[e * 4 + 3]);
        busy.push(e);
      }
    }
    busy.sort((i, j) => Math.abs(Q[j]) - Math.abs(Q[i]));
    const m = Math.min(MOTES, busy.length);
    const motes = new Float32Array(m * 6);
    for (let k = 0; k < m; k++) {
      const e = busy[k];
      const fwd = Q[e] > 0; // positive flow runs from a to b
      const i0 = fwd ? 0 : 2, i1 = fwd ? 2 : 0;
      motes[k * 6] = segs[e * 4 + i0]; motes[k * 6 + 1] = segs[e * 4 + i0 + 1];
      motes[k * 6 + 2] = segs[e * 4 + i1]; motes[k * 6 + 3] = segs[e * 4 + i1 + 1];
      motes[k * 6 + 4] = Math.sqrt(Math.abs(Q[e]) / qTop);
      motes[k * 6 + 5] = hash01(e * 7919 + (segs[e * 4] | 0));
    }

    this.segs = segs;
    this.bucket = bucket;
    this.edgeCount = n;
    this.flowPaths = qTop > 0 ? flowPaths : null;
    this.motes = motes;
    this.t0 = snap.edgeT0;
    this.t1 = snap.edgeT1;
    this.owner = snap.edgeOwner;
    this.snapMinute = snap.minute;
    this.tips = snap.tips;
    this.spore = snap.spore;
    this.dirty = true;
  }

  // night: 0 (midday) .. 1 (night). resourceView: the analytic glow view.
  draw(ctx, cam, resourceView, now, dpr, speed, night, state) {
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    this.phase += dt * (speed > 0 ? 0.35 * Math.pow(speed, 0.3) : 0.05);
    this.tickClock(state, now, dt, speed);

    if (this.edgeCount > 0) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const camKey = `${cam.x},${cam.y},${cam.zoom}`;
      if (camKey !== this.lastCamKey) { this.lastCamKey = camKey; this.camMovedT = now; }
      const moving = now - (this.camMovedT || 0) < 140;
      const key = `${camKey},${resourceView},${W},${H}`;
      // Big networks are re-cached less often; tips and glow stay live.
      const every = Math.min(1200, Math.max(CACHE_MS, this.edgeCount / 15));
      const stale = key !== this.cacheKey;
      const needs = !this.cacheCam || this.cacheView !== resourceView || this.cache.width !== W || this.cache.height !== H ||
        (stale && !moving) || (!stale && this.dirty && now - (this.cacheT || 0) > every) ||
        (!moving && this.liveCount > 2500 && now - (this.cacheT || 0) > CACHE_MS * 3);
      if (needs) {
        this.renderCache(cam, resourceView, dpr, W, H);
        this.cacheKey = key;
        this.cacheCam = { x: cam.x, y: cam.y, zoom: cam.zoom };
        this.cacheView = resourceView;
        this.cacheT = now;
      }
      // Draw the cache, shifted and scaled if the camera has moved since it
      // was made (while panning or zooming, before it's redrawn).
      const cc = this.cacheCam;
      const k = cam.zoom / cc.zoom;
      const ox = (cc.x - cam.x) * cam.zoom * dpr, oy = (cc.y - cam.y) * cam.zoom * dpr;
      ctx.save();
      ctx.setTransform(k, 0, 0, k, ox, oy);
      if (resourceView) ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.cache, 0, 0);
      this.cacheShift = { k, ox, oy };
      ctx.restore();
    }

    this.drawLive(ctx, cam, resourceView);
    this.placeTips();
    if (!resourceView) this.drawFans(ctx, cam);
    else this.drawTipLines(ctx, cam);

    // Slider 0..1 maps to 0..1.5; by day the glow is about half its night strength.
    const G = resourceView ? 0 : this.glowSetting * 1.5 * (0.5 + 0.5 * night);
    if (G > 0.01 && (this.edgeCount > 0 || this.tips)) this.drawGlow(ctx, cam, dpr, now, speed, G);
    this.drawSpore(ctx, cam.zoom, now);
  }

  // --- Display clock ----------------------------------------------------------------

  // Follows the simulation clock smoothly, a little behind it (so the
  // geometry it shows has always arrived), never running backwards.
  tickClock(state, now, dt, speed) {
    if (!state) return;
    const rate = speed > 0 ? (state.actualRate > 0 ? state.actualRate : speed) : 0;
    const r = rate * 60; // sim minutes per real second
    const recv = state.recvT || now;
    const est = state.minute + Math.min(0.4, (now - recv) / 1000) * r;
    const target = speed > 0 ? est - 0.15 * r : state.minute;
    if (this.simT === undefined || Math.abs(target - this.simT) > Math.max(240, 2 * r)) {
      this.simT = target;
      return;
    }
    const next = this.simT + r * dt + (target - this.simT) * Math.min(1, 1.5 * dt);
    this.simT = Math.max(this.simT, next);
  }

  // Cords not yet in the cache: grown since, or still growing (drawn part
  // way along). Also records where each tip's growing cord has reached.
  drawLive(ctx, cam, glowView) {
    this.fronts = new Map();
    this.liveCount = 0;
    if (!this.edgeCount || this.simT === undefined) return;
    const T = this.simT, C = this.cacheSimT;
    const t0 = this.t0, t1 = this.t1, sg = this.segs, bk = this.bucket, own = this.owner;
    const z = cam.zoom;
    const x0 = cam.x - 16, y0 = cam.y - 16, x1 = cam.x + cam.vw / z + 16, y1 = cam.y + cam.vh / z + 16;
    let paths = null;
    for (let e = 0; e < this.edgeCount; e++) {
      if (t1[e] <= C || t0[e] >= T) continue;
      this.liveCount++;
      const ax = sg[e * 4], ay = sg[e * 4 + 1];
      let bx = sg[e * 4 + 2], by = sg[e * 4 + 3];
      if (t1[e] > T) {
        const u = t1[e] > t0[e] ? (T - t0[e]) / (t1[e] - t0[e]) : 1;
        bx = ax + (bx - ax) * u; by = ay + (by - ay) * u;
        if (own[e] > 0) this.fronts.set(own[e], [bx, by, Math.atan2(sg[e * 4 + 3] - ay, sg[e * 4 + 2] - ax)]);
      }
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
      if (!paths) paths = BUCKETS.map(() => null);
      const p = paths[bk[e]] || (paths[bk[e]] = new Path2D());
      p.moveTo(ax, ay);
      p.lineTo(bx, by);
    }
    if (!paths) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < BUCKETS.length; k++) {
      if (!paths[k]) continue;
      const b = BUCKETS[k];
      if (glowView) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(150,255,225,${b.a})`;
        ctx.lineWidth = Math.max(b.w, (0.4 + 0.08 * k) / z);
        ctx.stroke(paths[k]);
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      // A light stand-in for the haze, then the cord.
      ctx.strokeStyle = 'rgba(245,240,230,0.08)';
      ctx.lineWidth = b.w * 3.2 + 2.5;
      ctx.stroke(paths[k]);
      ctx.strokeStyle = `rgba(248,244,236,${b.a})`;
      ctx.lineWidth = Math.max(b.w * 0.85, (0.4 + 0.07 * k) / z);
      ctx.stroke(paths[k]);
    }
  }

  // Where each tip is at the display time: stem start and end, heading,
  // and whether to draw it. Stride 7: sx, sy, ex, ey, ang, show (0 none,
  // 1 stem + fan, 2 fan only), idle.
  placeTips() {
    const t = this.tips;
    if (!t || !t.length || this.simT === undefined) { this.placed = null; return; }
    const n = t.length / TIP_STRIDE;
    const out = this.placed && this.placed.length === n * 7 ? this.placed : new Float32Array(n * 7);
    const T = this.simT, M = this.snapMinute;
    // Last drawn length per tip, so a stem never shrinks within a segment
    // when a tip slows down between snapshots.
    const prev = this.stemLen || new Map(), cur = new Map();
    for (let k = 0, i = 0; i < t.length; i += TIP_STRIDE, k += 7) {
      const x = t[i], y = t[i + 1], ang = t[i + 2], acc = t[i + 3], rate = t[i + 4], s = t[i + 7];
      out[k + 6] = t[i + 5];
      if (T < s) {
        // This tip's newest segment hasn't started yet on screen: its front is
        // still on a cord that's being drawn.
        const f = this.fronts.get(t[i + 6]);
        if (f) { out[k] = out[k + 2] = f[0]; out[k + 1] = out[k + 3] = f[1]; out[k + 4] = f[2]; out[k + 5] = 2; }
        else out[k + 5] = 0;
        continue;
      }
      let ext = T <= M ? (M > s ? acc * (T - s) / (M - s) : 0) : acc + rate * (T - M) / 60;
      ext = Math.max(0, Math.min(SEG, ext));
      const pv = prev.get(t[i + 6]);
      if (pv && pv[0] === s && pv[1] > ext) ext = pv[1];
      cur.set(t[i + 6], [s, ext]);
      out[k] = x; out[k + 1] = y;
      out[k + 2] = x + Math.cos(ang) * ext; out[k + 3] = y + Math.sin(ang) * ext;
      out[k + 4] = ang; out[k + 5] = 1;
    }
    this.placed = out;
    this.stemLen = cur;
  }

  // --- Cached cords ---------------------------------------------------------------

  renderCache(cam, glowView, dpr, W, H) {
    if (this.cache.width !== W || this.cache.height !== H) {
      this.cache.width = W;
      this.cache.height = H;
    }
    const c = this.cctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    const z = cam.zoom * dpr;

    // Visible cords, by width bucket.
    const m = 16 / cam.zoom;
    const x0 = cam.x - m, y0 = cam.y - m;
    const x1 = cam.x + cam.vw / cam.zoom + m, y1 = cam.y + cam.vh / cam.zoom + m;
    const paths = BUCKETS.map(() => new Path2D());
    const sg = this.segs, bk = this.bucket;
    // Only cords finished by the display time; newer ones are drawn live.
    const T = this.simT === undefined ? Infinity : this.simT;
    this.cacheSimT = T;
    const t1 = this.t1;
    for (let e = 0; e < this.edgeCount; e++) {
      if (t1 && t1[e] > T) continue;
      const ax = sg[e * 4], ay = sg[e * 4 + 1], bx = sg[e * 4 + 2], by = sg[e * 4 + 3];
      if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
      const p = paths[bk[e]];
      p.moveTo(ax, ay);
      p.lineTo(bx, by);
    }

    if (glowView) {
      c.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
      c.lineCap = 'round';
      c.globalCompositeOperation = 'lighter';
      for (let k = 0; k < BUCKETS.length; k++) {
        const b = BUCKETS[k];
        c.strokeStyle = 'rgba(90,255,200,0.07)';
        c.lineWidth = Math.max(b.w * 4, 3 / cam.zoom);
        c.stroke(paths[k]);
        c.strokeStyle = `rgba(150,255,225,${b.a})`;
        c.lineWidth = Math.max(b.w, (0.4 + 0.08 * k) / cam.zoom);
        c.stroke(paths[k]);
      }
      c.globalCompositeOperation = 'source-over';
      this.dirty = false;
      return;
    }

    // Cotton: two soft hazes drawn small and scaled up (that's the blur),
    // then the cream cords on top.
    this.haze(this.haze1, 0.25, paths, cam, dpr, 3.2, 2.5, 0.13, W, H);
    this.haze(this.haze2, 0.125, paths, cam, dpr, 7, 5, 0.07, W, H);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.haze2, 0, 0, W, H);
    c.drawImage(this.haze1, 0, 0, W, H);

    this.renderRouteGlow(cam, dpr, W, H, paths);

    c.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let k = 0; k < BUCKETS.length; k++) {
      const b = BUCKETS[k];
      c.strokeStyle = `rgba(248,244,236,${b.a})`;
      c.lineWidth = Math.max(b.w * 0.85, (0.4 + 0.07 * k) / cam.zoom);
      c.stroke(paths[k]);
    }
    this.dirty = false;
  }

  // Routes glow green by how much they carry. Baked at low resolution
  // (soft) whenever the cords are re-cached; scaled by the glow strength
  // when drawn.
  renderRouteGlow(cam, dpr, W, H, paths) {
    const cv = this.routeGlow;
    const w = Math.max(1, Math.ceil(W * GLOW_RES)), h = Math.max(1, Math.ceil(H * GLOW_RES));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    const z = cam.zoom * dpr * GLOW_RES;
    c.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const px = 1 / z;
    c.globalCompositeOperation = 'lighter';
    // A faint base glow on every cord, stronger on thicker ones.
    for (let k = 0; k < BUCKETS.length; k++) {
      c.strokeStyle = `rgba(60,255,140,${0.05 + 0.025 * k})`;
      c.lineWidth = Math.max(2 * px, BUCKETS[k].w * 2 + 2);
      c.stroke(paths[k]);
    }
    if (!this.flowPaths) return;
    for (let g = 0; g < FLOW_GROUPS; g++) {
      const f = (g + 1) / FLOW_GROUPS;
      c.strokeStyle = `rgba(40,255,120,${0.22 * f})`;
      c.lineWidth = Math.max(3 * px, 3 + 6 * f);
      c.stroke(this.flowPaths[g]);
      c.strokeStyle = `rgba(90,255,150,${0.4 * f})`;
      c.lineWidth = Math.max(1.5 * px, 1.2 + 2 * f);
      c.stroke(this.flowPaths[g]);
    }
  }

  haze(canvas, res, paths, cam, dpr, widthMul, widthAdd, alpha, W, H) {
    const w = Math.max(1, Math.ceil(W * res)), h = Math.max(1, Math.ceil(H * res));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = canvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    const z = cam.zoom * dpr * res;
    c.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = `rgba(245,240,230,${alpha})`;
    for (let k = 0; k < BUCKETS.length; k++) {
      // Keep the haze at least a couple of screen pixels wide at any zoom.
      c.lineWidth = Math.max(BUCKETS[k].w * widthMul + widthAdd, 3 / (cam.zoom * dpr * res) * res * 2);
      c.stroke(paths[k]);
    }
  }

  // --- Growing tips -------------------------------------------------------------------

  // Each growing tip: the cord extends smoothly and ends in a feathery fan
  // of fine hyphae.
  drawFans(ctx, cam) {
    const t = this.tips, P = this.placed;
    if (!t || !P) return;
    const z = cam.zoom;
    const vx0 = cam.x - 20, vy0 = cam.y - 20, vx1 = cam.x + cam.vw / z + 20, vy1 = cam.y + cam.vh / z + 20;
    const stem = new Path2D();
    const fans = [new Path2D(), new Path2D()];
    for (let k = 0, i = 0; k < P.length; k += 7, i += TIP_STRIDE) {
      const show = P[k + 5];
      if (!show) continue;
      const ex = P[k + 2], ey = P[k + 3], ang = P[k + 4];
      if (ex < vx0 || ex > vx1 || ey < vy0 || ey > vy1) continue;
      if (show === 1) { stem.moveTo(P[k], P[k + 1]); stem.lineTo(ex, ey); }
      if (P[k + 6]) continue; // long-idle tips keep their stem but lose the fan
      // Fan shape follows the tip, so it doesn't reshuffle as the tip grows.
      let h = Math.imul(t[i + 6] + 1, 0x9e3779b1) >>> 0;
      for (let f = 0; f < 11; f++) {
        h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
        const spread = ((h & 1023) / 1023 - 0.5) * 1.7;
        const len = 4 + ((h >>> 10) & 63) / 63 * 7;
        const bend = (((h >>> 16) & 255) / 255 - 0.5) * 0.6;
        const a1 = ang + spread, a2 = a1 + bend;
        const p = fans[f & 1];
        p.moveTo(ex, ey);
        p.quadraticCurveTo(ex + Math.cos(a1) * len * 0.55, ey + Math.sin(a1) * len * 0.55,
          ex + Math.cos(a2) * len, ey + Math.sin(a2) * len);
      }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(248,244,236,0.6)';
    ctx.lineWidth = Math.max(0.35, 0.6 / z);
    ctx.stroke(stem);
    ctx.lineWidth = Math.max(0.2, 0.4 / z);
    ctx.strokeStyle = 'rgba(248,244,236,0.32)';
    ctx.stroke(fans[0]);
    ctx.strokeStyle = 'rgba(248,244,236,0.18)';
    ctx.stroke(fans[1]);
  }

  // Resource view: tips simply extend as thin lines.
  drawTipLines(ctx, cam) {
    const P = this.placed;
    if (!P) return;
    const p = new Path2D();
    for (let k = 0; k < P.length; k += 7) {
      if (P[k + 5] !== 1) continue;
      p.moveTo(P[k], P[k + 1]);
      p.lineTo(P[k + 2], P[k + 3]);
    }
    ctx.strokeStyle = 'rgba(150,255,225,0.6)';
    ctx.lineWidth = Math.max(0.35, 0.6 / cam.zoom);
    ctx.stroke(p);
  }

  // --- Foxfire glow -----------------------------------------------------------------

  drawGlow(ctx, cam, dpr, now, speed, G) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const breathe = 0.8 + 0.2 * Math.sin(now / 1400);

    // One small, soft layer: the baked route glow, then motes and halos,
    // scaled up onto the screen in a single pass.
    const w = Math.max(1, Math.ceil(W * GLOW_RES)), h = Math.max(1, Math.ceil(H * GLOW_RES));
    if (this.glow.width !== w || this.glow.height !== h) { this.glow.width = w; this.glow.height = h; }
    const c = this.glow.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    if (this.routeGlow.width) {
      const sh = this.cacheShift || { k: 1, ox: 0, oy: 0 };
      c.globalAlpha = Math.min(1, G * breathe * 1.4);
      c.setTransform(sh.k, 0, 0, sh.k, sh.ox * GLOW_RES, sh.oy * GLOW_RES);
      c.drawImage(this.routeGlow, 0, 0);
      c.globalAlpha = 1;
    }
    const z = cam.zoom * dpr * GLOW_RES;
    c.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    c.lineCap = 'round';
    const px = 1 / z;
    const vx0 = cam.x - 10, vy0 = cam.y - 10, vx1 = cam.x + cam.vw / cam.zoom + 10, vy1 = cam.y + cam.vh / cam.zoom + 10;

    // Motes of light drifting along busy routes, toward the growing tips.
    const mo = this.motes;
    if (mo && mo.length) {
      const path = new Path2D();
      for (let k = 0; k < mo.length; k += 6) {
        if (mo[k] < vx0 || mo[k] > vx1 || mo[k + 1] < vy0 || mo[k + 1] > vy1) continue;
        const u = (this.phase * (0.6 + mo[k + 4]) + mo[k + 5]) % 1;
        const u0 = Math.max(0, u - 0.5);
        const dx = mo[k + 2] - mo[k], dy = mo[k + 3] - mo[k + 1];
        path.moveTo(mo[k] + dx * u0, mo[k + 1] + dy * u0);
        path.lineTo(mo[k] + dx * u, mo[k + 1] + dy * u);
      }
      c.strokeStyle = `rgba(170,255,200,${Math.min(1, 0.6 * G)})`;
      c.lineWidth = Math.max(1.5 * px, 2);
      c.stroke(path);
    }

    // Soft halo around each growing front.
    const P = this.placed;
    if (P) {
      const R = Math.max(7, 3 * px);
      for (let k = 0; k < P.length; k += 7) {
        if (!P[k + 5] || P[k + 6]) continue;
        const x = P[k + 2], y = P[k + 3];
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        c.globalAlpha = Math.min(1, G * (0.65 + 0.35 * Math.sin(now / 700 + x * 0.05)));
        c.drawImage(this.sprite, x - R, y - R, R * 2, R * 2);
      }
      c.globalAlpha = 1;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.glow, 0, 0, W, H);
    ctx.restore();
  }

  // The spore, pulsing gently until it germinates.
  drawSpore(ctx, z, now) {
    const s = this.spore;
    if (!s || s.germinated) return;
    const pulse = (Math.sin(now / 400) + 1) / 2;
    ctx.fillStyle = 'rgba(255,248,230,0.95)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(1.6, 2.5 / z), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,248,230,${0.25 + 0.5 * pulse})`;
    ctx.lineWidth = Math.max(0.8, 1.2 / z);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(6, 9 / z) * (1 + pulse * 0.4), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function hash01(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A soft green dot, drawn once and reused for every tip halo.
function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(120,255,170,0.45)');
  g.addColorStop(0.5, 'rgba(90,255,150,0.15)');
  g.addColorStop(1, 'rgba(90,255,150,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return c;
}
