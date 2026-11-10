// Game rules: players, scoring, round flow. Advances in fixed ticks from
// per-player inputs, so it can later be driven by networked inputs unchanged.

import { CFG } from './config.js';

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
    soaks: 0, bestPot: 0,
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
    for (let i = 0; i < nPlayers; i++) this.players.push(makePlayer(i, nPlayers));
  }

  start(seed) {
    this.sim.reset(seed);
    this.players = [];
    for (let i = 0; i < this.n; i++) this.players.push(makePlayer(i, this.n));
    this.footprints.length = 0;
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
