// JARVIS: Focus (step 10 of #22), one to one with the notch prototype
// (docs/jarvis/design/prototypes/jarvis-notch.html): the Focus tab (data-pane="focus") picks a
// length and starts; focus mode (#focusMode) is all the notch shows while a session runs: the
// focus bar, the countdown ring and what's next, the music and a few reminders.

import { Focus, FOCUS_LENGTHS, clockText, focusDone, focusLeftMs } from "../core/focus";
import { Pocket, save, REMINDERS_KEY, type Reminder } from "../core/pocket";
import { State } from "../core/state";
import { nextUp } from "../core/nextup";
import type { IslandViewName } from "../core/layout";
import { myEvents } from "./gcal";
import { googleEvents, musicParts } from "./widgets";
import { contentHeight } from "./pocket";
import { h, clear } from "./dom";
import { language, t } from "../i18n/i18n";
import type { ViewHost } from "./views";
import "./pocket.css";

const timeText = (d: Date) => d.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
const RING = 276.5; // 2π × 44, the prototype's ring

export interface FocusHost {
  setView(v: IslandViewName): void;
  blip(): void;
  resize(): void;
  holdOpen(on: boolean): void;
  /** A session started or ended (ended: true when it ran its full length). */
  started(): void;
  ended(done: boolean): void;
}

// ── The Focus tab ─────────────────────────────────────────────────────────────

export function buildFocusTab(host: FocusHost): ViewHost {
  const timer = h("div", { class: "timer" });
  const lengths = h("div", { class: "src" });
  const el = h("div", { class: "view pk fc" },
    h("div", { class: "fc-row" },
      timer,
      h("div", { class: "fc-mid" },
        lengths,
        h("p", { class: "cap", text: t("Hides everything but what's next, your music and a few reminders.") })),
      h("button", { class: "btn bo", text: t("Start focus"), onclick: () => {
        Focus.start(Focus.length);
        host.started();
      } })));

  function paint() {
    timer.textContent = `${Focus.length}:00`;
    clear(lengths);
    for (const n of FOCUS_LENGTHS) {
      lengths.append(h("button", {
        class: n === Focus.length ? "on" : "",
        text: t("{n} min", { n }),
        onclick: () => { Focus.length = n; host.blip(); paint(); },
      }));
    }
  }
  paint();
  return { el, sync: paint, fitHeight: () => contentHeight(el) };
}

// ── Focus mode ────────────────────────────────────────────────────────────────

export function buildFocusMode(host: FocusHost): ViewHost {
  const until = h("span");
  const left = h("div", { class: "fm-left" });
  const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "104");
  svg.setAttribute("height", "104");
  svg.setAttribute("viewBox", "0 0 104 104");
  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [c, stroke] of [[track, "#3a2606"], [arc, "#ff9f0a"]] as const) {
    c.setAttribute("cx", "52"); c.setAttribute("cy", "52"); c.setAttribute("r", "44");
    c.setAttribute("fill", "none"); c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", "9");
  }
  arc.setAttribute("stroke-linecap", "round");
  arc.setAttribute("stroke-dasharray", String(RING));
  arc.setAttribute("transform", "rotate(-90 52 52)");
  svg.append(track, arc);

  const nextTitle = h("p", { class: "fm-next" });
  const nextTime = h("p", { class: "fm-when" });
  const np = h("div", { class: "np" });
  const ctl = h("div", { class: "fm-ctl" });
  const rem = h("div", { class: "w fm-rem" });

  const el = h("div", { class: "view pk fm" },
    h("div", { class: "focusbar" },
      h("span", { class: "dot fm-dot" }),
      h("b", { text: t("Focus") }),
      h("span", { class: "cap fm-until" }, until),
      h("span", { class: "fm-sp" }),
      h("button", { class: "btn bs fm-end", text: t("End"), onclick: () => { Focus.stop(); host.ended(false); } })),
    h("div", { class: "fm-grid" },
      h("div", { class: "fm-lefthalf" },
        h("div", { class: "ring" }, svg, left),
        h("div", {}, h("p", { class: "cap", text: t("Next") }), nextTitle, nextTime)),
      h("div", { class: "fm-right" }, np, ctl, rem)));

  let musicKey = "";
  let remKey = "";
  let holding = false;

  function tick() {
    const f = Focus.get();
    if (!f) return;
    const now = Date.now();
    left.textContent = clockText(focusLeftMs(f, now));
    arc.setAttribute("stroke-dashoffset", (RING * focusDone(f, now)).toFixed(1));
    until.textContent = t("until {time}", { time: timeText(new Date(f.startedAt + f.minutes * 60_000)) });
  }

  function paintNext() {
    const next = nextUp(googleEvents, myEvents(), new Date());
    nextTitle.textContent = next?.title ?? t("Nothing planned.");
    nextTime.textContent = next ? timeText(next.at) : "";
  }

  function paintMusic() {
    const m = musicParts();
    const key = [m.who.textContent, m.ctls.textContent, (m.art as HTMLElement).style.backgroundImage].join("|");
    if (key === musicKey) return;
    musicKey = key;
    clear(np);
    np.append(m.art, m.who, m.src);
    clear(ctl);
    ctl.append(...Array.from(m.ctls.childNodes));
  }

  /** Up to three open reminders, ticked off right here (the prototype's .chk rows). */
  function paintReminders() {
    const all = Pocket.reminders();
    const open = all.filter((r) => !r.done).slice(0, 3);
    const key = JSON.stringify(open.map((r) => r.id));
    if (key === remKey) return;
    remKey = key;
    clear(rem);
    rem.append(h("p", { class: "cap", text: t("Reminders") }));
    if (open.length === 0) rem.append(h("p", { class: "fm-quiet", text: t("All done") }));
    for (const r of open) {
      rem.append(h("button", { class: "chk", onclick: () => {
        save<Reminder>(REMINDERS_KEY, all.map((x) => (x.id === r.id ? { ...x, done: true } : x)));
        remKey = "";
        paintReminders();
        host.resize();
      } }, h("i"), h("span", { text: r.text })));
    }
  }

  return {
    el,
    sync() {
      const shown = State.mode === "expanded" && State.view === "focusing" && Focus.get() != null;
      // The prototype: a session keeps the notch open (✕ still closes it).
      if (shown !== holding) { holding = shown; host.holdOpen(shown); }
      if (!shown) return;
      tick();
      paintNext();
      paintMusic();
      paintReminders();
    },
    fitHeight: () => contentHeight(el),
  };
}
