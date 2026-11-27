// Soil material table, shared by simulation and rendering.
//
// fc     field capacity: saturation (0..1) a material holds against gravity
// perm   permeability: how easily water moves through it (0..1)
// resist resistance to fungal growth (used from Phase 2)
// color  base color when dry

export const AIR = 0;
export const LITTER = 1;
export const LOAM = 2;
export const SAND = 3;
export const CLAY_LOAM = 4;
export const CLAY = 5;
export const ROCK = 6;
export const WOOD = 7;

export const SOIL = [
  { name: 'Air',       fc: 0.00, perm: 0.00, resist: 1.0, color: [43, 34, 27] },
  { name: 'Leaf litter', fc: 0.35, perm: 1.00, resist: 0.1, color: [62, 44, 29] },
  { name: 'Loam',      fc: 0.50, perm: 0.45, resist: 0.2, color: [107, 76, 52] },
  { name: 'Sand',      fc: 0.25, perm: 0.90, resist: 0.3, color: [140, 110, 76] },
  { name: 'Clay loam', fc: 0.62, perm: 0.18, resist: 0.5, color: [91, 65, 45] },
  { name: 'Clay',      fc: 0.75, perm: 0.06, resist: 0.8, color: [74, 53, 36] },
  { name: 'Rock',      fc: 0.00, perm: 0.00, resist: 1.0, color: [128, 122, 112] },
  { name: 'Wood',      fc: 0.70, perm: 0.15, resist: 0.4, color: [122, 85, 48] },
];

export const FC = Float32Array.from(SOIL, (s) => s.fc);
export const PERM = Float32Array.from(SOIL, (s) => s.perm);

// Materials that hold water (everything except air and rock).
export const holdsWater = (t) => t !== AIR && t !== ROCK;
