// JARVIS: the island's Overview tab, one to one with the notch prototype's Overview pane
// (docs/jarvis/design/prototypes/jarvis-notch.html, data-pane="overview"): six tiles in a
// 3 × 2 grid (Today, Reminders, Focus, Clipboard, Notes, Agents), each opening its tab, and
// the now-playing row under them. Everything shown is real: your calendar, the reminders and
// notes on this PC, the in-memory clipboard, the running agents and Spotify.

import { Bridge, onEvent, type ClipEntry } from "../core/bridge";
import { State } from "../core/state";
import { Spotify, currentArtwork, isAd } from "../core/spotify";
import { eventsBetween, type CalEvent } from "../core/ics";
import { nextUp, untilText } from "../core/nextup";
import { Focus, clockText, focusLeftMs } from "../core/focus";
import { Pocket, noteTitle } from "../core/pocket";
import type { IslandViewName } from "../core/layout";
import { myEvents } from "./gcal";
import { contentHeight } from "./pocket";
import { h, clear } from "./dom";
import { language, t } from "../i18n/i18n";
import type { ViewHost } from "./views";
import "./pocket.css";

// ── View ─────────────────────────────────────────────────────────────────────

const REFRESH_MS = 5 * 60_000;
/**
 * What plays, as the prototype's .np row draws it: the cover, the title and artist, the source,
 * and the ⏮ ⏯ ⏭ controls. Shared by the Overview and focus mode (src/views/focus.ts).
 */
export function musicParts(): { art: HTMLElement; who: HTMLElement; src: HTMLElement; ctls: HTMLElement } {
  const p = (cls: string, text: string) => h("p", { class: cls, text });
  // JARVIS: what a music app plays (Apple Music, Spotify, TIDAL…; never a browser); else Spotify's
  // own reading, as before.
  const m = State.media;
  const s = Spotify.state;
  const track = s.track && !isAd(s.track) ? s.track : null;
  const title = m?.title ?? track?.title ?? null;
  const artist = m?.artist ?? track?.artist ?? "";
  const playing = m ? m.playing : s.playing;
  const app = m?.app ?? "Spotify";
  const cover = m ? m.art : currentArtwork();
  const open = () => { if (!m || m.app === "Spotify") void Bridge.spotifyOpen(); };
  const art = h("span", { class: "art" });
  if (cover) art.style.backgroundImage = `url("${cover}")`;
  art.onclick = open;
  const who = h("div", { class: "ov-who" },
    p("ov-track", title ?? t("Nothing playing")),
    ...(title && artist ? [p("ov-artist", artist)] : []));
  const src = h("span", { class: "src" }, h("button", { class: "on", text: app, onclick: open }));
  // "\uFE0E": the symbol as text, not Windows' coloured emoji square.
  const ctl = (text: string, label: string, action: "previous" | "playPause" | "next") =>
    h("button", { text: `${text}\uFE0E`, title: label, "aria-label": label,
      onclick: () => void (m ? Bridge.mediaControl(action) : Bridge.spotifyControl(action)) });
  const ctls = h("div", { class: "ctl" },
    ctl("⏮", t("Previous"), "previous"),
    ctl(playing ? "⏸" : "▶", playing ? t("Pause") : t("Play"), "playPause"),
    ctl("⏭", t("Next"), "next"));
  return { art, who, src, ctls };
}

/** Google Calendar's events as last read by the Overview (focus mode's "Next" uses them too). */
export let googleEvents: CalEvent[] = [];

const timeText = (d: Date) => d.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });

export interface WidgetsHost {
  setView(v: IslandViewName): void;
  blip(): void;
  resize(): void;
}

export function buildWidgets(host: WidgetsHost): ViewHost {
  const grid = h("div", { class: "grid3" });
  const np = h("div", { class: "np" });
  const el = h("div", { class: "view pk ov" }, grid, np);

  let google: CalEvent[] = [];
  let fetchedAt = 0;
  let clips: ClipEntry[] = [];
  let shownKey = "";

  async function loadCalendar() {
    fetchedAt = Date.now();
    try {
      if (!(await Bridge.gcalConnected())) return;
      const now = new Date();
      google = eventsBetween(await Bridge.gcalFetch(), now, new Date(now.getTime() + 8 * 86_400_000));
      googleEvents = google;
      paint(true);
    } catch {
      /* no calendar: the tile shows your own events */
    }
  }

  const open = (v: IslandViewName) => () => { host.blip(); host.setView(v); };
  const tile = (onclick: (() => void) | null, ...kids: Node[]) => {
    const b = h("button", { class: "w" }, ...kids);
    if (onclick) b.onclick = onclick;
    return b;
  };
  const cap = (text: string) => h("p", { class: "cap", text });
  const p = (cls: string, text: string) => h("p", { class: cls, text });

  function tiles(now: Date): Node[] {
    // Today: what's next, when, and how long until.
    const next = nextUp(google, myEvents(), now);
    const today = next
      ? tile(open("calendar"), cap(t("Today")), p("ov-title", next.title), p("ov-when", `${timeText(next.at)} · ${untilText(next.at, now)}`))
      : tile(open("calendar"), cap(t("Today")), p("ov-quiet", t("Nothing planned.")));

    // Reminders: the first two still open.
    const open2 = Pocket.reminders().filter((r) => !r.done).slice(0, 2);
    const rem = h("p", { class: "ov-rem" });
    if (open2.length === 0) rem.append(h("span", { class: "ov-quiet", text: t("All done") }));
    open2.forEach((r, i) => { if (i) rem.append(h("br")); rem.append(document.createTextNode(`○ ${r.text}`)); });
    const reminders = tile(open("reminders"), cap(t("Reminders")), rem);

    // Focus: the length to start, or during a session the time left and until when.
    const session = Focus.get();
    const focus = session
      ? tile(open("focusing"), cap(t("Focus")), p("ov-timer", clockText(focusLeftMs(session, now.getTime()))),
        p("ov-start", t("until {time}", { time: timeText(new Date(session.startedAt + session.minutes * 60_000)) })))
      : tile(open("focus"), cap(t("Focus")), p("ov-timer", `${Focus.length}:00`), p("ov-start", t("Start")));

    // Clipboard: the newest copy, and how many more.
    const newest = clips[0];
    const clipboard = newest
      ? tile(open("clipboard"), cap(t("Clipboard")), p("ov-clip", newest.text.replace(/\s+/g, " ")),
        ...(clips.length > 1 ? [p("ov-more", t("+ {n} more", { n: clips.length - 1 }))] : []))
      : tile(open("clipboard"), cap(t("Clipboard")), p("ov-quiet", t("Nothing copied yet")));

    // Notes: the newest one's title.
    const note = Pocket.notes().sort((a, b) => b.at - a.at)[0];
    const notes = tile(open("notes"), cap(t("Notes")), p(note ? "ov-note" : "ov-quiet", note ? `${noteTitle(note)}…` : t("No notes yet")));

    // Agents: who needs you, else who's working, else quiet.
    const agents = State.tasks.filter((x) => !x.isIntegration);
    const asking = agents.find((x) => x.pillBadge === "approval" || x.id === State.pendingApproval?.pillId);
    const working = agents.filter((x) => x.state !== "idle");
    const [color, line] = asking
      ? ["#0a84ff", t("{name} needs you", { name: asking.name })]
      : working.length
        ? ["#30d158", working.length === 1 ? t("{name} is working", { name: working[0].name }) : t("{n} working", { n: working.length })]
        : ["#636366", t("None running")];
    const dot = h("span", { class: "dot" });
    dot.style.background = color;
    const agentTile = tile(open("agents"), dot, h("div", {}, h("p", { class: "cap", text: t("Agents") }), p("ov-agent", line)));
    agentTile.classList.add("ov-agents");

    return [today, reminders, focus, clipboard, notes, agentTile];
  }

  function paint(force = false) {
    const now = new Date();
    const s = Spotify.state;
    const key = JSON.stringify([
      Focus.get() ? now.getSeconds() : 0, Focus.length,
      now.getMinutes(), google.length, fetchedAt, clips.length, clips[0]?.id, Pocket.reminders(), Pocket.notes().length,
      State.tasks.map((x) => [x.id, x.state, x.pillBadge, x.name]), State.pendingApproval?.pillId,
      s.track?.id, s.playing, currentArtwork(), State.media,
    ]);
    if (!force && key === shownKey) return;
    shownKey = key;
    clear(grid);
    grid.append(...tiles(now));
    clear(np);
    const m = musicParts();
    np.append(m.art, m.who, m.src, m.ctls);
    host.resize();
  }

  void onEvent<ClipEntry[]>("clipboard-history", (next) => { clips = next; if (State.view === "widgets") paint(); });
  void Bridge.clipboardHistory().then((c) => { clips = c ?? clips; });
  let wasShown = false;

  return {
    el,
    sync() {
      const shown = State.mode === "expanded" && State.view === "widgets";
      if (shown && !wasShown) {
        void Bridge.spotifyRefresh();
        void Bridge.clipboardHistory().then((c) => { clips = c ?? clips; paint(true); });
        if (Date.now() - fetchedAt > REFRESH_MS) void loadCalendar();
      }
      wasShown = shown;
      if (shown) paint();
    },
    fitHeight: () => contentHeight(el),
  };
}
