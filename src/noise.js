// Smooth 1D value noise: returns f(x) in [-amp, amp], varying over `spacing`.
export function wave1d(rng, length, spacing, amp) {
  const pts = [];
  for (let i = 0; i <= Math.ceil(length / spacing) + 1; i++) pts.push(rng.range(-amp, amp));
  return (x) => {
    const f = Math.max(0, x) / spacing;
    const i = Math.floor(f);
    const t = (1 - Math.cos((f - i) * Math.PI)) / 2;
    return pts[i] * (1 - t) + pts[i + 1] * t;
  };
}

// Even-odd point-in-polygon test. poly is a flat [x0,y0,x1,y1,...] array.
export function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Rotated rectangle as a flat polygon.
export function rectPoly(cx, cy, len, thick, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const hx = len / 2, hy = thick / 2;
  const pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  return pts.flatMap(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

// Lumpy closed blob as a flat polygon.
export function blobPoly(rng, cx, cy, r, aspect, angle, n = 14) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * rng.range(0.78, 1.12);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * aspect;
    out.push(cx + x * c - y * s, cy + x * s + y * c);
  }
  return out;
}
