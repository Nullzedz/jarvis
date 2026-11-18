import test from "node:test";
import assert from "node:assert/strict";
import { reactorPose, REACTOR_END } from "../src/mochi/reactor.ts";

test("the ring draws and bends into the visor, which stays big and centred for the island to fold", () => {
  const start = reactorPose(0);
  assert.equal(start.morph, 0);
  assert.equal(start.body, 0);
  assert.ok(Math.abs(start.eye) < 1e-9);

  const mid = reactorPose(1.45);
  assert.ok(mid.morph > 0.3 && mid.morph < 0.7, `morph ${mid.morph}`);

  const lit = reactorPose(2.6);
  assert.equal(lit.morph, 1);
  assert.equal(lit.body, 1);
  assert.ok(Math.abs(lit.eye - 1) < 1e-9);
  assert.equal(lit.R, 40); // still big and centred during the hold

  const end = reactorPose(REACTOR_END + 1);
  assert.equal(end.R, 40, "the island carries it down, not the startup");
  assert.equal(end.x, 320);
});

test("the eye blinks once after the hold", () => {
  assert.equal(reactorPose(2.9).open, 1);
  assert.ok(reactorPose(3.0).open < 0.5);
  assert.equal(reactorPose(3.3).open, 1);
});

test("leaving early finishes the visor at once, ready for the fold", () => {
  const p = reactorPose(0.8, 0.5);
  assert.equal(p.morph, 1);
  assert.equal(p.body, 1);
  assert.equal(p.ringW, 0);
});
