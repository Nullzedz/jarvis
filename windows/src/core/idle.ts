// JARVIS's idle life (step 6 of #22, designs A + C), from how long the PC has had no input
// (src-tauri/src/presence.rs). Pure; tested in tests/idle.test.mjs; played by src/island/island.ts.
//
// - awake (under 30 s): his normal idle, glance and blink.
// - playful (30 s – 4 min, design A): every 20–40 s one short move from his character sheet,
//   never the same twice in a row.
// - drowsy (after 4 min, design C): eye half-lidded and dimmer, a yawn every 25–45 s.

export type IdlePhase = "awake" | "playful" | "drowsy";

export const PLAYFUL_AFTER_S = 30;
export const DROWSY_AFTER_S = 240;
/** Step 7 (design B): a minute after the notch was last touched, the closed notch shrinks round
 *  him and he sleeps. Touched: hovered, clicked, opened or folded (not the rest of the PC). */
export const ASLEEP_AFTER_S = 60;

/** Asleep: the notch untouched long enough, he's idle, and the island is closed with him in it. */
export function fallsAsleep(untouchedSeconds: number, calm: boolean, closedWithHim: boolean): boolean {
  return calm && closedWithHim && untouchedSeconds >= ASLEEP_AFTER_S;
}

export function idlePhase(idleSeconds: number): IdlePhase {
  if (idleSeconds >= DROWSY_AFTER_S) return "drowsy";
  if (idleSeconds >= PLAYFUL_AFTER_S) return "playful";
  return "awake";
}

/** His little bits, from the character sheet: hop, look around, wink, stretch, head tilt. */
export type IdleBit = "hop" | "look" | "wink" | "stretch" | "tilt";
export const IDLE_BITS: readonly IdleBit[] = ["hop", "look", "wink", "stretch", "tilt"];

/** The next bit (`rnd` in 0…1): any of them but the last one. */
export function pickBit(last: IdleBit | null, rnd: number): IdleBit {
  const pool = IDLE_BITS.filter((b) => b !== last);
  return pool[Math.min(pool.length - 1, Math.floor(rnd * pool.length))];
}

/** Milliseconds to the next bit: 20–40 s. */
export function bitGapMs(rnd: number): number {
  return 20_000 + rnd * 20_000;
}

/** Milliseconds to the next yawn while drowsy: 25–45 s. */
export function yawnGapMs(rnd: number): number {
  return 25_000 + rnd * 20_000;
}
