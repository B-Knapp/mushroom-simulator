// Placeholder soil backdrop, baked once per seed into an offscreen canvas.
// Phase 1 replaces this with a procedural world generated in the worker
// (layers, rocks, moisture, food), drawn from the environment grid.

import { WORLD_W, WORLD_H, SURFACE_Y } from '../config.js';
import { makeRng, subSeed } from '../rng.js';

// Smooth 1D value noise for wavy layer boundaries.
function wave(rng, spacing, amp) {
  const pts = [];
  for (let i = 0; i <= Math.ceil(WORLD_W / spacing) + 1; i++) pts.push(rng.range(-amp, amp));
  return (x) => {
    const f = x / spacing;
    const i = Math.floor(f);
    const t = (1 - Math.cos((f - i) * Math.PI)) / 2;
    return pts[i] * (1 - t) + pts[i + 1] * t;
  };
}

export function bakeSoil(seed) {
  const rng = makeRng(subSeed(seed, 'soil-backdrop'));
  const c = document.createElement('canvas');
  c.width = WORLD_W;
  c.height = WORLD_H;
  const ctx = c.getContext('2d');

  // Air above the litter.
  ctx.fillStyle = '#2b2219';
  ctx.fillRect(0, 0, WORLD_W, SURFACE_Y);

  // Soil layers: topsoil, subsoil, deep subsoil.
  const layers = [
    { top: () => SURFACE_Y, color: '#6b4c34' },
    { top: ((w) => (x) => 380 + w(x))(wave(rng, 160, 40)), color: '#5b412d' },
    { top: ((w) => (x) => 640 + w(x))(wave(rng, 220, 30)), color: '#4a3524' },
  ];
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, WORLD_H);
    for (let x = 0; x <= WORLD_W; x += 8) ctx.lineTo(x, layer.top(x));
    ctx.lineTo(WORLD_W, WORLD_H);
    ctx.closePath();
    ctx.fill();
  }

  // Grain: dark and light specks.
  const n = Math.floor((WORLD_W * (WORLD_H - SURFACE_Y)) / 45);
  for (let i = 0; i < n; i++) {
    const x = rng() * WORLD_W;
    const y = SURFACE_Y + rng() * (WORLD_H - SURFACE_Y);
    const s = 0.4 + rng() * 1.6;
    ctx.fillStyle = rng() < 0.55 ? 'rgba(35,22,12,0.45)' : 'rgba(170,135,95,0.28)';
    ctx.fillRect(x, y, s, s);
  }

  // A few pebbles.
  for (let i = 0; i < 70; i++) {
    const x = rng() * WORLD_W;
    const y = SURFACE_Y + 30 + rng() * (WORLD_H - SURFACE_Y - 40);
    const rx = 3 + rng() * 9;
    ctx.fillStyle = `hsl(35, ${8 + rng() * 10}%, ${38 + rng() * 18}%)`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * (0.55 + rng() * 0.35), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Leaf litter band along the soil line.
  ctx.fillStyle = '#3e2c1d';
  ctx.fillRect(0, SURFACE_Y - 18, WORLD_W, 18);
  for (let i = 0; i < 1400; i++) {
    const x = rng() * WORLD_W;
    const y = SURFACE_Y - 18 + rng() * 20;
    const r = 3 + rng() * 6;
    ctx.fillStyle = rng() < 0.5 ? '#8a5a26' : rng() < 0.5 ? '#a6742f' : '#6e4a22';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.45, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}
