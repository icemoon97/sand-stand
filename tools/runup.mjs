// Headless balance harness: runs the sea for a while and reports how far up
// the beach each wave reaches, plus the cost of a simulation step.
//   node tools/runup.mjs [seed] [seconds]
import { Sim } from '../src/sim.js';
import { CFG } from '../src/config.js';

const seed = Number(process.argv[2] ?? 1);
const seconds = Number(process.argv[3] ?? 120);
const sim = new Sim();
sim.reset(seed);
const { NX, NY, PAD, dx } = sim;
const touch = CFG.game.touchDepth;

// Furthest-landward wet row in each column, as view-y metres.
function edge() {
  let sum = 0, min = 1e9, max = -1e9;
  for (let i = 0; i < NX; i += 4) {
    let j = NY - 1;
    while (j > 0 && sim.h[i + j * NX] < touch) j--;
    const y = (j - PAD + 0.5) * dx;
    sum += y; if (y < min) min = y; if (y > max) max = y;
  }
  return { mean: sum / (NX / 4), min, max };
}

const stepsPerSec = Math.round(1 / CFG.sim.dt);
let cost = 0, peak = null, lastMean = 0, rising = false;
const peaks = [];
console.log(`seed ${seed}, grid ${NX}x${NY}, dx ${dx} m, still shoreline y=${CFG.beach.shoreY}`);
for (let s = 0; s < seconds * 10; s++) {
  const t0 = performance.now();
  for (let k = 0; k < stepsPerSec / 10; k++) sim.step();
  sim.cosmetics(0.1);
  cost += performance.now() - t0;
  const e = edge();
  if (e.mean > lastMean + 0.01) { rising = true; peak = e; }
  else if (rising && e.mean < peak.mean - 0.5) {
    peaks.push({ t: sim.t, ...peak });
    rising = false;
  }
  lastMean = e.mean;
  let bad = false;
  for (let k = 0; k < sim.h.length; k += 97) if (!Number.isFinite(sim.h[k]) || sim.h[k] > 10) bad = true;
  if (bad) { console.log('UNSTABLE at t=', sim.t); process.exit(1); }
}
for (const p of peaks)
  console.log(`t=${p.t.toFixed(1).padStart(6)}  run-up mean y=${p.mean.toFixed(1).padStart(5)}  (${p.min.toFixed(1)} .. ${p.max.toFixed(1)})`);
const means = peaks.map((p) => p.mean).sort((a, b) => a - b);
const q = (f) => means[Math.min(means.length - 1, Math.floor(f * means.length))]?.toFixed(1);
console.log(`${peaks.length} waves; run-up y p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}`);
let vol = 0; for (let k = 0; k < sim.h.length; k++) vol += sim.h[k] + Math.min(0, sim.z[k]);
console.log(`mean surface offset ${(vol / sim.h.length).toFixed(3)} m`);
console.log(`step cost ${(cost / (seconds * stepsPerSec)).toFixed(3)} ms (incl. foam pass), budget at 120 Hz is 8.3 ms`);
