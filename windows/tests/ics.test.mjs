import test from "node:test";
import assert from "node:assert/strict";
import { eventsBetween, parseIcsDate } from "../src/core/ics.ts";

const cal = (...events) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

const from = new Date(2026, 10, 1);
const to = new Date(2026, 11, 31, 23, 59);

test("dates: all-day, local and UTC", () => {
  assert.deepEqual(parseIcsDate("20261119"), { date: new Date(2026, 10, 19), allDay: true });
  assert.deepEqual(parseIcsDate("20261119T090000"), { date: new Date(2026, 10, 19, 9), allDay: false });
  assert.equal(parseIcsDate("20261119T090000Z").date.getTime(), Date.UTC(2026, 10, 19, 9));
  assert.equal(parseIcsDate("nonsense"), null);
});

test("a single event, with folded lines and escaped text", () => {
  const text = cal([
    "UID:a",
    "DTSTART;TZID=Europe/Brussels:20261119T140000",
    "DTEND;TZID=Europe/Brussels:20261119T150000",
    "SUMMARY:Dentist\\, then",
    "  lunch",
    "LOCATION:Main St\\; 2nd floor",
  ]);
  const [e] = eventsBetween(text, from, to);
  assert.equal(e.title, "Dentist, then lunch");
  assert.equal(e.location, "Main St; 2nd floor");
  assert.deepEqual(e.start, new Date(2026, 10, 19, 14));
  assert.deepEqual(e.end, new Date(2026, 10, 19, 15));
  assert.equal(e.allDay, false);
});

test("an all-day event and events outside the window", () => {
  const text = cal(
    ["UID:b", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261121", "SUMMARY:Holiday"],
    ["UID:old", "DTSTART:20250101T100000", "DTEND:20250101T110000", "SUMMARY:Old"],
  );
  const events = eventsBetween(text, from, to);
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].title, "Holiday");
});

test("weekly rule with BYDAY, COUNT, an EXDATE and a moved instance", () => {
  const text = cal(
    [
      "UID:gym",
      "DTSTART:20261102T180000",
      "DTEND:20261102T190000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6",
      "EXDATE:20261104T180000",
      "SUMMARY:Gym",
    ],
    ["UID:gym", "RECURRENCE-ID:20261109T180000", "DTSTART:20261109T200000", "DTEND:20261109T210000", "SUMMARY:Gym (late)"],
  );
  const events = eventsBetween(text, from, to);
  assert.deepEqual(
    events.map((e) => [e.start.getDate(), e.start.getHours(), e.title]),
    [[2, 18, "Gym"], [9, 20, "Gym (late)"], [11, 18, "Gym"], [16, 18, "Gym"], [18, 18, "Gym"]],
  );
});

test("monthly on the last Friday, daily with UNTIL, yearly birthdays", () => {
  const text = cal(
    ["UID:m", "DTSTART:20261030T090000", "DTEND:20261030T093000", "RRULE:FREQ=MONTHLY;BYDAY=-1FR", "SUMMARY:Review"],
    ["UID:d", "DTSTART:20261129T070000", "DTEND:20261129T071500", "RRULE:FREQ=DAILY;UNTIL=20261201T235959", "SUMMARY:Stretch"],
    ["UID:y", "DTSTART;VALUE=DATE:19950312", "RRULE:FREQ=YEARLY", "SUMMARY:Birthday"],
  );
  const events = eventsBetween(text, from, to);
  const review = events.filter((e) => e.title === "Review").map((e) => e.start.getDate());
  assert.deepEqual(review, [27, 25]);
  assert.equal(events.filter((e) => e.title === "Stretch").length, 3);
  assert.equal(events.filter((e) => e.title === "Birthday").length, 0);
});

test("a cancelled event does not show", () => {
  const text = cal(["UID:c", "DTSTART:20261119T100000", "DTEND:20261119T110000", "STATUS:CANCELLED", "SUMMARY:Off"]);
  assert.equal(eventsBetween(text, from, to).length, 0);
});
