// Seeded pseudo-random numbers. Same seed => same world.

// mulberry32: small, fast, good enough for procedural generation.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
  next.chance = (p) => next() < p;
  return next;
}

// Derive an independent stream from a seed plus a label, so different
// systems (soil, network, weather) don't disturb each other's sequences.
export function subSeed(seed, label) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1_000_000);
}
