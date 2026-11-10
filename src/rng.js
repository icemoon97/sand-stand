// Deterministic helpers. The simulation only uses + - * / sqrt and these
// functions, so the same seed gives the same waves in every browser.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// sin(2*pi*turns), polynomial approximation (max error ~0.1%).
export function dsin(turns) {
  const x = turns - Math.floor(turns + 0.5);
  const y = 16 * x * (0.5 - Math.abs(x));
  return 0.225 * (y * Math.abs(y) - y) + y;
}

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smooth(x) {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
}

function hash2(x, y, s) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Value noise in [0,1], periodic in x with integer period px.
export function vnoise(x, y, px, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px;
  const a = hash2(x0, iy, seed), b = hash2(x1, iy, seed);
  const c = hash2(x0, iy + 1, seed), d = hash2(x1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
