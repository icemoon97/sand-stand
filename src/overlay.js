// 2D canvas layer over the water: footprints, players, score pops, splashes.

import { CFG } from './config.js';
import { PLAYER_STYLES } from './game.js';

const FONT = '"Arial Rounded MT Bold", ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pops = [];
    this.drops = [];
    this.potPulse = [0, 0, 0, 0];
  }

  pop(x, y, text, color, big = false) {
    this.pops.push({ x, y, text, color, age: 0, life: big ? 1.6 : 1.1, big });
  }

  splash(x, y, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      this.drops.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: 0.35 + Math.random() * 0.35 });
    }
  }

  draw(game, dt, time) {
    const ctx = this.ctx, cw = this.canvas.width, s = cw / CFG.world.W;
    ctx.clearRect(0, 0, cw, this.canvas.height);

    // footprints
    for (const f of game.footprints) {
      const a = Math.min(1, (45 - f.age) / 10) * 0.2;
      ctx.save();
      ctx.translate(f.x * s, f.y * s);
      ctx.rotate(f.a);
      ctx.fillStyle = `rgba(92,62,30,${a})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.2 * s, 0.1 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const o of game.dollars) this.drawDollar(o, s, time);

    for (const p of game.players) this.drawPlayer(p, game, s, time);

    // droplets
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age > d.life) { this.drops.splice(i, 1); continue; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= 0.94; d.vy *= 0.94;
      const k = 1 - d.age / d.life;
      ctx.fillStyle = `rgba(255,255,255,${0.9 * k})`;
      ctx.beginPath();
      ctx.arc(d.x * s, d.y * s, (0.06 + 0.1 * k) * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // score pops
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const q = this.pops[i];
      q.age += dt;
      if (q.age > q.life) { this.pops.splice(i, 1); continue; }
      const k = q.age / q.life;
      const scale = (q.big ? 1.25 : 1) * (1 + 0.5 * Math.max(0, 1 - q.age * 8));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      this.label(q.text, q.x * s, (q.y - 2.9 - 2.2 * (1 - (1 - k) * (1 - k))) * s, 0.95 * s * scale, q.color);
      ctx.globalAlpha = 1;
    }
  }

  twinkle(x, y, size, alpha) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(255,255,240,${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? size * 0.16 : size;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawDollar(o, s, time) {
    const ctx = this.ctx, r = CFG.dollars.radius * s;
    const x = o.x * s, y = o.y * s;
    const appear = Math.min(1, o.age / 0.35);
    const grow = appear * (1 + 0.35 * Math.sin(Math.min(1, o.age / 0.5) * Math.PI));
    ctx.save();
    ctx.translate(x, y);
    // ring of light when it first appears
    if (o.age < 0.9) {
      const k = o.age / 0.9;
      ctx.strokeStyle = `rgba(255,255,235,${0.9 * (1 - k)})`;
      ctx.lineWidth = 0.1 * s;
      ctx.beginPath(); ctx.arc(0, 0, r * (1 + 4 * k), 0, Math.PI * 2); ctx.stroke();
    }
    // soft glow so it reads through water and foam
    const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.6);
    const pulse = 0.5 + 0.2 * Math.sin(time * 4 + o.spin);
    glow.addColorStop(0, `rgba(255,252,225,${pulse * appear})`);
    glow.addColorStop(1, 'rgba(255,252,225,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2); ctx.fill();
    // on dry sand: a pulsing halo says "come and get it"
    if (o.exposed) {
      const ph = (time * 0.9) % 1;
      ctx.strokeStyle = `rgba(255,236,150,${0.75 * (1 - ph)})`;
      ctx.lineWidth = 0.08 * s;
      ctx.beginPath(); ctx.arc(0, 0, r * (1.2 + 1.6 * ph), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(70,45,20,0.25)';
      ctx.beginPath(); ctx.arc(0.07 * s, 0.09 * s, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.rotate(o.spin);
    ctx.scale(grow, grow);
    ctx.globalAlpha = o.exposed ? 1 : 0.88;
    ctx.fillStyle = o.exposed ? '#fbf3e2' : '#eefaf4';
    ctx.strokeStyle = o.exposed ? 'rgba(150,120,80,0.8)' : 'rgba(90,150,150,0.7)';
    ctx.lineWidth = 0.05 * s;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // the five-petal flower
    ctx.fillStyle = o.exposed ? 'rgba(170,135,90,0.75)' : 'rgba(90,150,150,0.6)';
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i / 5) * Math.PI * 2);
      ctx.beginPath(); ctx.ellipse(r * 0.45, 0, r * 0.3, r * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // glints
    for (let i = 0; i < 3; i++) {
      const ph = time * (o.exposed ? 1.3 : 2.1) + i * 2.1 + o.spin;
      const k = Math.max(0, Math.sin(ph));
      const a = o.spin + i * 2.4 + Math.floor(ph / (Math.PI * 2)) * 1.7;
      this.twinkle(x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r * 1.25, r * (0.45 + 0.95 * k * k), 0.95 * k * k * k);
    }
  }

  label(text, x, y, size, color) {
    const ctx = this.ctx;
    ctx.font = `${Math.round(size)}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = 'rgba(40,28,20,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  drawPlayer(p, game, s, time) {
    const ctx = this.ctx, g = CFG.game, st = PLAYER_STYLES[p.id];
    const soaked = p.soaked > 0;
    const shiver = soaked && !p.inWater ? Math.sin(time * 55) * 0.03 : 0;
    const x = (p.x + shiver) * s, y = p.y * s, r = g.playerRadius * s;
    const speed = Math.hypot(p.vx, p.vy);
    const scoring = game.phase === 'play';

    // ripple ring when wading
    if (p.inWater) {
      const ph = (time * 1.4) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - ph)})`;
      ctx.lineWidth = 0.07 * s;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.9 + ph * 1.1), 0, Math.PI * 2);
      ctx.stroke();
    }

    // hold ring: fills as the standing multiplier climbs
    if (scoring && p.hold > 0 && !soaked) {
      const frac = Math.min(1, p.hold / g.holdMax);
      const rr = r * 1.55;
      ctx.lineWidth = 0.17 * s;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = frac >= 1 ? '#ffe45c' : '#ffffff';
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (soaked && scoring) {
      const frac = p.soaked / g.soakTime;
      ctx.lineWidth = 0.14 * s;
      ctx.strokeStyle = 'rgba(120,200,255,0.85)';
      ctx.beginPath(); ctx.arc(x, y, r * 1.55, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    }

    // shadow
    ctx.fillStyle = 'rgba(70,45,20,0.28)';
    ctx.beginPath();
    ctx.ellipse(x + 0.2 * s, y + 0.26 * s, r * 1.02, r * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    // feet
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.face);
    const swing = speed > 0.5 ? Math.sin(p.walk * 5) * 0.42 : 0;
    ctx.fillStyle = '#e9b48a';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse((0.28 + swing * side) * s, side * 0.3 * s, 0.26 * s, 0.15 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // shirt
    ctx.fillStyle = soaked ? st.dark : st.color;
    ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
    // straw hat with a band in the player colour
    ctx.fillStyle = soaked ? '#cdb37a' : '#f6dc97';
    ctx.strokeStyle = 'rgba(120,85,30,0.55)';
    ctx.lineWidth = 0.05 * s;
    ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = st.color;
    ctx.beginPath(); ctx.arc(x, y, r * 0.56, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = soaked ? '#d9c088' : '#fbe9b4';
    ctx.beginPath(); ctx.arc(x - 0.03 * s, y - 0.03 * s, r * 0.42, 0, Math.PI * 2); ctx.fill();

    // labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!scoring) {
      this.label(st.name, x, y - r * 2.1, 0.8 * s, st.color);
      return;
    }
    if (soaked) {
      this.label('SOAKED', x, y - r * 2.2, 0.72 * s, '#bfe6ff');
    } else if (p.pot >= 1) {
      const size = (0.85 + Math.min(0.75, Math.log10(1 + p.pot) * 0.2)) * s;
      this.label('+' + Math.floor(p.pot), x, y - r * 2.4, size, '#fff7d6');
      this.label('×' + (p.depthMult * p.holdMult).toFixed(1), x, y + r * 2.35, 0.62 * s, '#ffe45c');
    } else {
      const m = p.depthMult;
      this.label(m > 0.05 ? '×' + m.toFixed(1) : 'too safe', x, y + r * 2.2, 0.58 * s, m > 0.05 ? '#ffffff' : 'rgba(255,255,255,0.75)');
    }
  }
}
