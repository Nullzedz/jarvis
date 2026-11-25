import test from "node:test";
import assert from "node:assert/strict";
import { widthFor } from "../src/explain/draw.ts";

test("#88: his drawing's width: viewBox, else width=, never NaN", () => {
  assert.equal(widthFor({ kind: "drawing", svg: "<svg viewBox='0 0 1e3 400'></svg>" }), 640);
  assert.equal(widthFor({ kind: "drawing", svg: "<svg viewBox='0 0 1.2.3 5' width='350'></svg>" }), 374);
  assert.equal(widthFor({ kind: "drawing", svg: "<svg viewBox='0 0 320 200'></svg>" }), 344);
  assert.equal(widthFor({ kind: "drawing", svg: "<SVG></SVG>" }), 424);
  assert.equal(widthFor({ kind: "steps" }), 320);
});
