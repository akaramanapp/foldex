// Synthesizes the intro's sound effects, timed to the events in scene.html.
// Usage: node sfx.mjs <en|tr> <out.wav>
import fs from "node:fs";

const [lang = "en", out = "sfx.wav"] = process.argv.slice(2);
const SR = 48000, DUR = 25, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);

let seed = 20251115;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function put(i, v, pan) {
  if (i < 0 || i >= N) return;
  L[i] += v * (pan > 0 ? 1 - pan : 1);
  R[i] += v * (pan < 0 ? 1 + pan : 1);
}

// Short bubbly pop: pitch drops quickly onto f.
function pop(t, f = 600, g = 0.25, pan = 0) {
  let ph = 0;
  for (let n = 0, len = SR * 0.18; n < len; n++) {
    const x = n / SR;
    ph += (2 * Math.PI * f * (1 + 0.9 * Math.exp(-x / 0.022))) / SR;
    const env = (1 - Math.exp(-x / 0.0015)) * Math.exp(-x / 0.05);
    put(Math.round(t * SR) + n, Math.sin(ph) * env * g, pan);
  }
}

// Keyboard tick: a filtered noise burst with a small tonal body.
function click(t, g = 0.08, pan = 0) {
  let prev = 0;
  for (let n = 0, len = SR * 0.03; n < len; n++) {
    const x = n / SR, w = rnd(), hp = w - prev; prev = w;
    const v = hp * Math.exp(-x / 0.003) * 0.7 + Math.sin(2 * Math.PI * 2100 * x) * Math.exp(-x / 0.005) * 0.4;
    put(Math.round(t * SR) + n, v * g, pan);
  }
}

// Bell-like note with a couple of harmonics.
function note(t, f, g = 0.15, decay = 0.5, pan = 0) {
  for (let n = 0, len = SR * decay * 3.5; n < len; n++) {
    const x = n / SR, w = 2 * Math.PI * f * x;
    const env = (1 - Math.exp(-x / 0.004)) * Math.exp(-x / decay);
    put(Math.round(t * SR) + n, (Math.sin(w) + 0.32 * Math.sin(2 * w) + 0.12 * Math.sin(3.01 * w)) * env * g, pan);
  }
}
const arp = (t, freqs, step, g, decay = 0.35) => freqs.forEach((f, i) => note(t + i * step, f, g, decay, (i / (freqs.length - 1 || 1) - 0.5) * 0.6));

// Whoosh: noise through a resonant band-pass whose center sweeps, panned across.
function whoosh(t, dur, g = 0.22, up = true) {
  let low = 0, band = 0;
  const f0 = up ? 250 : 3200, f1 = up ? 3200 : 250;
  for (let n = 0, len = SR * dur; n < len; n++) {
    const x = n / len;
    const fc = f0 * Math.pow(f1 / f0, x);
    const f = 2 * Math.sin((Math.PI * fc) / SR);
    const high = rnd() - low - 0.55 * band;
    band += f * high; low += f * band;
    const env = Math.pow(Math.sin(Math.PI * x), 2);
    put(Math.round(t * SR) + n, band * env * g, (x - 0.5) * 1.2 * (up ? 1 : -1));
  }
}

// Low thump for the logo landing.
function thump(t, g = 0.5) {
  let ph = 0;
  for (let n = 0, len = SR * 0.4; n < len; n++) {
    const x = n / SR;
    ph += (2 * Math.PI * (55 + 70 * Math.exp(-x / 0.04))) / SR;
    put(Math.round(t * SR) + n, Math.sin(ph) * Math.exp(-x / 0.12) * g, 0);
  }
}

const typeTimes = (str, a, b) => [...str].map((_, j) => a + (b - a) * ((j + 0.5) / str.length));
const USER = lang === "tr" ? "Banka CSV'lerimi birleştiren bir script yaz." : "Write a script that merges my bank CSVs.";
const PENTA = [523, 587, 659, 784, 880, 1047, 1175];

// Scene 1: 25 folders pop in, one every 0.13s.
for (let k = 0; k < 25; k++) pop(0.25 + k * 0.13 + 0.02, PENTA[Math.floor(((rnd() + 1) / 2) * PENTA.length)] * 0.9, 0.15, rnd() * 0.6);

// Scene 2: chat opens, prompt is typed, project is born and indexed.
whoosh(4.05, 0.5, 0.1, true);
typeTimes(USER, 4.6, 5.8).forEach((tt, j) => USER[j] !== " " && click(tt, 0.13 + 0.04 * Math.abs(rnd()), rnd() * 0.3));
pop(6.0, 700, 0.16);
pop(6.2, 380, 0.3);
arp(6.25, [1319, 1568, 1976, 2637], 0.05, 0.09, 0.25);
arp(6.7, [1319, 1760], 0.09, 0.17, 0.45);
pop(7.2, 620, 0.16);
whoosh(8.25, 0.55, 0.13, false);

// Scene 3: folders fly into cards; the counter ticks up to 142.
whoosh(8.95, 1.05, 0.26, true);
[523, 587, 659, 698, 784, 880, 988, 1047].forEach((f, i) => pop(9.0 + i * 0.11 + 0.64, f, 0.17, (i % 4) / 3 - 0.5));
{
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  let last = 0;
  for (let t = 9.2; t <= 10.6; t += 1 / 120) {
    const c = Math.round(142 * easeOut((t - 9.2) / 1.4));
    if (Math.floor(c / 12) > last) { last = Math.floor(c / 12); click(t, 0.07, 0.5); }
  }
}

// Scene 4: type "pdf", the grid filters, matches light up.
typeTimes("pdf", 13.3, 13.9).forEach((tt) => click(tt, 0.22));
whoosh(14.05, 0.45, 0.1, false);
arp(14.6, [1568, 2093], 0.07, 0.11, 0.4);

// Scene 5: mouse click, session slides in, messages appear.
click(18.0, 0.55); click(18.09, 0.38);
whoosh(18.4, 0.6, 0.2, true);
pop(19.15, 660, 0.14);
pop(19.6, 820, 0.14);

// Scene 6: outro.
whoosh(20.35, 0.8, 0.26, false);
thump(20.92, 0.45);
pop(20.92, 330, 0.28);
arp(21.0, [1568, 2093, 2637], 0.045, 0.07, 0.3);
[523, 659, 784, 1047].forEach((f, i) => note(21.12, f, 0.085, 1.3, (i - 1.5) * 0.25));
typeTimes("npx -y foldex-mcp", 22.0, 22.6).forEach((tt, j) => j % 2 === 0 && click(tt, 0.15));
arp(22.75, [1047, 1568], 0.08, 0.08, 0.6);

// Master: normalize, then soft-clip so stacked pops never distort.
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const k = Math.tanh(1.3);
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const l = (Math.tanh((L[i] / peak) * 1.3) / k) * 0.89, r = (Math.tanh((R[i] / peak) * 1.3) / k) * 0.89;
  buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
fs.writeFileSync(out, buf);
console.error(`wrote ${out} (${DUR}s, peak before master ${peak.toFixed(2)})`);
