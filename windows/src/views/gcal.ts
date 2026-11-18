// JARVIS: the calendar tab of the island. Read-only Google Calendar, from the
// calendar's secret iCal address (src-tauri/src/gcal.rs, parsed by core/ics.ts).
//
// Two views, switched with a toggle that is remembered:
// - Today: the day as a horizontal timeline, events at their real time, a "now" line.
// - Week: seven columns with the events as pills, today outlined.
// Not connected: a field to paste the link. Refreshed every five minutes while shown.

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { eventsBetween, type CalEvent } from "../core/ics";
import { dayKey } from "../core/calendar";
import { h, clear } from "./dom";
import { language, t, tn } from "../i18n/i18n";
import type { ViewHost } from "./views";

const REFRESH_MS = 5 * 60_000;
const HELP_URL = "https://calendar.google.com/calendar/u/0/r/settings";
const MODE_KEY = "jarvis.calendar.mode";
const DAY_MS = 86_400_000;

export type CalMode = "day" | "week";

export interface GcalHost {
  /** The island takes the keyboard for the link field, and gives it back. */
  keyboard(on: boolean): void;
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

// ── View ──────────────────────────────────────────────────────────────────────

const timeText = (d: Date) => d.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });

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
    /* a private profile: the toggle simply isn't remembered */
  }
}

export function buildCalendar(host: GcalHost): ViewHost {
  const el = h("div", { class: "view gcal" });
  let status: Status = { kind: "loading" };
  let mode: CalMode = readMode();
  /** Days (day mode) or weeks (week mode) away from today. */
  let offset = 0;
  let timer: number | null = null;
  let token = 0;
  let renderedKey = "";

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
      // Two months back and three ahead: the arrows stay instant.
      status = { kind: "ready", events: eventsBetween(text, addDays(today, -62), addDays(today, 93)), at: Date.now() };
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

  async function disconnect() {
    await Bridge.gcalDisconnect();
    status = { kind: "disconnected", error: null, busy: false };
    render(true);
  }

  function setMode(next: CalMode) {
    if (next === mode) return;
    mode = next;
    offset = 0;
    saveMode(mode);
    render(true);
  }

  function move(step: number) {
    offset = step === 0 ? 0 : offset + step;
    render(true);
  }

  // ── Pieces ──

  function toggle(): HTMLElement {
    const btn = (m: CalMode, label: string) =>
      h("button", { class: mode === m ? "gcal-seg on" : "gcal-seg", text: label, onclick: () => setMode(m) });
    return h("div", { class: "gcal-toggle" }, btn("day", t("Today")), btn("week", t("Week")));
  }

  function nav(): HTMLElement {
    return h("div", { class: "gcal-nav" },
      h("button", { class: "gcal-arrow", text: "‹", title: t("Back"), onclick: () => move(-1) }),
      h("button", { class: offset === 0 ? "gcal-today on" : "gcal-today", text: t("Today"), onclick: () => move(0) }),
      h("button", { class: "gcal-arrow", text: "›", title: t("Next"), onclick: () => move(1) }),
    );
  }

  function topRow(title: string, sub: string): HTMLElement {
    return h("div", { class: "gcal-top" },
      h("div", { class: "gcal-heading" }, h("b", { text: title }), h("span", { text: sub })),
      toggle(),
      nav(),
    );
  }

  function dayView(events: CalEvent[], now: Date): Node[] {
    const day = addDays(startOfDay(now), offset);
    const isToday = offset === 0;
    const onDay = eventsOn(events, day);
    const title = day.toLocaleDateString(language(), { weekday: "long", day: "numeric", month: "short" });
    const sub = tn("{count} event", "{count} events", onDay.length);
    const { blocks, lanes, fromHour, toHour } = layoutDay(events, day);
    const span = toHour - fromHour;

    const track = h("div", { class: "gcal-track" });
    for (let hr = fromHour + 1; hr < toHour; hr++) {
      const line = h("div", { class: "gcal-hourline" });
      line.style.left = `${((hr - fromHour) / span) * 100}%`;
      track.append(line);
    }
    const laneH = 100 / lanes;
    for (const b of blocks) {
      const block = h("div", { class: `gcal-block tone-${toneOf(b.event.title)}` },
        h("span", { class: "gcal-block-title", text: b.event.title }),
        h("span", { class: "gcal-block-time", text: timeText(b.event.start) }),
      );
      block.style.left = `calc(${b.left * 100}% + 2px)`;
      block.style.width = `calc(${b.width * 100}% - 4px)`;
      block.style.top = `calc(${b.lane * laneH}% + 4px)`;
      block.style.height = `calc(${laneH}% - 8px)`;
      if (isToday && b.event.start <= now && b.event.end > now) block.classList.add("live");
      block.title = `${b.event.title}\n${timeText(b.event.start)} – ${timeText(b.event.end)}${b.event.location ? `\n${b.event.location}` : ""}`;
      track.append(block);
    }
    if (isToday) {
      const hours = (now.getTime() - startOfDay(now).getTime()) / 3_600_000;
      if (hours >= fromHour && hours <= toHour) {
        const nowLine = h("div", { class: "gcal-now" });
        nowLine.style.left = `${((hours - fromHour) / span) * 100}%`;
        track.append(nowLine);
      }
    }
    if (!blocks.length) track.append(h("div", { class: "gcal-empty", text: t("Nothing planned.") }));

    const scale = h("div", { class: "gcal-scale" });
    for (let hr = fromHour; hr <= toHour; hr += span > 12 ? 2 : 1) {
      const tick = h("span", { text: String(hr % 24) });
      tick.style.left = `${((hr - fromHour) / span) * 100}%`;
      scale.append(tick);
    }

    const footer = h("div", { class: "gcal-foot" });
    const allDay = onDay.filter((e) => e.allDay);
    for (const e of allDay.slice(0, 2)) footer.append(h("span", { class: `gcal-chip tone-${toneOf(e.title)}`, text: e.title }));
    if (isToday) {
      const next = nextEvent(onDay, now);
      if (next) {
        const mins = Math.round((next.start.getTime() - now.getTime()) / 60_000);
        const when = mins < 60 ? t("in {n} min", { n: mins }) : timeText(next.start);
        footer.append(h("span", { class: "gcal-next", text: t("Next: {title}, {when}", { title: next.title, when }) }));
      }
    }
    return [topRow(title, sub), track, scale, footer];
  }

  function weekView(events: CalEvent[], now: Date): Node[] {
    const monday = addDays(startOfWeek(now), offset * 7);
    const sunday = addDays(monday, 6);
    const fmt = (d: Date) => d.toLocaleDateString(language(), { day: "numeric", month: "short" });
    const grid = h("div", { class: "gcal-weekgrid" });
    for (let i = 0; i < 7; i++) {
      const day = addDays(monday, i);
      const isToday = dayKey(day) === dayKey(now);
      const col = h("div", { class: isToday ? "gcal-col today" : "gcal-col" },
        h("div", { class: "gcal-col-head" },
          h("span", { text: isToday ? t("Today") : day.toLocaleDateString(language(), { weekday: "short" }) }),
          h("b", { text: String(day.getDate()) }),
        ),
      );
      const list = eventsOn(events, day);
      const shown = list.slice(0, 4);
      let nowPlaced = !isToday;
      for (const e of shown) {
        if (!nowPlaced && !e.allDay && e.start > now) {
          col.append(h("div", { class: "gcal-col-now" }));
          nowPlaced = true;
        }
        const pill = h("div", { class: `gcal-pill tone-${toneOf(e.title)}` },
          h("span", { class: "gcal-pill-time", text: e.allDay ? "•" : timeText(e.start) }),
          h("span", { class: "gcal-pill-title", text: e.title }),
        );
        pill.title = `${e.title}\n${e.allDay ? t("All day") : `${timeText(e.start)} – ${timeText(e.end)}`}${e.location ? `\n${e.location}` : ""}`;
        col.append(pill);
      }
      if (!nowPlaced && shown.length) col.append(h("div", { class: "gcal-col-now" }));
      if (list.length > shown.length) col.append(h("div", { class: "gcal-more", text: t("+{count} more", { count: list.length - shown.length }) }));
      grid.append(col);
    }
    const monthTitle = monday.toLocaleDateString(language(), { month: "long", year: "numeric" });
    return [topRow(monthTitle, `${fmt(monday)} – ${fmt(sunday)}`), grid];
  }

  function connectForm(s: Extract<Status, { kind: "disconnected" }>): Node[] {
    const field = h("input", { class: "gcal-field", placeholder: t("Paste your secret iCal address"), spellcheck: "false" }) as HTMLInputElement;
    field.addEventListener("focus", () => host.keyboard(true));
    field.addEventListener("blur", () => host.keyboard(false));
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") void connect(field.value);
      ev.stopPropagation();
    });
    const nodes: Node[] = [
      h("div", { class: "gcal-heading" }, h("b", { text: t("Calendar") }), h("span", { text: t("Connect your Google Calendar (read-only).") })),
      h("div", { class: "gcal-connect" },
        field,
        h("button", { class: "gcal-btn", text: s.busy ? t("Checking…") : t("Connect"), onclick: () => void connect(field.value) }),
        h("button", { class: "link-btn", text: t("Where is it?"), onclick: () => void Bridge.openUrl(HELP_URL) }),
      ),
    ];
    if (s.error) nodes.push(h("div", { class: "gcal-error", text: s.error }));
    return nodes;
  }

  function render(force = false) {
    const now = new Date();
    const key = JSON.stringify([status.kind, status.kind === "ready" ? status.at : 0, mode, offset, now.getMinutes()]);
    if (!force && key === renderedKey) return;
    renderedKey = key;
    clear(el);
    const body = h("div", { class: "gcal-body" });
    el.append(body);
    switch (status.kind) {
      case "loading":
        body.append(h("div", { class: "gcal-heading" }, h("b", { text: t("Calendar") }), h("span", { text: t("Reading your calendar…") })));
        return;
      case "disconnected":
        body.append(...connectForm(status));
        return;
      case "error":
        body.append(
          h("div", { class: "gcal-heading" }, h("b", { text: t("Calendar") })),
          h("div", { class: "gcal-error", text: status.message }),
          h("div", { class: "gcal-connect" },
            h("button", { class: "gcal-btn", text: t("Retry"), onclick: () => void load() }),
            h("button", { class: "link-btn", text: t("Use another link"), onclick: () => void disconnect() }),
          ),
        );
        return;
      case "ready":
        body.append(...(mode === "day" ? dayView(status.events, now) : weekView(status.events, now)));
    }
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
  };
}
