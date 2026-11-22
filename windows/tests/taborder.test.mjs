import test from "node:test";
import assert from "node:assert/strict";
import { dropIndex, moveItem, orderTabs } from "../src/core/taborder.ts";

const DEF = ["ask", "drop", "launch", "calendar", "widgets", "reminders", "notes", "clipboard", "focus"];

test("your order first; unknown ids dropped; new tabs kept at the end", () => {
  assert.deepEqual(orderTabs(DEF, null), DEF);
  assert.deepEqual(orderTabs(["a", "b", "c"], ["c", "gone", "a", "c"]), ["c", "a", "b"]);
});

test("moving a tab left or right", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 9), ["a", "c", "b"], "clamped");
});

test("a dragged tab lands past the centres it has crossed", () => {
  const others = [16, 52, 88];
  assert.equal(dropIndex(others, 0), 0);
  assert.equal(dropIndex(others, 60), 2);
  assert.equal(dropIndex(others, 200), 3);
});

test("hiding a tab keeps its place; showing it again puts it after the shown ones", async () => {
  const { setShown, shownTabs } = await import("../src/core/taborder.ts");
  const order = ["ask", "drop", "focus", "agents"];
  const hid = setShown(order, [], "drop", false);
  assert.deepEqual(shownTabs(hid.order, hid.hidden), ["ask", "focus", "agents"]);
  const back = setShown(hid.order, hid.hidden, "drop", true);
  assert.deepEqual(back.hidden, []);
  assert.deepEqual(shownTabs(back.order, back.hidden), ["ask", "focus", "agents", "drop"]);
  const twoHidden = setShown(order, ["agents"], "ask", true);
  assert.deepEqual(twoHidden.order, ["drop", "focus", "ask", "agents"], "after the last shown, before the hidden");
});
