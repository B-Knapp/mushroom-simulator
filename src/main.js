// Entry point: wires the simulation worker, camera, renderer and UI.

import { randomSeed } from './rng.js';
import { Camera, attachCameraInput } from './camera.js';
import { Renderer } from './renderer.js';
import { bakeWorld } from './render/soil.js';

const canvas = document.getElementById('view');
const clockEl = document.getElementById('clock');
const seedEl = document.getElementById('seed');
const debugEl = document.getElementById('debug');
const legendEl = document.getElementById('legend');
const resBtn = document.getElementById('resView');
const hintEl = document.getElementById('hint');
const speedButtons = [...document.querySelectorAll('#speeds button')];

const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });

let state = null;
let speed = 1;
let seed = readSeed();

// ---- Seed handling (?seed=123 in the URL) ----

function readSeed() {
  const v = parseInt(new URLSearchParams(location.search).get('seed'), 10);
  return Number.isFinite(v) && v >= 0 ? v : randomSeed();
}

function writeSeed(s) {
  const url = new URL(location.href);
  url.searchParams.set('seed', s);
  history.replaceState(null, '', url);
}

function startWorld(s, type) {
  seed = s;
  writeSeed(s);
  seedEl.textContent = s;
  state = null;
  renderer.clearWorld();
  showHint('Click the soil to plant a spore');
  worker.postMessage({ type, seed: s });
}

// ---- Speed ----

function setSpeed(v) {
  speed = v;
  worker.postMessage({ type: 'speed', value: v });
  for (const b of speedButtons) b.classList.toggle('active', Number(b.dataset.speed) === v);
}

let lastNonZero = 1;
function togglePause() {
  if (speed === 0) setSpeed(lastNonZero);
  else { lastNonZero = speed; setSpeed(0); }
}

// ---- Views ----

function setResourceView(on) {
  renderer.resourceView = on;
  resBtn.classList.toggle('active', on);
  legendEl.classList.toggle('hidden', !on);
}

// ---- Planting ----

let hintTimer = 0;
function showHint(text, warn = false) {
  hintEl.textContent = text;
  hintEl.classList.toggle('warn', warn);
  hintEl.classList.remove('hidden');
  clearTimeout(hintTimer);
}

function onTap(sx, sy) {
  if (!state || state.net.spore !== 'none') return;
  const [x, y] = camera.screenToWorld(sx, sy);
  worker.postMessage({ type: 'plant', x, y });
}

// ---- UI ----

for (const b of speedButtons) {
  b.addEventListener('click', () => {
    const v = Number(b.dataset.speed);
    if (v > 0) lastNonZero = v;
    setSpeed(v);
  });
}
document.getElementById('fit').addEventListener('click', () => camera.fit());
document.getElementById('newWorld').addEventListener('click', () => startWorld(randomSeed(), 'reset'));
document.getElementById('rain').addEventListener('click', () => worker.postMessage({ type: 'rain', hours: 8 }));
resBtn.addEventListener('click', () => setResourceView(!renderer.resourceView));

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.key === '1') { lastNonZero = 1; setSpeed(1); }
  else if (e.key === '2') { lastNonZero = 10; setSpeed(10); }
  else if (e.key === '3') { lastNonZero = 100; setSpeed(100); }
  else if (e.key === 'f' || e.key === 'F') camera.fit();
  else if (e.key === 'r' || e.key === 'R') setResourceView(!renderer.resourceView);
  else if (e.key === '`') debugEl.classList.toggle('hidden');
});

function formatClock(s) {
  const day = Math.floor(s.minute / 1440) + 1;
  const m = Math.floor(s.minute % 1440);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  const f = Math.round(s.airTemp * 9 / 5 + 32);
  return `Day ${day} · ${hh}:${mm}<span class="wx">${f}°F${s.raining ? ' · Rain' : ''}</span>`;
}

// ---- Worker messages ----

worker.onmessage = (e) => {
  const d = e.data;
  if (d.seed !== seed) return; // stale message from a previous world
  if (d.type === 'state') state = d;
  else if (d.type === 'world') renderer.setWorld(d, bakeWorld(d));
  else if (d.type === 'grids') renderer.updateGrids(d.moisture, d.nutrient);
  else if (d.type === 'network') renderer.setNetwork(d, state ? state.minute : 0);
  else if (d.type === 'planted') {
    if (d.ok) {
      showHint('Spore planted. It will germinate once the soil is damp.');
      hintTimer = setTimeout(() => hintEl.classList.add('hidden'), 4000);
    } else {
      showHint("Spores can't grow in rock or air. Try the soil.", true);
    }
  }
};
worker.onerror = (e) => console.error('Simulation worker error:', e.message);

// ---- Frame loop ----

let frames = 0;
let fps = 0;
let fpsT = performance.now();
let uiT = 0;

function frame(now) {
  renderer.draw(state, now);

  frames++;
  if (now - fpsT >= 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
  }

  if (now - uiT > 100) {
    uiT = now;
    if (state) clockEl.innerHTML = formatClock(state);
    debugEl.textContent = [
      `fps        ${fps.toFixed(0)}`,
      `speed      ${speed}×  (actual ${state ? state.actualRate.toFixed(1) : '0.0'}×)`,
      `tick       ${state ? state.tickMs.toFixed(3) : '-'} ms`,
      `ticks      ${state ? state.ticks : 0}`,
      `spore      ${state ? state.net.spore : '-'}`,
      `edges      ${state ? state.net.edges : 0}  (fusions ${state ? state.net.fusions : 0})`,
      `tips       ${state ? state.net.tips : 0}  (dormant ${state ? state.net.dormant : 0})`,
      `biomass    ${state ? state.net.pool.toFixed(1) : 0}`,
      `zoom       ${camera.zoom.toFixed(2)}`,
    ].join('\n');
  }

  requestAnimationFrame(frame);
}

// ---- Boot ----

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
camera.fit();
attachCameraInput(canvas, camera, onTap);
startWorld(seed, 'init');
setSpeed(1);
requestAnimationFrame(frame);

// Expose for debugging in the console.
window.mush = { camera, renderer, get state() { return state; }, setSpeed, worker };
