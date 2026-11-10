// Plays full rounds with scripted players to estimate typical scores.
//   node tools/bots.mjs [rounds=10] [firstSeed=1]
// All bots share each sea; only one of them chases sand dollars, so its haul
// is what a single interested player could expect.
import { Sim } from '../src/sim.js';
import { Game } from '../src/game.js';
import { CFG } from '../src/config.js';
import { makeBot, botInput } from '../src/bots.js';
import { mulberry32 } from '../src/rng.js';

const rounds = Number(process.argv[2] ?? 10), first = Number(process.argv[3] ?? 1);
const SPECS = [
  { name: 'timid   (high, flees early)', zT: 0.6, flee: 4, back: 4 },
  { name: 'steady  (mid, flees early)', zT: 0.4, flee: 3.5, back: 3 },
  { name: 'nervy   (mid, flees late)', zT: 0.4, flee: 1.5, back: 2 },
  { name: 'deep    (low, flees early)', zT: 0.25, flee: 3.5, back: 3 },
  { name: 'daring  (low, flees late)', zT: 0.25, flee: 1.5, back: 2 },
  { name: 'reckless(waterline, late)', zT: 0.12, flee: 1.2, back: 1.5 },
  { name: 'sleepy  (low, slow reactions)', zT: 0.25, flee: 2.5, back: 3, delay: 0.6 },
  { name: 'sharp   (mid, last-second)', zT: 0.4, flee: 0.6, back: 0.8, clear: 0.6, lookahead: 0.45, delay: 0.2 },
  { name: 'sharp   (low, last-second)', zT: 0.25, flee: 0.6, back: 0.8, clear: 0.6, lookahead: 0.45, delay: 0.2 },
  { name: 'surfer  (waterline, last-second)', zT: 0.12, flee: 0.5, back: 0.6, clear: 0.5, lookahead: 0.4, delay: 0.2 },
  { name: 'surfer  (same, careful)', zT: 0.12, flee: 1.0, back: 1.0, clear: 0.8, lookahead: 0.6, delay: 0.2 },
  { name: 'sharp low + chases dollars', zT: 0.25, flee: 0.6, back: 0.8, clear: 0.6, lookahead: 0.45, delay: 0.2, seek: true },
];
const bonus = CFG.dollars.bonus;
const res = SPECS.map(() => ({ stand: [], soaks: 0, dollars: 0, best: 0 }));
let spawned = 0;
const sim = new Sim();
for (let k = 0; k < rounds; k++) {
  const seed = first + k, rng = mulberry32(seed * 7919);
  const game = new Game(sim, SPECS.length);
  game.start(seed);
  const bots = SPECS.map((s) => makeBot({ ...s, x: 4 + rng() * (CFG.world.W - 8) }));
  const inputs = SPECS.map(() => ({ x: 0, y: 0 }));
  game.players.forEach((p, i) => { p.x = bots[i].x; });
  while (game.phase !== 'results') {
    sim.step(); sim.step(); sim.cosmetics(CFG.game.tick);
    for (let i = 0; i < bots.length; i++) botInput(bots[i], game.players[i], game, inputs[i]);
    game.tick(inputs);
    for (const e of game.events) if (e.type === 'dollar') spawned++;
    game.events.length = 0;
  }
  game.players.forEach((p, i) => {
    res[i].stand.push(p.score - p.dollars * bonus);
    res[i].soaks += p.soaks; res[i].dollars += p.dollars; res[i].best += p.bestPot;
  });
  process.stderr.write('.');
}
process.stderr.write('\n');
const f = (n) => String(Math.round(n)).padStart(6);
console.log(`${rounds} rounds, seeds ${first}..${first + rounds - 1}; scores exclude sand dollar bonuses`);
console.log('strategy                           median   mean    min    max  best-stand  soaks/rd  dollars/rd');
SPECS.forEach((s, i) => {
  const a = res[i].stand.slice().sort((x, y) => x - y), mean = a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`${s.name.padEnd(33)}${f(a[a.length >> 1])} ${f(mean)} ${f(a[0])} ${f(a[a.length - 1])}  ${f(res[i].best / rounds)}    ${(res[i].soaks / rounds).toFixed(1).padStart(6)}  ${(res[i].dollars / rounds).toFixed(1).padStart(8)}`);
});
console.log(`sand dollars washed up per round: ${(spawned / rounds).toFixed(1)}`);
