import test from "node:test";
import assert from "node:assert/strict";
import { chipSize, cloudOrder, countIn, parsePair } from "../src/hub/pages/walls.ts";

test("a word is counted in the dictations that hold it, as a whole word, any case", () => {
  const texts = ["Ask Claude to review", "claude, open the PR", "the cloud is down", "Claudette called"];
  assert.equal(countIn(texts, "Claude"), 2);
  assert.equal(countIn(texts, "n8n"), 0);
  assert.equal(countIn(["the n8n flow"], "n8n"), 1);
  assert.equal(countIn(["c++ is fun"], "c++"), 1);
  assert.equal(countIn(texts, "  "), 0);
});

test("the most said chip sits in the middle, the others alternate out", () => {
  const order = cloudOrder([5, 1, 9, 3, 7]);
  assert.equal(order[Math.floor(order.length / 2)], 2);
  assert.equal(order.length, 5);
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4]);
});

test("chips grow with how often they are said", () => {
  assert.equal(chipSize(0, 10), 14);
  assert.equal(chipSize(10, 10), 34);
  assert.ok(chipSize(3, 10) > 14 && chipSize(3, 10) < 34);
  assert.equal(chipSize(0, 0), 14);
});

test("“heard → written” adds a replacement; anything else is a word", () => {
  assert.deepEqual(parsePair("cloud code → Claude Code"), { from: "cloud code", to: "Claude Code" });
  assert.deepEqual(parsePair("torii -> Tauri"), { from: "torii", to: "Tauri" });
  assert.equal(parsePair("Supabase"), null);
  assert.equal(parsePair("→ x"), null);
});
