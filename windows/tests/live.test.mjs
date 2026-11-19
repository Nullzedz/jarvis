import test from "node:test";
import assert from "node:assert/strict";
import * as Live from "../src/core/live.ts";
import { extBadge, relPath } from "../src/views/live.ts";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

test("a turn: read, edit, command with its output, then done", () => {
  Live.reset();
  const id = "integration_claude";
  Live.turn(id, "C:/p/proj");
  Live.pre(id, "C:/p/proj", "Read", { file_path: "C:/p/proj/src/a.ts", offset: 40 });
  assert.equal(Live.current(id).kind, "read");
  assert.equal(Live.current(id).line, 40);
  Live.post(id, "Read", { file_path: "C:/p/proj/src/a.ts" }, undefined);

  Live.pre(id, "C:/p/proj", "Edit", { file_path: "C:/p/proj/src/a.ts", old_string: "x = 1", new_string: "x = 2" });
  const edit = Live.current(id);
  assert.equal(edit.status, "running");
  assert.equal(edit.oldText, "x = 1");
  Live.post(id, "Edit", { file_path: "C:/p/proj/src/a.ts", old_string: "x = 1", new_string: "x = 2" }, undefined);
  assert.equal(edit.status, "done");
  assert.equal(edit.newText, "x = 2");

  Live.pre(id, "C:/p/proj", "Bash", { command: "npm test" });
  Live.post(id, "Bash", { command: "npm test" }, "ℹ pass 3\nℹ fail 0");
  const cmd = Live.current(id);
  assert.equal(cmd.command, "npm test");
  assert.equal(cmd.output, "ℹ pass 3\nℹ fail 0");

  assert.equal(Live.get(id).done, false);
  Live.stop(id);
  assert.equal(Live.get(id).done, true);
  assert.deepEqual(Live.get(id).actions.map((a) => a.label), ["Read", "Edit", "Bash"]);

  Live.turn(id, "C:/p/proj");
  assert.equal(Live.active(id), false, "a new turn starts clean");
  Live.clear(id);
  assert.equal(Live.get(id), undefined);
});

test("a step whose Post never came is closed by the next one, and old steps are dropped", () => {
  Live.reset();
  const id = "x";
  Live.pre(id, "", "Read", { file_path: "/a" });
  Live.pre(id, "", "Read", { file_path: "/b" });
  assert.equal(Live.get(id).actions[0].status, "done");
  for (let i = 0; i < 40; i++) Live.pre(id, "", "Grep", { pattern: `p${i}` });
  assert.equal(Live.get(id).actions.length, 30, "the last 30 are kept");
  assert.equal(Live.current(id).query, "p39");
});

test("multi-edits show their first change; Write shows its content", () => {
  const multi = Live.actionFrom("MultiEdit", { file_path: "/f.ts", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] });
  assert.equal(multi.oldText, "a");
  assert.equal(multi.newText, "b");
  const write = Live.actionFrom("Write", { file_path: "/f.ts", content: "hello" });
  assert.equal(write.newText, "hello");
  assert.equal(write.oldText, undefined);
});

test("paths are shown relative to the session, with a type badge", () => {
  assert.equal(relPath("C:\\Users\\me\\proj\\src\\views\\gcal.ts", "C:\\Users\\me\\proj"), "src/views/gcal.ts");
  assert.equal(relPath("/other/place.ts", "/home/proj"), "/other/place.ts");
  assert.equal(extBadge("gcal.ts"), "TS");
  assert.equal(extBadge("main.rs"), "RS");
  assert.equal(extBadge("Makefile"), "TXT");
});

test("an edit plays at a pace you can follow: struck line by line, typed, never too long", async () => {
  const { strikeAt, typeDuration } = await import("../src/views/live.ts");
  assert.ok(strikeAt(1, 3) > strikeAt(0, 3), "one line after another");
  assert.ok(strikeAt(39, 40) <= 150 + 1400, "a long removal still strikes through in under 1.6 s");
  assert.equal(typeDuration(0), 600, "a tiny edit still shows itself");
  assert.ok(typeDuration(110) >= 1000, "about 110 characters a second");
  assert.equal(typeDuration(100_000), 4500, "a whole file types in 4.5 s at most");
});

test("the done card fits its summary, and shows it as plain words", async () => {
  const { foldedHeight, plainSummary } = await import("../src/views/live.ts");
  assert.equal(plainSummary("I rewrote isValidMaxHeap in [task1.cpp](task1.cpp#L115) with **care** and `code`."), "I rewrote isValidMaxHeap in task1.cpp with care and code.");
  assert.ok(foldedHeight(60) > foldedHeight(20), "a longer summary gets more room");
  assert.equal(foldedHeight(5000), 252, "never taller than the full view (it scrolls)");
});

test("Claude's plan numbers are asked for again only once they are 10 minutes old", async () => {
  const { claudeIsStale, CLAUDE_STALE_MS } = await import("../src/core/plan.ts");
  const now = 1_800_000_000_000;
  assert.equal(claudeIsStale(null, now), true, "none yet");
  assert.equal(claudeIsStale({ updatedAt: now - 60_000 }, now), false);
  assert.equal(claudeIsStale({ updatedAt: now - CLAUDE_STALE_MS }, now), true);
});
