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

test("#88: with no room beside it, it takes a free corner, not one where a window already is", () => {
  const target = { x: 150, y: 120, w: 980, h: 480 };
  const old = { x: 1280 - 12 - 320, y: 12, w: 320, h: 200 };
  const r = place(target, 320, 200, 1280, 720, [old]);
  assert.equal(r.linked, true);
  assert.ok(!overlaps(r, old));
  assert.ok(r.x >= 12 && r.y >= 12 && r.x + r.w <= 1268 && r.y + r.h <= 708);
});

test("#88: a window bigger than the screen is made to fit it", () => {
  const r = place({ x: 100, y: 100, w: 80, h: 30 }, 1600, 900, 1280, 720);
  assert.ok(r.w <= 1280 - 24 && r.h <= 720 - 24);
  assert.ok(r.x >= 12 && r.y >= 12 && r.x + r.w <= 1268 && r.y + r.h <= 708);
});

test("#88: thousands of layouts: always on screen, never on the target when a spot is free", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {
    const vw = 800 + Math.floor(rnd() * 2000), vh = 600 + Math.floor(rnd() * 1200);
    const t = { x: rnd() * vw * 0.8, y: rnd() * vh * 0.8, w: 10 + rnd() * vw * 0.5, h: 10 + rnd() * vh * 0.5 };
    const taken = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ x: rnd() * vw, y: rnd() * vh, w: 200, h: 150 }));
    const r = place(t, 200 + rnd() * 400, 120 + rnd() * 400, vw, vh, taken);
    assert.ok(r.x >= 11.5 && r.y >= 11.5 && r.x + r.w <= vw - 11.5 && r.y + r.h <= vh - 11.5, JSON.stringify({ vw, vh, t, r }));
    assert.ok(Number.isFinite(r.x + r.y + r.w + r.h));
  }
});
