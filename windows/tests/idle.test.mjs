import test from "node:test";
import assert from "node:assert/strict";
import { ASLEEP_AFTER_S, DROWSY_AFTER_S, IDLE_BITS, PLAYFUL_AFTER_S, bitGapMs, fallsAsleep, idlePhase, pickBit, yawnGapMs } from "../src/core/idle.ts";

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

test("he falls asleep after 10 min of quiet, only idle and in the closed pill", () => {
  assert.equal(ASLEEP_AFTER_S, 600);
  assert.ok(!fallsAsleep(ASLEEP_AFTER_S - 1, true, true));
  assert.ok(fallsAsleep(ASLEEP_AFTER_S, true, true));
  assert.ok(!fallsAsleep(ASLEEP_AFTER_S, false, true), "busy, or dancing to music: awake");
  assert.ok(!fallsAsleep(ASLEEP_AFTER_S, true, false), "open, or the closed island shows something else");
  assert.ok(!fallsAsleep(0, true, true), "any input wakes him");
});
