// 2D shallow-water simulation of a beach: swell comes in from the top edge,
// steepens into bores, runs up the sand and drains back.
//
// Staggered grid (depth h at cell centres, u on x-faces, v on y-faces),
// upwind depths at faces so cells never go negative, momentum advection so
// bores form, and face-based wetting/drying (after Stelling & Duinmeijer 2003,
// and the game-oriented variant in Chentanez & Mueller 2010).
//
// Deterministic: no DOM, no Math.sin/pow, fixed time step. Same seed => same
// waves, which is what lets several players share one sea later.

import { CFG } from './config.js';
import { mulberry32, dsin, smooth, clamp01, vnoise } from './rng.js';

class WaveTrain {
  constructor(seed, NX) {
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.NX = NX;
    this.active = [];
    this.nextT = CFG.waves.firstAt;
    this.setLen = 0;
    this.setPos = 0;
    this.setPeak = 1;
    this.count = 0;
  }

  spawn() {
    const r = this.rng, c = CFG.waves, NX = this.NX;
    if (this.setPos >= this.setLen) {
      this.setLen = 3 + Math.floor(r() * 4);
      this.setPos = 0;
      this.setPeak = 0.8 + 0.5 * r();
    }
    const p = this.setLen > 1 ? this.setPos / (this.setLen - 1) : 0.5;
    const env = 0.4 + 0.6 * (4 * p * (1 - p)); // sets build then fade
    let amp = c.baseAmp * this.setPeak * env * (0.75 + 0.5 * r());
    if (r() < c.sneakerChance) amp *= c.sneakerBoost;
    const T = c.periodMin + (c.periodMax - c.periodMin) * r();
    // Alongshore shape: where the wave is tall and where it arrives first.
    const m = 0.1 + 0.35 * r(), k = r() < 0.5 ? 1 : 2, ph = r();
    const D = c.maxDelay * r(), dph = r();
    const D2 = 0.3 * D * r(), dph2 = r();
    const A = new Float32Array(NX), del = new Float32Array(NX);
    for (let i = 0; i < NX; i++) {
      const xi = (i + 0.5) / NX;
      A[i] = amp * (1 + m * dsin(k * xi + ph));
      del[i] = D * (0.5 + 0.5 * dsin(xi + dph)) + D2 * (0.5 + 0.5 * dsin(2 * xi + dph2));
    }
    const t0 = this.nextT;
    this.active.push({ t0, T, A, del, end: t0 + T + D + D2, amp, id: this.count++ });
    this.setPos++;
    this.nextT += c.gapMin + (c.gapMax - c.gapMin) * r() + (this.setPos >= this.setLen ? c.lull : 0);
  }

  // Incoming surface elevation along the offshore boundary at time t.
  fill(t, out) {
    while (this.nextT <= t) this.spawn();
    out.fill(0);
    const NX = this.NX, rise = 0.32;
    for (let w = this.active.length - 1; w >= 0; w--) {
      const wv = this.active[w];
      if (t > wv.end) { this.active.splice(w, 1); continue; }
      const invT = 1 / wv.T, A = wv.A, del = wv.del;
      for (let i = 0; i < NX; i++) {
        const s = (t - wv.t0 - del[i]) * invT;
        if (s <= 0 || s >= 1) continue;
        // steeper front than back, like real swell near shore
        const b = s < rise ? smooth(s / rise) : 1 - smooth((s - rise) / (1 - rise));
        out[i] += A[i] * b;
      }
    }
  }
}

export class Sim {
  constructor() {
    const c = CFG.sim;
    this.NX = c.NX;
    this.PAD = c.PAD;
    this.NY = c.NYV + c.PAD;
    this.dx = CFG.world.W / c.NX;
    const n = this.NX * this.NY;
    this.z = new Float32Array(n); // bed height, 0 = still-water level
    this.h = new Float32Array(n); // water depth
    this.u = new Float32Array(n); // x-velocity on the face between (i-1,j) and (i,j)
    this.v = new Float32Array(n); // y-velocity on the face between (i,j-1) and (i,j)
    this.u2 = new Float32Array(n);
    this.v2 = new Float32Array(n);
    this.fx = new Float32Array(n);
    this.fy = new Float32Array(n);
    this.foam = new Float32Array(n);
    this.foam2 = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.surfExt = new Float32Array(n); // water surface, extended one cell into dry sand
    this.etaIn = new Float32Array(this.NX);
    this.tex = new Float32Array(n * 4); // bed, foam, wetness, extended surface
    this.surf = 0; // how much breaking is happening (drives audio)
    this.reset(1);
  }

  reset(seed) {
    this.seed = seed >>> 0;
    this.t = 0;
    this.steps = 0;
    this.waves = new WaveTrain(this.seed, this.NX);
    this.buildBed();
    const n = this.NX * this.NY;
    for (let k = 0; k < n; k++) {
      this.h[k] = this.z[k] < 0 ? -this.z[k] : 0;
      this.wet[k] = this.z[k] < 0.02 ? 1 : 0;
    }
    this.u.fill(0); this.v.fill(0); this.u2.fill(0); this.v2.fill(0);
    this.foam.fill(0); this.foam2.fill(0);
    this.surf = 0;
  }

  buildBed() {
    const b = CFG.beach, W = CFG.world.W, { NX, NY, PAD, dx, z } = this;
    const r = mulberry32((this.seed ^ 0x51ed270b) >>> 0);
    const p1 = r(), p2 = r(), ns = (r() * 65536) | 0;
    const cell = 4, px = Math.round(W / cell);
    for (let j = 0; j < NY; j++) {
      const Y = (j - PAD + 0.5) * dx;
      const taper = smooth((Y + 2) / 10) * (1 - smooth((Y - 27) / 8));
      const relief = b.bump * smooth((Y - 4) / 8);
      for (let i = 0; i < NX; i++) {
        const X = (i + 0.5) * dx;
        const off = (b.cusp1 * dsin((X / W) * 2 + p1) + b.cusp2 * dsin((X / W) * 5 + p2)) * taper;
        const t = Y - off - b.shoreY;
        let zz = t < 0 ? -Math.min(b.depth, -t * b.seaSlope) : b.slope1 * t + b.slope2 * t * t;
        zz += relief * (2 * vnoise(X / cell, Y / cell, px, ns) - 1);
        z[i + j * NX] = zz;
      }
    }
    // The generating boundary assumes a flat, submerged first row.
    for (let i = 0; i < NX; i++) z[i] = -b.depth;
  }

  step() {
    const c = CFG.sim, { NX, NY, z, h, u, v, u2, v2, fx, fy, etaIn } = this;
    const dt = c.dt, idx = 1 / this.dx, dtdx = dt * idx, gdt = c.g * dt * idx;
    const cf = c.friction * dt, EPS = c.eps;
    const UMAX = 0.24 * this.dx / dt; // keeps every cell's outflow below its contents
    const depth0 = CFG.beach.depth, cb = Math.sqrt(c.g / depth0);

    // Offshore boundary: send the swell in, let reflections leave.
    this.waves.fill(this.t, etaIn);
    for (let i = 0; i < NX; i++) {
      let vb = cb * (2 * etaIn[i] - (z[i] + h[i]));
      if (vb > UMAX) vb = UMAX; else if (vb < -UMAX) vb = -UMAX;
      v[i] = vb;
      v2[i] = vb;
      fy[i] = vb * (vb > 0 ? depth0 + etaIn[i] : h[i]);
    }

    // Momentum.
    for (let j = 0; j < NY; j++) {
      const row = j * NX, last = j === NY - 1;
      for (let i = 0; i < NX; i++) {
        const k = row + i;
        const kl = i === 0 ? k + NX - 1 : k - 1;
        const kr = i === NX - 1 ? k - NX + 1 : k + 1;
        const zC = z[k], hC = h[k], eC = zC + hC;

        // u on the face between kl and k
        {
          const zL = z[kl], hL = h[kl], eL = zL + hL;
          const hf = (eL > eC ? eL : eC) - (zL > zC ? zL : zC);
          if (hf <= EPS) { u2[k] = 0; fx[k] = 0; }
          else {
            const uc = u[k];
            const vb = last ? 0.25 * (v[kl] + v[k]) : 0.25 * (v[kl] + v[k] + v[kl + NX] + v[k + NX]);
            // Advect with cell-centred speeds so momentum can carry into a
            // face that is still at rest (the advancing edge of the swash).
            const uL = u[kl], uR = u[kr];
            const aL = 0.5 * (uL + uc), aR = 0.5 * (uc + uR);
            const adv = (aL > 0 ? aL * (uc - uL) : 0) + (aR < 0 ? aR * (uR - uc) : 0);
            const dudy = vb > 0 ? (j > 0 ? uc - u[k - NX] : 0) : (last ? 0 : u[k + NX] - uc);
            let un = uc - dtdx * (adv + vb * dudy) - gdt * (eC - eL);
            un /= 1 + cf * Math.sqrt(un * un + vb * vb) / hf;
            if (un > UMAX) un = UMAX; else if (un < -UMAX) un = -UMAX;
            u2[k] = un;
            fx[k] = un * (un > 0 ? hL : hC);
          }
        }

        // v on the face between k-NX and k (row 0 is the boundary, set above)
        if (j > 0) {
          const kt = k - NX;
          const zT = z[kt], hT = h[kt], eT = zT + hT;
          const hf = (eT > eC ? eT : eC) - (zT > zC ? zT : zC);
          if (hf <= EPS) { v2[k] = 0; fy[k] = 0; }
          else {
            const vc = v[k];
            const ub = 0.25 * (u[kt] + u[kr - NX] + u[k] + u[kr]);
            const vT = v[kt], vB = last ? 0 : v[k + NX];
            const aT = 0.5 * (vT + vc), aB = 0.5 * (vc + vB);
            const adv = (aT > 0 ? aT * (vc - vT) : 0) + (aB < 0 ? aB * (vB - vc) : 0);
            const dvdx = ub > 0 ? vc - v[kl] : v[kr] - vc;
            let vn = vc - dtdx * (ub * dvdx + adv) - gdt * (eC - eT);
            vn /= 1 + cf * Math.sqrt(vn * vn + ub * ub) / hf;
            if (vn > UMAX) vn = UMAX; else if (vn < -UMAX) vn = -UMAX;
            v2[k] = vn;
            fy[k] = vn * (vn > 0 ? hT : hC);
          }
        }
      }
    }

    // Continuity, plus the sand soaking up thin films.
    const soak = c.infiltration * dt;
    for (let j = 0; j < NY; j++) {
      const row = j * NX, last = j === NY - 1;
      for (let i = 0; i < NX; i++) {
        const k = row + i;
        const kr = i === NX - 1 ? k - NX + 1 : k + 1;
        let hn = h[k] - dtdx * (fx[kr] - fx[k] + (last ? 0 : fy[k + NX]) - fy[k]);
        if (z[k] > 0.03) hn -= soak;
        h[k] = hn > 0 ? hn : 0;
      }
    }

    this.u = u2; this.u2 = u;
    this.v = v2; this.v2 = v;
    this.t += dt;
    this.steps++;
  }

  // Foam and wet sand. Purely visual, so it runs once per game tick.
  cosmetics(dt) {
    const c = CFG.sim, { NX, NY, h, u, v, foam, foam2, wet, z, tex, surfExt } = this;
    const WETH = 0.003;
    const idx = 1 / this.dx, dtdx = dt * idx;
    const kWet = dt / c.foamTauWet, kDry = dt / c.foamTauDry, kSand = dt / c.wetTau;
    let surf = 0;
    for (let j = 0; j < NY; j++) {
      const row = j * NX, last = j === NY - 1;
      for (let i = 0; i < NX; i++) {
        const k = row + i;
        const kl = i === 0 ? k + NX - 1 : k - 1;
        const kr = i === NX - 1 ? k - NX + 1 : k + 1;
        const hk = h[k];
        let f = foam[k];
        if (hk > 0.008) {
          const vB = last ? 0 : v[k + NX];
          const comp = -(u[kr] - u[k] + vB - v[k]) * idx - c.foamThresh;
          if (comp > 0) {
            const src = dt * c.foamGain * comp * (hk > 0.06 ? 1 : hk * 16);
            f += src;
            if (j >= this.PAD) surf += src;
          }
          const uc = 0.5 * (u[k] + u[kr]), vc = 0.5 * (v[k] + vB);
          const dfx = uc > 0 ? f - foam[kl] : foam[kr] - f;
          const dfy = vc > 0 ? (j > 0 ? f - foam[k - NX] : 0) : (last ? 0 : foam[k + NX] - f);
          f -= dtdx * (uc * dfx + vc * dfy) + f * kWet;
        } else {
          f -= f * kDry;
        }
        if (hk > 0.003) wet[k] = 1;
        else { const w = wet[k] - kSand; wet[k] = w > 0 ? w : 0; }
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        foam2[k] = f;
        // Surface height, pushed one cell into dry sand so that
        // (surface - bed) crosses zero at a sub-cell shoreline instead of
        // snapping to cell edges.
        const zk = z[k];
        let e = zk + hk;
        if (hk <= WETH) {
          let sum = 0, cnt = 0;
          if (h[kl] > WETH) { sum += z[kl] + h[kl]; cnt++; }
          if (h[kr] > WETH) { sum += z[kr] + h[kr]; cnt++; }
          if (j > 0 && h[k - NX] > WETH) { sum += z[k - NX] + h[k - NX]; cnt++; }
          if (!last && h[k + NX] > WETH) { sum += z[k + NX] + h[k + NX]; cnt++; }
          e = cnt > 0 ? sum / cnt : zk - 0.03;
          if (e > zk + 0.01) e = zk + 0.01;
        }
        surfExt[k] = e;
        const o = k * 4;
        tex[o] = zk; tex[o + 1] = f; tex[o + 2] = wet[k]; tex[o + 3] = e;
      }
    }
    this.foam = foam2; this.foam2 = foam;
    this.surf += (surf * 0.02 - this.surf) * 0.15;
  }

  // Bilinear sample of a cell-centred field at view coordinates (metres).
  sample(field, x, y) {
    const { NX, NY } = this;
    const gx = x / this.dx - 0.5, gy = y / this.dx + this.PAD - 0.5;
    const ix = Math.floor(gx), fx = gx - ix;
    let iy = Math.floor(gy), fy = gy - iy;
    if (iy < 0) { iy = 0; fy = 0; } else if (iy >= NY - 1) { iy = NY - 2; fy = 1; }
    const x0 = ((ix % NX) + NX) % NX, x1 = (x0 + 1) % NX;
    const r0 = iy * NX, r1 = r0 + NX;
    return (field[r0 + x0] * (1 - fx) + field[r0 + x1] * fx) * (1 - fy)
         + (field[r1 + x0] * (1 - fx) + field[r1 + x1] * fx) * fy;
  }

  // Depth as drawn: matches the rendered waterline (needs cosmetics() to have run).
  depthAt(x, y) { return this.sample(this.surfExt, x, y) - this.sample(this.z, x, y); }
  bedAt(x, y) { return this.sample(this.z, x, y); }
}

export { clamp01 };
