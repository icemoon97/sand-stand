import { CFG } from './config.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Game, PLAYER_STYLES } from './game.js';
import { Overlay } from './overlay.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), glCanvas = $('gl'), fxCanvas = $('fx');
const params = new URLSearchParams(location.search);
const fixedSeed = params.has('seed') ? Number(params.get('seed')) >>> 0 : null;

const sim = new Sim();
sim.reset(fixedSeed ?? ((Math.random() * 2 ** 31) | 0));
const game = new Game(sim, 2);
const overlay = new Overlay(fxCanvas);
const sound = new Sound();
let renderer;
try {
  renderer = new Renderer(glCanvas, sim, CFG.world);
} catch (e) {
  $('panel').innerHTML = `<h2>Can't start</h2><p>${e.message}</p>`;
  throw e;
}

// ---- layout: 16:9 stage fitted to the window
function layout() {
  const ar = CFG.world.W / CFG.world.H;
  let w = window.innerWidth - 16, h = window.innerHeight - 16;
  if (w / h > ar) w = h * ar; else h = w / ar;
  stage.style.width = Math.floor(w) + 'px';
  stage.style.height = Math.floor(h) + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [glCanvas, fxCanvas]) {
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
  }
}
window.addEventListener('resize', layout);
layout();

// ---- input
const keys = new Set();
const BINDS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
];
const inputs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
function readInputs() {
  for (let i = 0; i < BINDS.length; i++) {
    const b = BINDS[i];
    inputs[i].x = (keys.has(b.right) ? 1 : 0) - (keys.has(b.left) ? 1 : 0);
    inputs[i].y = (keys.has(b.down) ? 1 : 0) - (keys.has(b.up) ? 1 : 0);
  }
}
const silent = params.has('mute'); // ?mute: never start audio (automated test tabs)
let debugOn = params.has('debug');
let paused = false;
function setPaused(on) {
  paused = on;
  $('pause').style.display = on ? 'grid' : 'none';
  sound.duck(on);
}
window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (!silent) sound.init();
  keys.add(e.code);
  if (e.code === 'Escape') {
    if (paused || game.phase === 'countdown' || game.phase === 'play') setPaused(!paused);
  } else if (paused) {
    // everything else waits
  } else if (e.code === 'Space' || e.code === 'Enter') {
    if (game.phase === 'title' || game.phase === 'results') startRound();
  } else if (e.code === 'KeyM') sound.toggleMute();
  else if (e.code === 'Backquote') { debugOn = !debugOn; $('debug').style.display = debugOn ? 'block' : 'none'; }
  else if (e.code === 'KeyR' && game.phase === 'play') startRound();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---- round flow & HUD
const cards = [$('c0'), $('c1')].map((el) => ({
  el, score: el.querySelector('.score'), sub: el.querySelector('.sub'), shown: 0, bumpT: 0,
}));
const panel = $('panel'), count = $('count'), timerEl = $('timer'), fade = $('fade');
let seed = sim.seed;

function showTitle() {
  panel.style.display = '';
  panel.innerHTML = `
    <h1>SAND <span>STAND</span></h1>
    <p>Stand still on the sand to fill your pot. The closer to the sea and the longer you hold your nerve, the faster it fills.
       Step away to bank it. If the water touches your feet first, the pot is gone.</p>
    <p>Watch for sand dollars glinting under the waves: first to reach one after the water drains off it gets +${CFG.dollars.bonus}.</p>
    <div class="keys">
      <div style="color:${PLAYER_STYLES[0].color}"><b>Player 1</b><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd></div>
      <div style="color:${PLAYER_STYLES[1].color}"><b>Player 2</b><kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd></div>
    </div>
    <div class="go">Press <kbd>Space</kbd> to start</div>`;
}

function showResults() {
  const w = game.winner();
  const title = w < 0 ? 'Dead heat!' : `<span style="color:${PLAYER_STYLES[w].color}">Player ${w + 1}</span> wins!`;
  const row = (label, f) => `<tr><td>${label}</td>${game.players.map((p) => `<td ${f.big ? 'class="big"' : ''} style="color:${PLAYER_STYLES[p.id].dark}">${f.v(p)}</td>`).join('')}</tr>`;
  panel.style.display = '';
  panel.innerHTML = `
    <h2>${title}</h2>
    <table>
      ${row('Score', { big: true, v: (p) => p.score.toLocaleString() })}
      ${row('Best single stand', { v: (p) => '+' + p.bestPot.toLocaleString() })}
      ${row('Sand dollars', { v: (p) => p.dollars })}
      ${row('Times soaked', { v: (p) => p.soaks })}
    </table>
    <p style="opacity:.6;font-size:1.2cqw">sea #${seed}</p>
    <div class="go">Press <kbd>Space</kbd> to play again</div>`;
}

function startRound() {
  seed = fixedSeed ?? ((Math.random() * 2 ** 31) | 0);
  fade.style.opacity = 1;
  setTimeout(() => {
    game.start(seed);
    sim.cosmetics(CFG.game.tick);
    panel.style.display = 'none';
    timerEl.style.display = 'block';
    for (const c of cards) c.shown = 0;
    fade.style.opacity = 0;
  }, 260);
}

function showCount(text) {
  count.textContent = text;
  count.style.display = 'block';
  count.classList.remove('pop');
  void count.offsetWidth;
  count.classList.add('pop');
}

function handleEvents() {
  for (const e of game.events) {
    const st = e.player != null ? PLAYER_STYLES[e.player] : null;
    switch (e.type) {
      case 'countdown': showCount(e.n); sound.beep(false); break;
      case 'go': showCount('GO!'); sound.beep(true); break;
      case 'tickdown': if (e.n <= 5) sound.beep(false); break;
      case 'bank':
        overlay.pop(e.x, e.y, '+' + e.amount, st.color, e.amount >= 300);
        sound.bank(e.amount);
        cards[e.player].bumpT = 0.15;
        break;
      case 'soak':
        overlay.splash(e.x, e.y, 18);
        overlay.pop(e.x, e.y, e.lost > 0 ? 'SPLASH! −' + e.lost : 'SPLASH!', '#bfe6ff', true);
        sound.soak();
        break;
      case 'dollar': sound.sparkle(); break;
      case 'collect':
        overlay.pop(e.x, e.y, 'SAND DOLLAR +' + e.amount, '#ffe45c', true);
        sound.collect();
        cards[e.player].bumpT = 0.2;
        break;
      case 'splash': overlay.splash(e.x, e.y, 8); break;
      case 'end': showResults(); sound.fanfare(); timerEl.style.display = 'none'; break;
    }
  }
  game.events.length = 0;
}

function updateHud(dt) {
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], p = game.players[i];
    c.shown += (p.score - c.shown) * Math.min(1, dt * 10);
    if (p.score - c.shown < 1) c.shown = p.score;
    c.score.textContent = Math.round(c.shown).toLocaleString();
    c.sub.textContent = game.phase !== 'play' ? ' '
      : p.soaked > 0 ? 'soaked — drying off'
      : p.pot >= 1 ? `+${Math.floor(p.pot)} at risk` : 'walk toward the sea';
    c.bumpT -= dt;
    c.el.classList.toggle('bump', c.bumpT > 0);
    c.el.classList.toggle('wet', game.phase === 'play' && p.soaked > 0);
  }
  if (game.phase === 'play') {
    timerEl.textContent = Math.ceil(game.timer);
    timerEl.classList.toggle('low', game.timer <= 10);
  } else if (game.phase === 'countdown') {
    timerEl.textContent = CFG.game.roundTime;
    timerEl.classList.remove('low');
  }
}

// ---- main loop: fixed 60 Hz ticks, two 120 Hz water steps per tick
const TICK = CFG.game.tick;
const SUB = Math.round(TICK / CFG.sim.dt);
let last = performance.now(), acc = 0, simMs = 0, fps = 60, clock = 0;

function tick() {
  const t0 = performance.now();
  for (let i = 0; i < SUB; i++) sim.step();
  sim.cosmetics(TICK);
  simMs += (performance.now() - t0 - simMs) * 0.05;
  readInputs();
  game.tick(inputs);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const step = paused ? 0 : dt; // paused: water, players, timers and effects all hold still
  acc += step;
  clock += step;
  let n = 0;
  while (acc >= TICK && n < 4) { tick(); acc -= TICK; n++; }
  if (n === 4) acc = 0;
  handleEvents();
  renderer.draw(clock);
  overlay.draw(game, step, clock);
  updateHud(step);
  if (!paused) sound.setSurf(sim.surf);
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  if (debugOn) {
    $('debug').textContent = `fps ${fps.toFixed(0)}  sim ${simMs.toFixed(2)} ms/tick  grid ${sim.NX}x${sim.NY}  sea #${sim.seed}  t ${sim.t.toFixed(1)}  surf ${sim.surf.toFixed(2)}`;
  }
  requestAnimationFrame(frame);
}

showTitle();
if (debugOn) $('debug').style.display = 'block';
sim.cosmetics(TICK);
requestAnimationFrame(frame);

// handy for balance work from the console
window.sandStand = {
  sim, game, CFG, inputs,
  get paused() { return paused; },
  // run the game forward without waiting for frames (tests, balance scripts)
  advance(seconds, held) {
    const n = Math.round(seconds / TICK);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < SUB; k++) sim.step();
      sim.cosmetics(TICK);
      game.tick(held || inputs);
    }
    handleEvents();
  },
};
