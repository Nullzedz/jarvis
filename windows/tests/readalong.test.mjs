import test from "node:test";
import assert from "node:assert/strict";
import { readPieces, splitPieces } from "../src/core/readalong.ts";

test("a paragraph is read a sentence or two at a time", () => {
  const p = splitPieces("So the island is done. We fixed the animations. The tabs grow to fit. Sleep works from open and closed. What's left is the main window.");
  assert.ok(p.length >= 3, p.join(" | "));
  for (const s of p) {
    const sentences = s.match(/[.!?]/g)?.length ?? 0;
    assert.ok(sentences <= 2, s);
  }
  assert.equal(p.join(" "), "So the island is done. We fixed the animations. The tabs grow to fit. Sleep works from open and closed. What's left is the main window.");
});

test("a very long sentence breaks at a comma", () => {
  const long = "Mail still needs a week though, the month view is fine but the sorting rules need real testing with a big inbox, and I don't want to promise it before that.";
  const p = splitPieces(long);
  assert.ok(p.length >= 2, p.join(" | "));
  assert.ok(p.every((s) => s.length <= 150), p.join(" | "));
});

test("a short line stays whole", () => {
  assert.deepEqual(splitPieces("Okay. Then let's ship the island first."), ["Okay. Then let's ship the island first."]);
});

test("pieces share their line's time by length, and the first of each line marks the gap", () => {
  const pieces = readPieces([
    { speaker: "a", start: 0, end: 30, text: "One two three. Four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five." },
    { speaker: "b", start: 33, end: 36, text: "Okay." },
  ]);
  assert.equal(pieces[0].start, 0);
  const lastOfA = pieces.filter((p) => p.speaker === "a").at(-1);
  assert.ok(Math.abs(lastOfA.end - 30) < 1e-9);
  for (let i = 1; i < pieces.length; i++) if (pieces[i].line === pieces[i - 1].line) assert.ok(Math.abs(pieces[i].start - pieces[i - 1].end) < 1e-9);
  assert.deepEqual(pieces.map((p) => p.first), pieces.map((p, i) => i === 0 || p.line !== pieces[i - 1].line));
  assert.equal(pieces.at(-1).start, 33);
});
