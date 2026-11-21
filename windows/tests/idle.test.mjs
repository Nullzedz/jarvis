import test from "node:test";
import assert from "node:assert/strict";
import { DROWSY_AFTER_S, IDLE_BITS, PLAYFUL_AFTER_S, bitGapMs, idlePhase, pickBit, yawnGapMs } from "../src/core/idle.ts";

test("awake, then playful after 30 s, then drowsy after 4 min", () => {
  assert.equal(idlePhase(0), "awake");
  assert.equal(idlePhase(PLAYFUL_AFTER_S - 0.1), "awake");
  assert.equal(idlePhase(PLAYFUL_AFTER_S), "playful");
  assert.equal(idlePhase(DROWSY_AFTER_S - 1), "playful");
  assert.equal(idlePhase(DROWSY_AFTER_S), "drowsy");
});

test("a bit is never the same twice in a row, and every bit can come up", () => {
  for (const last of IDLE_BITS) {
    for (const r of [0, 0.3, 0.6, 0.999, 1]) assert.notEqual(pickBit(last, r), last);
  }
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(pickBit(null, i / 50));
  assert.equal(seen.size, IDLE_BITS.length);
});

test("bits come every 20–40 s, yawns every 25–45 s", () => {
  assert.equal(bitGapMs(0), 20_000);
  assert.equal(bitGapMs(1), 40_000);
  assert.equal(yawnGapMs(0), 25_000);
  assert.equal(yawnGapMs(1), 45_000);
});
