// Synthesises JARVIS's own sounds into windows/sounds/ (served at /sounds/<name>.wav,
// see SOUNDS_DIR in vite.config.ts). Clean, soft electronic tones: no samples,
// nothing borrowed, so every sound is ours.
//
//   node scripts/gen-sounds.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "sounds");
const RATE = 44100;

// A note: [frequency Hz (or [from, to] for a glide), start s, duration s, gain, wave]
const N = (f, t, d, g = 0.6, wave = "sine") => ({ f, t, d, g, wave });

const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77;
const C6 = 1046.5, E6 = 1318.5, G6 = 1568, A4 = 440, E4 = 329.63, G4 = 392, C4 = 261.63;

const SOUNDS = {
  peek: [N([600, 900], 0, 0.08, 0.4)],
  open: [N([500, 1000], 0, 0.12, 0.5)],
  close: [N([1000, 500], 0, 0.12, 0.5)],
  hover: [N(1200, 0, 0.04, 0.25)],
  blip: [N(1400, 0, 0.05, 0.4)],
  slap: [N([300, 150], 0, 0.09, 0.7, "triangle")],
  annoyed: [N(330, 0, 0.09, 0.5, "triangle"), N(311, 0.1, 0.12, 0.5, "triangle")],
  dizzy: [N([900, 400], 0, 0.15, 0.4), N([800, 350], 0.15, 0.15, 0.4), N([700, 300], 0.3, 0.2, 0.4)],
  greet: [N(G5, 0, 0.1), N(C6, 0.1, 0.18)],
  greeting: [N(C5, 0, 0.14, 0.45), N(E5, 0.14, 0.14, 0.45), N(G5, 0.28, 0.14, 0.45), N(C6, 0.42, 0.45, 0.5)],
  work: [N(A5, 0, 0.06, 0.35), N(E6, 0.08, 0.06, 0.3)],
  finish: [N(E5, 0, 0.1), N(G5, 0.1, 0.1), N(C6, 0.2, 0.3)],
  error: [N(A4, 0, 0.14, 0.6, "triangle"), N(311.13, 0.16, 0.25, 0.6, "triangle")],
  approval: [N(B5, 0, 0.09, 0.55), N(B5, 0.16, 0.09, 0.55), N(E6, 0.32, 0.2, 0.55)],
  question: [N(G5, 0, 0.1), N([G5, C6], 0.12, 0.18)],
  approve: [N(C6, 0, 0.07), N(G6, 0.08, 0.14)],
  gulp: [N([700, 250], 0, 0.12, 0.6)],
  tick: [N(2000, 0, 0.02, 0.3)],
  send: [N([600, 1600], 0, 0.14, 0.45)],
  love: [N(E5, 0, 0.12, 0.4), N(A5, 0.12, 0.25, 0.4)],
  pop: [N([400, 1200], 0, 0.05, 0.5)],
  proud: [N(C5, 0, 0.1), N(E5, 0.1, 0.1), N(G5, 0.2, 0.1), N(E6, 0.3, 0.3)],
  wink: [N(E6, 0, 0.05, 0.35), N(G6, 0.07, 0.07, 0.35)],
  yawn: [N([500, 280], 0, 0.5, 0.35)],
  attach: [N(D5, 0, 0.06), N(A5, 0.07, 0.1)],
  think: [N(E4, 0, 0.1, 0.3), N(G4, 0.12, 0.1, 0.3)],
  search: [N([800, 1400], 0, 0.1, 0.3), N([800, 1400], 0.14, 0.1, 0.3)],
  rate: [N(G4, 0, 0.15, 0.45, "triangle"), N(E4, 0.17, 0.25, 0.45, "triangle")],
  sleep: [N([400, 200], 0, 0.6, 0.3)],
};

function render(notes) {
  const end = Math.max(...notes.map((n) => n.t + n.d)) + 0.05;
  const buf = new Float32Array(Math.ceil(end * RATE));
  for (const n of notes) {
    const [f0, f1] = Array.isArray(n.f) ? n.f : [n.f, n.f];
    const start = Math.floor(n.t * RATE);
    const len = Math.floor(n.d * RATE);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const f = f0 + (f1 - f0) * p;
      phase += (2 * Math.PI * f) / RATE;
      const s = n.wave === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
      // soft attack, exponential tail
      const env = Math.min(1, i / (RATE * 0.004)) * Math.exp(-4 * p);
      // a quiet octave above gives the tones a little shimmer
      const shimmer = 0.15 * Math.sin(phase * 2);
      buf[start + i] += (s + shimmer) * env * n.g;
    }
  }
  return buf;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.8)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, notes] of Object.entries(SOUNDS)) {
  writeFileSync(join(OUT, `${name}.wav`), wav(render(notes)));
}
console.log(`${Object.keys(SOUNDS).length} sounds written to ${OUT}`);
