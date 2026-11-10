// Small procedural soundscape: filtered-noise surf that follows the
// simulated breaking, plus a few arcade blips. Starts on first key press.

export class Sound {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // brown-ish noise loop
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 3.2 + w * 0.08;
    }
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(0, Math.random() * 3);
      return { f, g };
    };
    this.rumble = mk('lowpass', 420, 0.3);
    this.hiss = mk('bandpass', 2600, 0.5);
  }

  setSurf(x) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = Math.min(1, x);
    this.rumble.g.gain.setTargetAtTime(0.10 + 0.55 * s, t, 0.25);
    this.rumble.f.frequency.setTargetAtTime(350 + 700 * s, t, 0.25);
    this.hiss.g.gain.setTargetAtTime(0.012 + 0.16 * s, t, 0.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  note(freq, at, dur, type = 'triangle', vol = 0.16) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  bank(amount) {
    const up = Math.min(12, Math.floor(Math.log2(1 + amount / 20)) * 2);
    const base = 523.25 * Math.pow(2, up / 12);
    this.note(base, 0, 0.12);
    this.note(base * 1.26, 0.07, 0.12);
    this.note(base * 1.5, 0.14, 0.22);
  }

  soak() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);
  }

  beep(high) { this.note(high ? 880 : 440, 0, high ? 0.5 : 0.18, 'square', 0.08); }

  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this.note(f, i * 0.12, 0.3)); }
}
