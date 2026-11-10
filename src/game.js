// Game rules: players, scoring, round flow. Advances in fixed ticks from
// per-player inputs, so it can later be driven by networked inputs unchanged.

import { CFG } from './config.js';
import { mulberry32 } from './rng.js';

export const PLAYER_STYLES = [
  { name: 'P1', color: '#ff5a4d', dark: '#b8322a', keys: 'WASD' },
  { name: 'P2', color: '#7a5cff', dark: '#4a34b8', keys: 'Arrows' },
];

// eight points around the unit circle, used to test the player's rim against the water
const RIM = [1, 0, 0.7071, 0.7071, 0, 1, -0.7071, 0.7071, -1, 0, -0.7071, -0.7071, 0, -1, 0.7071, -0.7071];

function makePlayer(i, n) {
  const W = CFG.world.W;
  return {
    id: i,
    x: W * (i + 1) / (n + 1), y: 31.5,
    vx: 0, vy: 0,
    face: -Math.PI / 2,
    walk: 0, // distance walked, drives the step animation
    score: 0, // banked
    pot: 0, // earned this stand, lost if the water gets you
    hold: 0, // seconds stood still
    still: 0,
    soaked: 0, // seconds left unable to score
    inWater: false,
    depthMult: 0, holdMult: 1,
    soaks: 0, bestPot: 0, dollars: 0,
    stepAcc: 0, foot: 1,
  };
}

export class Game {
  constructor(sim, nPlayers = 2) {
    this.sim = sim;
    this.n = nPlayers;
    this.phase = 'title'; // title | countdown | play | results
    this.timer = 0;
    this.players = [];
    this.events = []; // drained by the presentation layer each frame
    this.footprints = [];
    this.dollars = []; // sand dollars lying on the beach
    this.dollarTimes = []; // round-clock times (s elapsed) at which the next ones wash up
    this.rng = mulberry32(1);
    for (let i = 0; i < nPlayers; i++) this.players.push(makePlayer(i, nPlayers));
  }

  start(seed) {
    this.sim.reset(seed);
    this.players = [];
    for (let i = 0; i < this.n; i++) this.players.push(makePlayer(i, this.n));
    this.footprints.length = 0;
    this.dollars.length = 0;
    this.rng = mulberry32((seed ^ 0x2545f491) >>> 0);
    const d = CFG.dollars, r = this.rng;
    const n = d.min + Math.floor(r() * (d.max - d.min + 1));
    const span = CFG.game.roundTime - d.firstAt - d.lastAt;
    this.dollarTimes = [];
    for (let i = 0; i < n; i++) this.dollarTimes.push(d.firstAt + (i + r()) * span / n);
    this.phase = 'countdown';
    this.timer = CFG.game.countdown;
    this.events.push({ type: 'countdown', n: Math.ceil(this.timer) });
  }

  depthMultAt(x, y) {
    const g = CFG.game;
    let d = (g.zSafe - this.sim.bedAt(x, y)) / g.zSafe;
    if (d <= 0) return 0;
    if (d > g.depthCap) d = g.depthCap;
    return g.depthMax * d * Math.sqrt(d);
  }

  tick(inputs) {
    const g = CFG.game, dt = g.tick;
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.timer);
      this.timer -= dt;
      const after = Math.ceil(this.timer);
      if (this.timer <= 0) {
        this.phase = 'play';
        this.timer = g.roundTime;
        this.events.push({ type: 'go' });
      } else if (after !== before) this.events.push({ type: 'countdown', n: after });
    } else if (this.phase === 'play') {
      const before = Math.ceil(this.timer);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        for (const p of this.players) this.bank(p);
        this.phase = 'results';
        this.events.push({ type: 'end' });
      } else if (Math.ceil(this.timer) !== before && this.timer < 10) {
        this.events.push({ type: 'tickdown', n: Math.ceil(this.timer) });
      }
    }
    if (this.phase === 'play') this.updateDollars(dt);
    const scoring = this.phase === 'play';
    const canMove = this.phase !== 'results';
    for (let i = 0; i < this.players.length; i++) {
      this.movePlayer(this.players[i], canMove ? inputs[i] : null, dt, scoring);
    }
    // waves wash footprints away
    const fp = this.footprints;
    for (let i = fp.length - 1; i >= 0; i--) {
      const f = fp[i];
      f.age += dt;
      if (f.age > 45 || this.sim.depthAt(f.x, f.y) > 0.006) { fp[i] = fp[fp.length - 1]; fp.pop(); }
    }
  }

  // A sand dollar appears under the water of a wave that has run up the
  // beach, in the band the swash regularly uncovers, so it can be fetched once
  // the wave drains back.
  trySpawnDollar() {
    const d = CFG.dollars, sim = this.sim, W = CFG.world.W, H = CFG.world.H, r = this.rng;
    const x = 2 + r() * (W - 4), pick = r();
    let lo = -1, hi = -1; // extent of the usable, currently submerged stretch of this column
    for (let y = H - 1; y > 2; y -= 0.25) {
      const z = sim.bedAt(x, y);
      if (z > d.zMax) continue;
      if (z < d.zMin) break;
      if (sim.depthAt(x, y) > d.minDepth) { if (hi < 0) hi = y; lo = y; }
      else if (hi >= 0) break;
    }
    if (hi < 0 || hi - lo < 0.5) return false;
    const y = lo + pick * (hi - lo - 0.25);
    for (const o of this.dollars) if (Math.hypot(o.x - x, o.y - y) < 4) return false;
    this.dollars.push({ x, y, age: 0, exposed: false, spin: r() * 6.283 });
    this.events.push({ type: 'dollar', x, y });
    return true;
  }

  updateDollars(dt) {
    const g = CFG.game, d = CFG.dollars, elapsed = g.roundTime - this.timer;
    if (this.dollarTimes.length && elapsed >= this.dollarTimes[0] && this.trySpawnDollar()) this.dollarTimes.shift();
    const reach = g.playerRadius + d.radius;
    for (let i = this.dollars.length - 1; i >= 0; i--) {
      const o = this.dollars[i];
      o.age += dt;
      o.exposed = this.sim.depthAt(o.x, o.y) <= g.touchDepth;
      if (!o.exposed) continue; // only up for grabs once the water has left it
      let who = null, best = reach;
      for (const p of this.players) {
        const dist = Math.hypot(p.x - o.x, p.y - o.y);
        if (dist < best) { best = dist; who = p; }
      }
      if (who) {
        who.score += d.bonus;
        who.dollars++;
        this.events.push({ type: 'collect', player: who.id, amount: d.bonus, x: o.x, y: o.y });
        this.dollars.splice(i, 1);
      }
    }
  }

  bank(p) {
    if (p.pot >= 1) {
      const amount = Math.floor(p.pot);
      p.score += amount;
      if (amount > p.bestPot) p.bestPot = amount;
      this.events.push({ type: 'bank', player: p.id, amount, x: p.x, y: p.y });
    }
    p.pot = 0;
    p.hold = 0;
    p.still = 0;
  }

  movePlayer(p, input, dt, scoring) {
    const g = CFG.game, W = CFG.world.W, H = CFG.world.H;
    let ix = input ? input.x : 0, iy = input ? input.y : 0;
    const il = Math.hypot(ix, iy);
    if (il > 1) { ix /= il; iy /= il; }
    const moving = il > 0.01;

    // Wet as soon as the waterline reaches the rim of the player, not the centre.
    const depth = this.sim.depthAt(p.x, p.y);
    let rimDepth = depth;
    const rr = g.playerRadius * g.touchRim;
    for (let i = 0; i < 8; i++) {
      const d = this.sim.depthAt(p.x + RIM[i * 2] * rr, p.y + RIM[i * 2 + 1] * rr);
      if (d > rimDepth) rimDepth = d;
    }
    const touched = rimDepth > g.touchDepth;
    const wade = depth > 0.03 ? g.waterSlow + (1 - g.waterSlow) * Math.max(0, 1 - depth / 0.25) : 1;
    const sp = g.speed * wade;
    const k = Math.min(1, g.accel * dt);
    p.vx += (ix * sp - p.vx) * k;
    p.vy += (iy * sp - p.vy) * k;
    const speed = Math.hypot(p.vx, p.vy);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const r = g.playerRadius;
    if (p.x < r) { p.x = r; p.vx = 0; } else if (p.x > W - r) { p.x = W - r; p.vx = 0; }
    if (p.y < r) { p.y = r; p.vy = 0; } else if (p.y > H - r) { p.y = H - r; p.vy = 0; }
    if (moving) p.face = Math.atan2(iy, ix);
    p.walk += speed * dt;

    // footprints on sand
    p.stepAcc += speed * dt;
    if (p.stepAcc > 0.62 && !touched) {
      p.stepAcc = 0;
      p.foot = -p.foot;
      const nx = -Math.sin(p.face), ny = Math.cos(p.face);
      this.footprints.push({ x: p.x + nx * 0.2 * p.foot, y: p.y + ny * 0.2 * p.foot, a: p.face, age: 0 });
      if (this.footprints.length > 600) this.footprints.shift();
    }

    // water
    if (touched) {
      if (!p.inWater) {
        const wasDry = p.soaked <= 0;
        const lost = Math.floor(p.pot);
        if (scoring && (wasDry || lost > 0)) {
          p.soaks++;
          this.events.push({ type: 'soak', player: p.id, lost, x: p.x, y: p.y });
        } else {
          this.events.push({ type: 'splash', player: p.id, x: p.x, y: p.y });
        }
        p.pot = 0; p.hold = 0; p.still = 0;
      }
      p.inWater = true;
      p.soaked = g.soakTime;
    } else {
      p.inWater = false;
      if (p.soaked > 0) p.soaked -= dt;
    }

    p.depthMult = this.depthMultAt(p.x, p.y);
    p.holdMult = 1 + g.holdGain * Math.min(p.hold, g.holdMax);
    if (!scoring) { p.pot = 0; p.hold = 0; return; }

    if (moving) {
      if (p.pot > 0 || p.hold > 0) this.bank(p);
    } else if (!touched && p.soaked <= 0 && speed < 0.6) {
      p.still += dt;
      if (p.still > g.holdGrace) {
        p.hold += dt;
        p.pot += g.baseRate * p.depthMult * p.holdMult * dt;
      }
    }
  }

  winner() {
    let best = -1, who = -1, tie = false;
    for (const p of this.players) {
      if (p.score > best) { best = p.score; who = p.id; tie = false; }
      else if (p.score === best) tie = true;
    }
    return tie ? -1 : who;
  }
}
