// Scripted players. They see what a person sees (where the water is and how
// fast it is closing) and react after a delay. Used by tools/bots.mjs to
// estimate typical scores; could also drive in-game opponents later.

import { CFG } from './config.js';

export function makeBot(opts) {
  return {
    name: 'bot',
    zT: 0.4, // bed height of the spot it likes to stand on (lower = nearer the sea)
    flee: 2.5, // runs when the water is this close (m), after allowing for closing speed
    back: 3, // returns once its spot is this far clear of the water (m)
    clear: 2, // when fleeing, stops once it has this much more room than `flee`
    lookahead: 0.5, // s of the water's closing speed it allows for
    delay: 0.25, // reaction time (s)
    seek: false, // goes after sand dollars
    x: 32,
    ...opts,
    state: 'go', homeY: null, hist: [], lastGap: 30,
  };
}

// Distance from (x, y) up the screen to the nearest water, capped at 30 m.
function gapAt(sim, x, y) {
  const touch = CFG.game.touchDepth;
  for (let yy = y; yy > 0; yy -= 0.2) if (sim.depthAt(x, yy) > touch) return y - yy;
  return 30;
}

export function botInput(bot, p, game, out) {
  const sim = game.sim, tick = CFG.game.tick;
  out.x = 0; out.y = 0;
  if (game.phase !== 'play') { bot.homeY = null; bot.state = 'go'; bot.hist.length = 0; return; }
  if (bot.homeY === null) {
    let y = CFG.world.H - 1;
    while (y > 2 && sim.bedAt(bot.x, y) > bot.zT) y -= 0.1;
    bot.homeY = y;
  }

  // what the bot perceives: gap to the water around it, delayed
  const r = CFG.game.playerRadius;
  const gapNow = Math.min(gapAt(sim, p.x, p.y), gapAt(sim, p.x - 1, p.y), gapAt(sim, p.x + 1, p.y)) - r;
  bot.hist.push(gapNow);
  const lag = Math.round(bot.delay / tick);
  if (bot.hist.length > lag + 13) bot.hist.shift();
  const seen = bot.hist[Math.max(0, bot.hist.length - 1 - lag)];
  const before = bot.hist[0];
  const closing = Math.max(0, (before - seen) / (Math.max(1, bot.hist.length - 1 - lag) * tick));
  const threat = seen - closing * bot.lookahead;

  const go = (tx, ty) => {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.15) return true;
    out.x = dx / d; out.y = dy / d;
    return false;
  };

  // sand dollars: worth a dash if one is lying clear of the water
  let target = null;
  if (bot.seek) {
    for (const o of game.dollars) {
      if (!o.exposed || gapAt(sim, o.x, o.y) < 1.2) continue;
      if (!target || Math.hypot(o.x - p.x, o.y - p.y) < Math.hypot(target.x - p.x, target.y - p.y)) target = o;
    }
  }

  if (threat < bot.flee && bot.state !== 'flee') bot.state = 'flee';
  if (target && (bot.state !== 'flee' || Math.hypot(target.x - p.x, target.y - p.y) < 2)) {
    go(target.x, target.y);
    bot.state = 'go';
    return;
  }
  switch (bot.state) {
    case 'flee':
      out.y = 1;
      if (seen > bot.flee + bot.clear && closing < 0.3) bot.state = 'wait';
      break;
    case 'wait':
      if (gapAt(sim, bot.x, bot.homeY) - r > bot.back) bot.state = 'go';
      break;
    case 'go':
      if (go(bot.x, bot.homeY)) bot.state = 'hold';
      break;
    case 'hold':
      break;
  }
}
