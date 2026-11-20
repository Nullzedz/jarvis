import test from "node:test";
import assert from "node:assert/strict";
import { overlapping } from "../src/explain/draw.ts";

const box = (text, left, top, w, h) => ({ text, r: { left, top, right: left + w, bottom: top + h } });

test("a label lying on another text is caught (issue #14)", () => {
  // "links to" drawn across "id (PK)", as in the first messy drawing.
  const hit = overlapping([box("Audit", 10, 10, 60, 16), box("id (PK)", 120, 40, 50, 14), box("links to", 110, 36, 56, 14)]);
  assert.deepEqual(hit, ["id (PK)", "links to"]);
});

test("texts that only touch, or don't meet, pass", () => {
  assert.equal(overlapping([box("many", 0, 0, 40, 14), box("1", 40, 0, 8, 14), box("Workspace", 0, 30, 80, 16)]), null);
  // A sliver (a descender over the next line) isn't an overlap.
  assert.equal(overlapping([box("Member", 0, 0, 60, 16), box("Optional", 0, 15, 60, 16)]), null);
});
