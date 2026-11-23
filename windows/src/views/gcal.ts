// JARVIS: the island's Today tab, one to one with the notch prototype's
// (docs/jarvis/design/prototypes/jarvis-notch.html): a Today / Week switch; Today is the strip of
// seven days from today, the plain-language quick add and the day's events; Week is seven
// columns of event pills. Events come from your Google Calendar (read-only, its secret iCal
// address: src-tauri/src/gcal.rs, parsed by core/ics.ts) and from what you add here, kept on
// this PC. Refreshed every five minutes while shown.

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { eventsBetween, type CalEvent } from "../core/ics";
import { dayKey } from "../core/calendar";
import { h, clear } from "./dom";
import { Pocket } from "../core/pocket";
import { language, t } from "../i18n/i18n";
import type { ViewHost } from "./views";

const REFRESH_MS = 5 * 60_000;
const HELP_URL = "https://calendar.google.com/calendar/u/0/r/settings";
const MODE_KEY = "jarvis.calendar.mode";
const DAY_MS = 86_400_000;

export type CalMode = "day" | "week";

export interface GcalHost {
  /** The island takes the keyboard for a text field, and gives it back. */
  keyboard(on: boolean): void;
  /** Something is being typed: the island stays open until it's done. */
  holdOpen(on: boolean): void;
  /** What the tab holds changed: the notch fits it again. */
  resize(): void;
}

type Status =
  | { kind: "loading" }
  | { kind: "disconnected"; error: string | null; busy: boolean }
  | { kind: "ready"; events: CalEvent[]; at: number }
  | { kind: "error"; message: string };

// ── Pure helpers (tested in tests/gcal.test.mjs) ─────────────────────────────

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday of `d`'s week. */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** Events touching the local day `day` (all-day ones included). */
export function eventsOn(events: CalEvent[], day: Date): CalEvent[] {
  const from = startOfDay(day).getTime();
  const to = from + DAY_MS;
  return events.filter((e) => e.start.getTime() < to && (e.end.getTime() > from || (e.allDay && dayKey(e.start) === dayKey(day))));
}

/** A soft colour per kind of event, guessed from its title. */
export type Tone = "blue" | "teal" | "amber" | "purple";
export function toneOf(title: string): Tone {
  const s = title.toLowerCase();
  if (/(gym|run|workout|sport|yoga|lunch|dinner|breakfast|walk|break|swim)/.test(s)) return "teal";
  if (/(dentist|doctor|appointment|clinic|hospital|deadline|due|exam|bill|pay)/.test(s)) return "amber";
  if (/(meet|sync|call|standup|stand-up|review|1:1|interview|zoom|teams)/.test(s)) return "blue";
  return "purple";
}

export interface DayBlock {
  event: CalEvent;
  /** 0…1 along the day's visible range. */
  left: number;
  width: number;
  /** Row (lane) for overlapping events. */
  lane: number;
}

/**
 * The timed events of `day` laid out on a track from `fromHour` to `toHour`:
 * the range widens to fit the events (8:00–18:00 at least), overlaps go to
 * the next lane.
 */
export function layoutDay(events: CalEvent[], day: Date): { blocks: DayBlock[]; lanes: number; fromHour: number; toHour: number } {
  const timed = eventsOn(events, day).filter((e) => !e.allDay);
  const base = startOfDay(day).getTime();
  const hourOf = (d: Date) => Math.min(24, Math.max(0, (d.getTime() - base) / 3_600_000));
  let fromHour = 8;
  let toHour = 18;
  for (const e of timed) {
    fromHour = Math.min(fromHour, Math.floor(hourOf(e.start)));
    toHour = Math.max(toHour, Math.ceil(hourOf(e.end)));
  }
  const span = Math.max(1, toHour - fromHour);
  const laneEnds: number[] = [];
  const blocks: DayBlock[] = [];
  for (const e of [...timed].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const s = hourOf(e.start);
    const en = Math.max(hourOf(e.end), s + 0.25); // a 0-minute event still shows
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(en);
    } else laneEnds[lane] = en;
    blocks.push({ event: e, left: (s - fromHour) / span, width: (en - s) / span, lane });
  }
  return { blocks, lanes: Math.max(1, laneEnds.length), fromHour, toHour };
}

/** The next timed event still to start, from `now`. */
export function nextEvent(events: CalEvent[], now: Date): CalEvent | null {
  return events.find((e) => !e.allDay && e.start > now) ?? null;
}

// ── Quick add (pure, tested in tests/gcal.test.mjs) ──────────────────────────

export interface QuickAdd {
  kind: "calendar" | "reminder";
  title: string;
  /** Days from today. */
  day: number;
  /** "13:00", or null when no time was said. */
  time: string | null;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "Type like you talk", as the prototype reads it: "lunch with Maya tomorrow 1pm". */
export function parseQuickAdd(text: string, today: Date): QuickAdd {
  const lower = text.toLowerCase();
  const kind = /\b(remind|buy|call|send)\b/.test(lower) ? "reminder" : "calendar";
  let day = 0;
  if (/\btomorrow\b/.test(lower)) day = 1;
  else {
    const named = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}`).test(lower));
    if (named >= 0) day = (named - today.getDay() + 7) % 7;
  }
  let time: string | null = null;
  const m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    let hr = Number(m[1] ?? m[4]);
    const min = m[2] ?? m[5] ?? "00";
    if (m[3] === "pm" && hr < 12) hr += 12;
    if (m[3] === "am" && hr === 12) hr = 0;
    if (hr < 24) time = `${String(hr).padStart(2, "0")}:${min}`;
  }
  const title = text
    .replace(/\b(tomorrow|today|at|on)\b/gi, "")
    .replace(new RegExp(`\\b(${WEEKDAYS.join("|")})[a-z]*\\b`, "gi"), "")
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { kind, title: title.charAt(0).toUpperCase() + title.slice(1), day, time };
}

// ── View ──────────────────────────────────────────────────────────────────────

const timeText = (d: Date) => d.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });

/** The colour of an event's dot or pill: the prototype's system colours. */
const TONE: Record<Tone, string> = { blue: "#0a84ff", teal: "#30d158", amber: "#ff9f0a", purple: "#bf5af2" };
const MINE = "#64d2ff"; // what you add here (the prototype's quick-add colour)

export interface MyEvent { id: string; title: string; start: number; time: string | null }
const MINE_KEY = "jarvis.events";
export function myEvents(): MyEvent[] {
  try {
    const v = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveMine(v: MyEvent[]) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(v)); } catch { /* not remembered */ }
}

function readMode(): CalMode {
  try {
    return localStorage.getItem(MODE_KEY) === "week" ? "week" : "day";
  } catch {
    return "day";
  }
}

function saveMode(mode: CalMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* a private profile: the switch simply isn't remembered */
  }
}

interface Row { title: string; time: string; color: string; sort: number }

export function buildCalendar(host: GcalHost): ViewHost {
  const el = h("div", { class: "view pk td" });
  let status: Status = { kind: "loading" };
  let mode: CalMode = readMode();
  /** The chosen day in the strip: days from today. */
  let chosen = 0;
  let timer: number | null = null;
  let token = 0;
  let renderedKey = "";

  // The quick add lives across redraws, so what you're typing is never lost.
  const qa = h("input", { class: "td-qa-in", placeholder: t("Type like you talk: lunch with Maya tomorrow 1pm"), spellcheck: "false" }) as HTMLInputElement;
  const kindTag = h("em", { class: "td-kind", text: t("Calendar") });
  const qaRow = h("label", { class: "pk-add td-qa" }, h("span", { class: "pk-spark", text: "✦" }), qa, kindTag);
  qa.addEventListener("focus", () => host.keyboard(true));
  qa.addEventListener("blur", () => { host.keyboard(false); host.holdOpen(false); });
  qa.addEventListener("input", () => {
    const v = qa.value;
    host.holdOpen(v.trim() !== "");
    kindTag.textContent = parseQuickAdd(v, new Date()).kind === "reminder" ? t("Reminder") : t("Calendar");
    kindTag.classList.toggle("on", v.trim().length > 3);
  });
  qa.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Enter" || !qa.value.trim()) return;
    const q = parseQuickAdd(qa.value.trim(), new Date());
    if (q.kind === "reminder") {
      Pocket.addReminder(q.title);
    } else {
      const day = addDays(startOfDay(new Date()), q.day);
      saveMine([...myEvents(), { id: Date.now().toString(36), title: q.title, start: day.getTime(), time: q.time }]);
      chosen = q.day < 7 ? q.day : chosen;
    }
    qa.value = "";
    kindTag.classList.remove("on");
    host.holdOpen(false);
    render(true);
  });

  async function load() {
    const tok = ++token;
    const connected = await Bridge.gcalConnected();
    if (tok !== token) return;
    if (!connected) {
      status = { kind: "disconnected", error: null, busy: false };
      render(true);
      return;
    }
    try {
      const text = await Bridge.gcalFetch();
      if (tok !== token) return;
      const today = startOfDay(new Date());
      status = { kind: "ready", events: eventsBetween(text, addDays(today, -7), addDays(today, 14)), at: Date.now() };
    } catch (err) {
      if (tok !== token) return;
      status = { kind: "error", message: String(err) };
    }
    render(true);
  }

  async function connect(url: string) {
    if (!url.trim()) return;
    status = { kind: "disconnected", error: null, busy: true };
    render(true);
    try {
      await Bridge.gcalConnect(url);
      host.keyboard(false);
      status = { kind: "loading" };
      render(true);
      await load();
    } catch (err) {
      status = { kind: "disconnected", error: String(err), busy: false };
      render(true);
    }
  }

  function setMode(next: CalMode) {
    if (next === mode) return;
    mode = next;
    saveMode(mode);
    render(true);
  }

  /** Everything on a day: Google's events and yours, by time. */
  function rowsOn(day: Date): Row[] {
    const google = status.kind === "ready" ? eventsOn(status.events, day) : [];
    const rows: Row[] = google.map((e) => ({
      title: e.title,
      time: e.allDay ? t("All day") : timeText(e.start),
      color: TONE[toneOf(e.title)],
      sort: e.allDay ? -1 : e.start.getTime(),
    }));
    const key = dayKey(day);
    for (const m of myEvents()) {
      if (dayKey(new Date(m.start)) !== key) continue;
      const [hh, mm] = (m.time ?? "0:0").split(":").map(Number);
      rows.push({ title: m.title, time: m.time ?? "—", color: MINE, sort: m.time ? day.getTime() + (hh * 60 + mm) * 60_000 : Infinity });
    }
    return rows.sort((a, b) => a.sort - b.sort);
  }

  // ── Pieces, as the prototype draws them ──

  function switcher(): HTMLElement {
    const btn = (m: CalMode, label: string) =>
      h("button", { class: mode === m ? "on" : "", text: label, onclick: () => setMode(m) });
    return h("div", { class: "td-top" }, h("span", { class: "td-src" }, btn("day", t("Today")), btn("week", t("Week"))));
  }

  function dayView(now: Date): Node[] {
    const today = startOfDay(now);
    const days = h("div", { class: "td-days" });
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      days.append(h("button", { class: i === chosen ? "td-day on" : "td-day", onclick: () => { chosen = i; render(true); } },
        document.createTextNode(d.toLocaleDateString(language(), { weekday: "short" })),
        h("b", { text: String(d.getDate()) })));
    }
    const list = h("div", { class: "td-events" });
    const rows = rowsOn(addDays(today, chosen));
    if (rows.length === 0) list.append(h("p", { class: "td-none", text: status.kind === "loading" ? t("Reading your calendar…") : t("Nothing planned.") }));
    for (const r of rows) {
      const dot = h("i");
      dot.style.background = r.color;
      list.append(h("div", { class: "td-ev" }, dot, document.createTextNode(r.title), h("span", { text: r.time })));
    }
    return [days, qaRow, list];
  }

  function weekView(now: Date): Node[] {
    const today = startOfDay(now);
    const grid = h("div", { class: "td-wk" });
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      const col = h("div", { class: i === 0 ? "today" : "" },
        h("b", { text: `${d.toLocaleDateString(language(), { weekday: "short" })} ${d.getDate()}` }));
      for (const r of rowsOn(d).slice(0, 4)) {
        const pill = h("p", { class: "e", text: `${r.time === "—" ? "" : `${r.time} `}${r.title}` });
        pill.style.background = r.color;
        col.append(pill);
      }
      grid.append(col);
    }
    return [grid];
  }

  /** Not connected: a quiet line under your own events, to link Google Calendar. */
  function connectRow(s: Extract<Status, { kind: "disconnected" }>): Node[] {
    const field = h("input", { class: "td-link", placeholder: t("Paste your secret iCal address"), spellcheck: "false" }) as HTMLInputElement;
    field.addEventListener("focus", () => host.keyboard(true));
    field.addEventListener("blur", () => host.keyboard(false));
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") void connect(field.value);
      ev.stopPropagation();
    });
    const nodes: Node[] = [h("div", { class: "td-connect" },
      h("span", { class: "td-cap", text: "Google Calendar" }),
      field,
      h("button", { class: "td-btn", text: s.busy ? t("Checking…") : t("Connect"), onclick: () => void connect(field.value) }),
      h("button", { class: "td-help", text: t("Where is it?"), onclick: () => void Bridge.openUrl(HELP_URL) }),
    )];
    if (s.error) nodes.push(h("p", { class: "td-error", text: s.error }));
    return nodes;
  }

  function render(force = false) {
    const now = new Date();
    const key = JSON.stringify([status.kind, status.kind === "ready" ? status.at : 0, mode, chosen, now.getMinutes(), now.getDate()]);
    if (!force && key === renderedKey) return;
    renderedKey = key;
    const typing = document.activeElement === qa;
    clear(el);
    el.append(switcher(), ...(mode === "day" ? dayView(now) : weekView(now)));
    if (status.kind === "disconnected") el.append(...connectRow(status));
    if (status.kind === "error") {
      el.append(h("p", { class: "td-error", text: status.message }),
        h("div", { class: "td-connect" }, h("button", { class: "td-btn", text: t("Retry"), onclick: () => void load() })));
    }
    if (typing) qa.focus();
    host.resize();
  }

  function startTimer() {
    if (timer != null) return;
    timer = window.setInterval(() => void load(), REFRESH_MS);
  }
  function stopTimer() {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  }

  render(true);
  let loaded = false;

  return {
    el,
    sync() {
      if (State.mode === "expanded" && State.view === "calendar") {
        startTimer();
        if (!loaded || (status.kind === "ready" && Date.now() - status.at > REFRESH_MS)) {
          loaded = true;
          void load();
        }
        render();
      } else {
        stopTimer();
      }
    },
    focus: () => qa.focus(),
    fitHeight: () => {
      const last = el.lastElementChild as HTMLElement | null;
      return last ? last.offsetTop + last.offsetHeight + 12 : 0;
    },
  };
}
