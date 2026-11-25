// JARVIS (#92): what his voice knows of the island, and what it may do there. The
// island keeps the reminders, the notes and what you add to the calendar in its own
// storage, out of the voice's reach: a short summary of them (and of today's calendar)
// goes to JARVIS whenever they change, so asked "what's on my reminders?" he answers
// from it. His answer can carry an island block (window kind "island", window_prompt.txt):
// the island opens on that tab, with the reminders or notes he added or ticked off.

import { Bridge, onEvent } from "../core/bridge";
import { eventsBetween, type CalEvent } from "../core/ics";
import { Pocket, NOTES_KEY, REMINDERS_KEY, newId, noteTitle, save, type Note, type Reminder } from "../core/pocket";
import type { IslandViewName } from "../core/layout";
import { myEvents } from "../views/gcal";

const TABS: Record<string, IslandViewName> = { reminders: "reminders", notes: "notes", calendar: "calendar" };

const day0 = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Today's events from your Google Calendar, asked again at most every ten minutes. */
let gcal: { at: number; events: CalEvent[] } = { at: 0, events: [] };
async function calendarToday(): Promise<string[]> {
  const today = day0(), tomorrow = new Date(today.getTime() + 86_400_000);
  if (Date.now() - gcal.at > 600_000) {
    gcal.at = Date.now();
    try {
      if (await Bridge.gcalConnected()) {
        const text = await Bridge.gcalFetch();
        gcal.events = eventsBetween(text, today, tomorrow);
      }
    } catch { /* offline: what we had */ }
  }
  const out: { at: number; line: string }[] = gcal.events
    .filter((e) => e.start < tomorrow && (e.end > today || e.allDay))
    .map((e) => ({ at: e.allDay ? 0 : e.start.getTime(), line: `${e.allDay ? "all day" : hhmm(e.start)} ${e.title}` }));
  for (const e of myEvents()) {
    const start = new Date(e.start);
    if (day0(start).getTime() === today.getTime()) out.push({ at: start.getTime(), line: `${e.time ?? "all day"} ${e.title}` });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.line).slice(0, 12);
}

/** The summary JARVIS gets: plain words, kept short. */
async function summary(): Promise<string> {
  const open = Pocket.reminders().filter((r) => !r.done);
  const done = Pocket.reminders().length - open.length;
  const notes = Pocket.notes().slice(0, 8);
  const today = await calendarToday();
  const parts = [
    `Reminders (${open.length} open${done ? `, ${done} done` : ""}): ${open.slice(0, 15).map((r) => `"${r.text}"`).join(", ") || "none"}.`,
    `Notes (${Pocket.notes().length}): ${notes.map((n) => `"${noteTitle(n)}"`).join(", ") || "none"}.`,
    `Calendar today: ${today.join("; ") || "nothing"}.`,
  ];
  return parts.join(" ");
}

let pushT = 0;
function push() {
  window.clearTimeout(pushT);
  pushT = window.setTimeout(() => void summary().then((s) => Bridge.pocketSnapshot(s)), 300);
}

/** Sends the summary now, whenever the reminders or notes change, and every five minutes (the calendar). */
export function startPocketSync(open: (view: IslandViewName) => void) {
  push();
  addEventListener("jarvis-pocket", push);
  addEventListener("storage", push);
  window.setInterval(push, 300_000);
  // His answer's island block: added, ticked off, then shown.
  void onEvent<Record<string, unknown>>("voice-island", (w) => {
    const list = (k: string) => (Array.isArray(w[k]) ? (w[k] as unknown[]).map(String).map((x) => x.trim()).filter(Boolean) : []);
    const add = list("add_reminders"), tick = list("done_reminders").map((x) => x.toLowerCase()), notes = list("add_notes");
    if (add.length || tick.length) {
      let all: Reminder[] = Pocket.reminders();
      if (tick.length) all = all.map((r) => (tick.some((x) => r.text.toLowerCase().includes(x) || x.includes(r.text.toLowerCase())) ? { ...r, done: true } : r));
      all = [...add.map((text) => ({ id: newId(), text, done: false, at: Date.now() })), ...all];
      save(REMINDERS_KEY, all);
    }
    if (notes.length) save<Note>(NOTES_KEY, [...notes.map((text) => ({ id: newId(), text, at: Date.now() })), ...Pocket.notes()]);
    const tab = TABS[String(w.tab ?? "")] ?? (notes.length ? "notes" : add.length || tick.length ? "reminders" : undefined);
    if (tab) open(tab);
  });
}
