// 2D camera: maps world units to screen pixels. Handles fit-to-screen,
// drag to pan, wheel and pinch to zoom around a point.

import { WORLD_W, WORLD_H } from './config.js';

const MAX_ZOOM = 8;
const MARGIN = 40; // screen px of slack allowed past the world edge

export class Camera {
  constructor() {
    this.x = 0;      // world coordinate at the screen's left edge
    this.y = 0;      // world coordinate at the screen's top edge
    this.zoom = 1;
    this.vw = 1;     // viewport size in CSS px
    this.vh = 1;
  }

  setViewport(w, h) {
    const wasFit = this.isFit();
    this.vw = w;
    this.vh = h;
    if (wasFit) this.fit();
    else this.clamp();
  }

  fitZoom() {
    return Math.min(this.vw / WORLD_W, this.vh / WORLD_H);
  }

  minZoom() {
    return this.fitZoom();
  }

  isFit() {
    return Math.abs(this.zoom - this.fitZoom()) < 1e-6;
  }

  fit() {
    this.anim = null;
    this.zoom = this.fitZoom();
    this.x = (WORLD_W - this.vw / this.zoom) / 2;
    this.y = (WORLD_H - this.vh / this.zoom) / 2;
  }

  screenToWorld(sx, sy) {
    return [this.x + sx / this.zoom, this.y + sy / this.zoom];
  }

  // Glide to center (wx, wy) at the given zoom. Any user pan or zoom cancels it.
  flyTo(wx, wy, zoom, ms = 1400) {
    this.anim = { x0: this.x, y0: this.y, z0: this.zoom, wx, wy, z1: Math.min(MAX_ZOOM, zoom), t0: performance.now(), ms };
  }

  update(now) {
    const a = this.anim;
    if (!a) return;
    const u = Math.min(1, (now - a.t0) / a.ms);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    // Zoom geometrically so the move feels even.
    const z = a.z0 * Math.pow(a.z1 / a.z0, e);
    const cx0 = a.x0 + this.vw / a.z0 / 2, cy0 = a.y0 + this.vh / a.z0 / 2;
    const cx = cx0 + (a.wx - cx0) * e, cy = cy0 + (a.wy - cy0) * e;
    this.zoom = z;
    this.x = cx - this.vw / z / 2;
    this.y = cy - this.vh / z / 2;
    this.clamp();
    if (u >= 1) this.anim = null;
  }

  panBy(dxScreen, dyScreen) {
    this.anim = null;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  zoomAt(sx, sy, factor) {
    this.anim = null;
    const [wx, wy] = this.screenToWorld(sx, sy);
    const z = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.zoom * factor));
    this.zoom = z;
    this.x = wx - sx / z;
    this.y = wy - sy / z;
    this.clamp();
  }

  // Keep the world on screen. If the world is smaller than the viewport
  // along an axis, center it; otherwise allow a small margin past the edge.
  clamp() {
    const viewW = this.vw / this.zoom;
    const viewH = this.vh / this.zoom;
    const m = MARGIN / this.zoom;
    if (viewW >= WORLD_W) this.x = (WORLD_W - viewW) / 2;
    else this.x = Math.max(-m, Math.min(WORLD_W - viewW + m, this.x));
    if (viewH >= WORLD_H) this.y = (WORLD_H - viewH) / 2;
    else this.y = Math.max(-m, Math.min(WORLD_H - viewH + m, this.y));
  }
}

// Wire mouse, trackpad and touch input on an element to a camera.
// onTap(sx, sy) is called for a click or tap that didn't drag.
export function attachCameraInput(el, cam, onTap) {
  const pointers = new Map();
  let pinchDist = 0;
  let tap = null; // { x, y, moved } for a possible tap

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null;
    if (pointers.size === 2) pinchDist = distance();
    el.classList.add('dragging');
  });

  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 5) tap.moved = true;
    if (pointers.size === 1) {
      cam.panBy(e.clientX - p.x, e.clientY - p.y);
    } else if (pointers.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const d = distance();
      const [cx, cy] = center();
      if (pinchDist > 0) cam.zoomAt(cx, cy, d / pinchDist);
      pinchDist = d;
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
  });

  const end = (e) => {
    if (e.type === 'pointerup' && tap && !tap.moved && pointers.size === 1 && onTap) onTap(e.clientX, e.clientY);
    if (pointers.size <= 1) tap = null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;      // lines
    else if (e.deltaMode === 2) dy *= 400; // pages
    // Trackpad pinch arrives as ctrl+wheel with small deltas; scale it up.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    cam.zoomAt(e.clientX, e.clientY, Math.exp(-dy * k));
  }, { passive: false });

  function distance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function center() {
    const [a, b] = [...pointers.values()];
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }
}
