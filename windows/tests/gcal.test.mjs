import test from "node:test";
import assert from "node:assert/strict";
import { eventsOn, layoutDay, nextEvent, parseQuickAdd, startOfWeek, toneOf } from "../src/views/gcal.ts";

const ev = (title, start, end, allDay = false) => ({ id: title, title, location: "", start, end, allDay });
const day = new Date(2026, 10, 19);
const at = (h, m = 0, d = 19) => new Date(2026, 10, d, h, m);

test("the day's events include all-day ones and those crossing midnight", () => {
  const events = [
    ev("Holiday", new Date(2026, 10, 19), new Date(2026, 10, 20), true),
    ev("Late", at(23, 0, 18), at(1, 0, 19)),
    ev("Tomorrow", at(9, 0, 20), at(10, 0, 20)),
  ];
  assert.deepEqual(eventsOn(events, day).map((e) => e.title), ["Holiday", "Late"]);
});

test("the timeline spans 8–18 at least, widens to fit, and stacks overlaps in lanes", () => {
  const events = [ev("Standup", at(8, 30), at(9, 15)), ev("Sync", at(14), at(15))];
  const a = layoutDay(events, day);
  assert.equal(a.fromHour, 8);
  assert.equal(a.toHour, 18);
  assert.equal(a.lanes, 1);
  assert.equal(a.blocks[0].left, 0.5 / 10);
  assert.equal(a.blocks[1].width, 1 / 10);

  const b = layoutDay([ev("Early", at(6), at(7)), ev("A", at(10), at(12)), ev("B", at(11), at(13)), ev("Late", at(20), at(21))], day);
  assert.equal(b.fromHour, 6);
  assert.equal(b.toHour, 21);
  assert.equal(b.lanes, 2);
  assert.deepEqual(b.blocks.map((x) => x.lane), [0, 0, 1, 0]);
});

test("next event, Monday weeks, and tones", () => {
  const events = [ev("Past", at(8), at(9)), ev("Gym", at(18), at(19))];
  assert.equal(nextEvent(events, at(12)).title, "Gym");
  assert.equal(nextEvent(events, at(20)), null);
  assert.equal(startOfWeek(day).getDay(), 1);
  assert.equal(startOfWeek(new Date(2026, 10, 22)).getDate(), 16);
  assert.equal(toneOf("Team sync"), "blue");
  assert.equal(toneOf("Gym"), "teal");
  assert.equal(toneOf("Dentist"), "amber");
  assert.equal(toneOf("Birthday party"), "purple");
});

// ── Today's quick add, "type like you talk" (the notch prototype) ──
const FRIDAY = new Date(2026, 10, 20, 15, 0); // 20 November 2026 is a Friday

test("quick add: a day, a time and what it is", () => {
  assert.deepEqual(parseQuickAdd("lunch with Maya tomorrow 1pm", FRIDAY), { kind: "calendar", title: "Lunch with Maya", day: 1, time: "13:00" });
  assert.deepEqual(parseQuickAdd("Sprint planning tuesday 10:30", FRIDAY), { kind: "calendar", title: "Sprint planning", day: 4, time: "10:30" });
  assert.deepEqual(parseQuickAdd("dentist", FRIDAY), { kind: "calendar", title: "Dentist", day: 0, time: null });
  assert.equal(parseQuickAdd("gym 12am", FRIDAY).time, "00:00");
  assert.equal(parseQuickAdd("standup friday 9am", FRIDAY).day, 0, "today's own weekday is today");
});

test("quick add: buy, call, send and remind are reminders", () => {
  for (const s of ["buy coffee", "call Maya at 5pm", "send the proposal", "remind me to stretch"]) {
    assert.equal(parseQuickAdd(s, FRIDAY).kind, "reminder", s);
  }
  assert.equal(parseQuickAdd("Callisto review", FRIDAY).kind, "calendar", "only the whole word");
});
