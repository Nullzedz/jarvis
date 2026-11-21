import test from "node:test";
import assert from "node:assert/strict";
import { nextUp, untilText } from "../src/core/nextup.ts";

const now = new Date(2026, 10, 21, 20, 20);
const ev = (title, start, allDay = false) => ({ id: title, title, location: "", start, end: start, allDay });

test("next up is the soonest event not yet started, Google's or yours, all-day ones left out", () => {
  const google = [
    ev("Past", new Date(2026, 10, 21, 19, 0)),
    ev("Holiday", new Date(2026, 10, 22), true),
    ev("Design review", new Date(2026, 10, 21, 21, 0)),
  ];
  const mine = [{ id: "a", title: "Lunch", start: new Date(2026, 10, 22).getTime(), time: "13:00" }];
  assert.equal(nextUp(google, mine, now).title, "Design review");
  assert.equal(nextUp([], mine, now).title, "Lunch");
  assert.equal(nextUp([], mine, now).at.getHours(), 13);
});

test("your own events without a time don't count, and nothing ahead gives null", () => {
  const mine = [{ id: "a", title: "Someday", start: new Date(2026, 10, 22).getTime(), time: null }];
  assert.equal(nextUp([ev("Past", new Date(2026, 10, 21, 8))], mine, now), null);
});

test("how long until: minutes, hours today, else the day", () => {
  assert.equal(untilText(new Date(2026, 10, 21, 21, 0), now), "in 40 min");
  assert.equal(untilText(new Date(2026, 10, 21, 23, 0), now), "in 3 h");
  assert.match(untilText(new Date(2026, 10, 23, 9, 0), now), /Mon/);
});
