import test from "node:test";
import assert from "node:assert/strict";
import { place, GAP } from "../src/explain/place.ts";

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the window goes beside the target, on the side with the most room, never over it", () => {
  const target = { x: 200, y: 300, w: 80, h: 30 };
  const r = place(target, 320, 200, 1280, 720);
  assert.equal(r.linked, false);
  assert.equal(r.x, 200 + 80 + GAP); // right has the most room
  assert.ok(!overlaps(r, target));
});

test("a target near the right edge gets its window on the left", () => {
  const target = { x: 1150, y: 300, w: 80, h: 30 };
  const r = place(target, 320, 200, 1280, 720);
  assert.ok(r.x + r.w <= target.x);
  assert.ok(!overlaps(r, target));
});

test("a second window never covers the first", () => {
  const target = { x: 200, y: 300, w: 80, h: 30 };
  const first = place(target, 320, 200, 1280, 720);
  const second = place({ x: 300, y: 320, w: 60, h: 24 }, 320, 200, 1280, 720, [first]);
  assert.ok(!overlaps(first, second));
});

test("with no room beside the target it goes to the far corner, linked back", () => {
  const target = { x: 100, y: 100, w: 1080, h: 520 };
  const r = place(target, 320, 200, 1280, 720);
  assert.equal(r.linked, true);
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720);
});
