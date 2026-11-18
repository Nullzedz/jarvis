import test from "node:test";
import assert from "node:assert/strict";
import { reactorPose, REACTOR_END, BlackHole, BOOM } from "../src/mochi/reactor.ts";

/** A repeatable random sequence, so the physics test always runs the same. */
function seeded(n) {
  return () => ((n = (n * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test("the black hole swallows the specks while the ring spins, then blasts them all out", () => {
  const rnd = seeded(7);
  const hole = new BlackHole();
  hole.seed(rnd);
  const dt = 1 / 120;
  let t = 0;
  for (; t < BOOM - dt; t += dt) hole.step(t, dt, rnd);
  assert.ok(hole.absorbed >= 60, `most specks swallowed before the blast (${hole.absorbed}/90)`);
  assert.ok(hole.charge > 0.6);
  for (; t < BOOM + 0.3; t += dt) hole.step(t, dt, rnd);
  assert.equal(hole.boomed, true);
  assert.equal(hole.charge, 0);
  assert.ok(hole.specks.every((p) => !p.gone), "every speck comes back out");
  // Measured in the blast's own elliptical space (it is wide, like the island).
  const far = hole.specks.filter((p) => Math.hypot(p.x, p.y * 2.6) > 150).length;
  assert.ok(far > 80, `they fly outward (${far}/90)`);
});

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
