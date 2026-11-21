import test from "node:test";
import assert from "node:assert/strict";
import { FOCUS_LENGTHS, Focus, clockText, focusDone, focusLeftMs } from "../src/core/focus.ts";

test("the prototype's lengths, in its order", () => {
  assert.deepEqual([...FOCUS_LENGTHS], [25, 50, 15]);
});

test("time left and progress of a session", () => {
  const f = { startedAt: 0, minutes: 25 };
  assert.equal(focusLeftMs(f, 0), 25 * 60_000);
  assert.equal(focusLeftMs(f, 25 * 60_000 + 5), 0, "never below zero");
  assert.equal(focusDone(f, 0), 0);
  assert.equal(focusDone(f, 12.5 * 60_000), 0.5);
  assert.equal(focusDone(f, 30 * 60_000), 1);
});

test("the clock reads like the prototype's", () => {
  assert.equal(clockText(25 * 60_000), "25:00");
  assert.equal(clockText(18 * 60_000 + 40_000), "18:40");
  assert.equal(clockText(65_000), "1:05");
  assert.equal(clockText(500), "0:01", "the last second still shows");
  assert.equal(clockText(65 * 60_000), "1:05:00");
});

test("a session starts, survives being read again, and stops", () => {
  Focus.stop();
  assert.equal(Focus.get(), null);
  const f = Focus.start(50, 1000);
  assert.deepEqual(Focus.get(), f);
  Focus.stop();
  assert.equal(Focus.get(), null);
});
