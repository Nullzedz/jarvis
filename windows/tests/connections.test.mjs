import test from "node:test";
import assert from "node:assert/strict";
import { roomOf, summary, tileLine } from "../src/hub/pages/connections.ts";

const tile = (o) => ({ id: "integration_github", name: "GitHub", color: "#000", on: true, live: true, headline: null, ...o });

test("services sit in the demo's rooms", () => {
  assert.equal(roomOf("integration_github"), "code");
  assert.equal(roomOf("integration_n8n"), "code");
  assert.equal(roomOf("integration_stripe"), "money");
  assert.equal(roomOf("integration_resend"), "money");
  assert.equal(roomOf("integration_spotify"), "life");
  assert.equal(roomOf("integration_whatsapp"), "life");
});

test("a tile says its headline, or what it needs", () => {
  assert.deepEqual(tileLine(tile({ headline: "1.2k Total stars" })), ["1.2k Total stars", false]);
  assert.deepEqual(tileLine(tile({})), ["Connected", false]);
  assert.deepEqual(tileLine(tile({ live: false })), ["Needs a key", true]);
  assert.deepEqual(tileLine(tile({ on: false })), ["Off · turn on", true]);
});

test("the summary counts live, needing you and off", () => {
  assert.equal(summary([tile({}), tile({}), tile({ live: false }), tile({ on: false })]), "2 live · 1 needs you · 1 off");
  assert.equal(summary([tile({})]), "1 live");
});
