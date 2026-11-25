// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, type AgentTask } from "../core/state";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { highlightRow, listRows, openRow } from "./github";
import { pillDefinition, promoteToMain, sanitizeDeclared, sessionSubtitle, setSlot, slotChoices, slotColor, type Declared } from "../core/pills";
import {
  PlanCard, buildPlanPill, claudePillVisible, codexPillVisible, planCardOpen, refreshCodexPlanUsage,
} from "./usage";
import { buildDiffCard } from "./diff";
import { lastTextStep } from "../core/diff";
import { Bridge, onEvent } from "../core/bridge";
import { buildRecap } from "./recap";
import { buildWardrobe } from "./wardrobe";
import { buildUpdate } from "./update";
import { buildWhatsNew } from "./whatsnew";
import { buildLaunch } from "./launch";
import { buildSpotifyCard, buildSpotifyPill, type SpotifyPillHost } from "./spotify";
import { SPOTIFY_ID } from "../core/spotify";
import { buildWhatsAppCard } from "./whatsapp";
import { WHATSAPP_ID } from "../core/whatsapp";
import { MAIL_ID } from "../core/mail";
import { buildMailCard } from "./mail";
import { buildCalendar } from "./gcal";
import { buildClipboard, buildNotes, buildReminders } from "./pocket";
import { buildWidgets } from "./widgets";
import { buildFocusMode, buildFocusTab } from "./focus";
import { buildAgents } from "./agents";
import { TABS_EVENT, dropIndex, loadHiddenTabs, loadTabOrder, moveItem, orderTabs, saveTabOrder, shownTabs } from "../core/taborder";
import { buildLive } from "./live";
import * as Live from "../core/live";
import type { Outfit, OutfitSelection } from "../mochi/wardrobe";
import { language, t, tl, type Msg } from "../i18n/i18n";
import type { ViewCommand } from "../island/shortcuts";

export interface ViewActions {
  setView(v: IslandViewName): void;
  /** "Cancel" on a dropped file: forgets it and goes back home. */
  cancelDrop(): void;
  collapse(): void;
  /** Folds a waiting card to the compact island without answering it. */
  foldApproval(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  decide(d: "allow" | "deny"): void;
  /** Answers the question Claude Code asked: question text → chosen label. */
  answer(answers: Record<string, string | string[]>): void;
  /** Hands the pending request back to the terminal. */
  answerInTerminal(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
  /** Wardrobe click: keeps the outfit ("auto" and "none" included). */
  chooseOutfit(selection: OutfitSelection): void;
  /** Wardrobe hover: shows an outfit on Mochi without keeping it; null ends it. */
  previewOutfit(outfit: Outfit | null): void;
  /** The island takes the keyboard (a text field in a card) or gives it back. */
  keyboard(on: boolean): void;
  /** Something is being typed in a card: the island stays open until it is sent or cleared. */
  holdOpen(on: boolean): void;
  /** JARVIS: a focus session started, or ended (done: it ran its full length). */
  focusStarted(): void;
  focusEnded(done: boolean): void;
  /** A Claude Code session was started from the launch card: Mochi is pleased, the island folds. */
  launched(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. True = needs another frame. */
  tick?(nowMs: number): boolean | void;
  /** Ctrl+O / Ctrl+E while the view is on screen (island/shortcuts.ts). */
  command?(command: ViewCommand): void;
  /** JARVIS: how tall the view's own content is, in px. Set, the notch is as tall as that
   *  (the prototype's fit()) instead of a fixed height. */
  fitHeight?(): number;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

/**
 * Dragging a tab along the bar: past 5 px it lifts and follows the pointer, the others slide
 * aside to make room, and on release it takes its new place (Home, not in `items`, never moves).
 * The click that ends a drag doesn't open the tab. The island stays open meanwhile.
 */
function dragTabs(
  bar: HTMLElement,
  items: Map<string, HTMLElement>,
  getOrder: () => string[],
  setOrder: (next: string[]) => void,
  hold: (on: boolean) => void,
) {
  let drag: { id: string; el: HTMLElement; x0: number; started: boolean; pid: number; from: number; to: number;
    lefts: number[]; step: number } | null = null;
  let swallowClick = false;
  const els = () => getOrder().map((id) => items.get(id)!);

  for (const [id, el] of items) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { id, el, x0: e.clientX, started: false, pid: e.pointerId, from: 0, to: 0, lefts: [], step: 0 };
    });
    el.addEventListener("click", (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }

  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.started) {
      if (Math.abs(dx) < 5) return;
      drag.started = true;
      const list = els();
      drag.from = list.indexOf(drag.el);
      drag.to = drag.from;
      drag.lefts = list.map((t) => t.getBoundingClientRect().left);
      drag.step = list.length > 1 ? drag.lefts[1] - drag.lefts[0] : drag.el.offsetWidth;
      try { drag.el.setPointerCapture(drag.pid); } catch { /* fine without */ }
      drag.el.classList.add("dragging");
      for (const t of list) if (t !== drag.el) t.style.transition = "transform .2s cubic-bezier(.32,.72,0,1)";
      hold(true);
    }
    // It follows the pointer, kept within the movable tabs' span.
    const n = drag.lefts.length;
    const minDx = drag.lefts[0] - drag.lefts[drag.from];
    const maxDx = drag.lefts[n - 1] - drag.lefts[drag.from];
    const cdx = Math.max(minDx, Math.min(maxDx, dx));
    drag.el.style.transform = `translateX(${cdx}px) scale(1.08)`;
    const half = drag.el.offsetWidth / 2;
    const others = drag.lefts.filter((_, i) => i !== drag!.from).map((l) => l + half);
    drag.to = dropIndex(others, drag.lefts[drag.from] + half + cdx);
    // The others make room.
    els().forEach((t, i) => {
      if (t === drag!.el) return;
      let shift = 0;
      if (drag!.from < drag!.to && i > drag!.from && i <= drag!.to) shift = -drag!.step;
      if (drag!.from > drag!.to && i >= drag!.to && i < drag!.from) shift = drag!.step;
      t.style.transform = shift ? `translateX(${shift}px)` : "";
    });
  });

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    swallowClick = true;
    window.setTimeout(() => { swallowClick = false; }, 0);
    const next = moveItem(getOrder(), d.from, d.to);
    setOrder(next);
    for (const t of els()) { t.style.transition = "none"; t.style.transform = ""; }
    d.el.classList.remove("dragging");
    const home = bar.firstElementChild;
    bar.replaceChildren(...(home ? [home] : []), ...els());
    requestAnimationFrame(() => { for (const t of els()) t.style.transition = ""; });
    hold(false);
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string | Msg,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: t("Home"), onclick: () => go("overview") }, svg(ICONS.house, 17));
  const tabChat = h("button", { class: "tab", title: tl("Ask"), onclick: () => go("prompt") }, svg(ICONS.bubbleRound, 19));
  const tabDrop = h("button", { class: "tab", title: tl("Drop"), onclick: () => go("upload") }, svg(ICONS.plus, 16));
  // A new Claude Code session, in a project, from here (Mac: the terminal tab).
  const tabLaunch = h(
    "button",
    { class: "tab", title: tl("New Claude Code session"), onclick: () => go("launch") },
    svg(ICONS.terminal, 17, { stroke: 1.7 }),
  );
  // JARVIS: the calendar (src/views/gcal.ts).
  const tabCalendar = h("button", { class: "tab", title: tl("Calendar"), onclick: () => go("calendar") }, svg(ICONS.calendar, 17, { stroke: 1.7 }));
  // JARVIS: the bigger notch's own tabs (SPEC §7). Overview: the prototype's four squares.
  const tabWidgets = h("button", { class: "tab", title: t("Overview"), onclick: () => go("widgets") }, svg("M5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9 10.5H5A1.5 1.5 0 0 1 3.5 9V5A1.5 1.5 0 0 1 5 3.5zM15 3.5h4A1.5 1.5 0 0 1 20.5 5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13.5 9V5A1.5 1.5 0 0 1 15 3.5zM5 13.5h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9 20.5H5A1.5 1.5 0 0 1 3.5 19v-4A1.5 1.5 0 0 1 5 13.5zM15 13.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z", 17, { stroke: 1.7 }));
  const tabReminders = h("button", { class: "tab", title: t("Reminders"), onclick: () => go("reminders") }, svg("M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.2 12.2l2.6 2.6 5-5.6", 17, { stroke: 1.7 }));
  const tabNotes = h("button", { class: "tab", title: t("Notes"), onclick: () => go("notes") }, svg("M6 3.5h12v17H6zM9.5 8.5h5M9.5 12h5M9.5 15.5h3", 17, { stroke: 1.7 }));
  const tabFocus = h("button", { class: "tab", title: t("Focus"), onclick: () => go("focus") }, svg("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", 17, { stroke: 1.7 }));
  // The prototype's icon: a dot in a dashed ring.
  const agentsIcon = svg("M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", 17, { stroke: 1.7 });
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [k, v] of [["cx", "12"], ["cy", "12"], ["r", "8"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.7"], ["stroke-dasharray", "2 3"]]) ring.setAttribute(k, v);
  agentsIcon.append(ring);
  const tabAgents = h("button", { class: "tab", title: t("Agents"), onclick: () => go("agents") }, agentsIcon);
  const tabClipboard = h("button", { class: "tab", title: t("Clipboard"), onclick: () => go("clipboard") }, svg("M7 5h10a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 7 5zM9.5 3.5h5v3h-5z", 17, { stroke: 1.7 }));

  const gearBtn = h("button", { title: tl("Settings"), onclick: () => go("settings") }, svg(ICONS.gearLine, 18, { stroke: 1.6 }));
  const soundBtn = h("button", { title: tl("Mute"), onclick: () => actions.toggleSound() }, svg(ICONS.speakerLine, 18, { stroke: 1.6 }));
  // Folds back to the compact island now, without waiting for the timer (the
  // Mac's ✕). A card waiting for an answer keeps the island open: no ✕ then.
  const closeBtn = h("button", { class: "close", title: tl("Close"), onclick: () => actions.collapse() }, svg(ICONS.xmark, 17));
  // Plan usage pills (off by default): before the gear, Claude first, as on the Mac.
  const claudePill = buildPlanPill(false, () => actions.setView("overview"));
  const codexPill = buildPlanPill(true, () => actions.setView("overview"));
  const planPills = h("div", { class: "plan-pills" }, claudePill.el, codexPill.el);
  let codexShown = false;

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  // JARVIS: the tabs in your order (core/taborder.ts); Home always first. Drag one to move it.
  const movable = new Map<string, HTMLElement>([
    ["ask", tabChat], ["drop", tabDrop], ["launch", tabLaunch], ["calendar", tabCalendar], ["widgets", tabWidgets],
    ["reminders", tabReminders], ["notes", tabNotes], ["clipboard", tabClipboard], ["focus", tabFocus], ["agents", tabAgents],
  ]);
  let order = orderTabs([...movable.keys()], loadTabOrder());
  let hidden = loadHiddenTabs();
  const tabsBar = h("div", { class: "tabs" }, tabHome, ...shownTabs(order, hidden).map((id) => movable.get(id)!));
  // Dragging reorders the shown tabs; the hidden ones keep their places after them.
  dragTabs(tabsBar, movable, () => shownTabs(order, hidden), (next) => {
    order = [...next, ...order.filter((id) => hidden.includes(id))];
    saveTabOrder(order);
  }, (on) => actions.holdOpen(on));
  // Settings → Tabs in the notch: shown, hidden or moved there, the bar follows at once.
  const relayout = () => {
    order = orderTabs([...movable.keys()], loadTabOrder());
    hidden = loadHiddenTabs();
    tabsBar.replaceChildren(tabHome, ...shownTabs(order, hidden).map((id) => movable.get(id)!));
  };
  void onEvent(TABS_EVENT, relayout);
  window.addEventListener("storage", (e) => { if (e.key?.startsWith("jarvis.tabs.")) relayout(); });

  const el = h(
    "div",
    { id: "header" },
    tabsBar,
    h("div", { class: "header-actions" }, planPills, gearBtn, soundBtn, closeBtn),
  );
  const headerActions = el.lastElementChild as HTMLElement;

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty" || v === "live");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      tabLaunch.classList.toggle("on", v === "launch");
      tabCalendar.classList.toggle("on", v === "calendar");
      tabWidgets.classList.toggle("on", v === "widgets");
      tabReminders.classList.toggle("on", v === "reminders");
      tabNotes.classList.toggle("on", v === "notes");
      tabClipboard.classList.toggle("on", v === "clipboard");
      tabFocus.classList.toggle("on", v === "focus");
      tabAgents.classList.toggle("on", v === "agents");
      // Focus mode: the prototype shows no tabs, only the session.
      el.classList.toggle("gone", v === "focusing");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(v === "settings" ? svg(ICONS.gearFill, 18) : svg(ICONS.gearLine, 18, { stroke: 1.6 }));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerLine : ICONS.speakerSlashLine, 18, { stroke: 1.6 }));
      closeBtn.style.display = State.pendingApproval ? "none" : "";
      syncPlanPills();
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };

  function syncPlanPills() {
    const claudeOn = claudePillVisible();
    const codexOn = codexPillVisible();
    claudePill.el.style.display = claudeOn ? "" : "none";
    codexPill.el.style.display = codexOn ? "" : "none";
    planPills.classList.toggle("on", claudeOn || codexOn);
    // Both pills: the right side tightens so it still clears the screen edge.
    headerActions.classList.toggle("both-plans", claudeOn && codexOn);
    if (claudeOn) claudePill.sync();
    if (codexOn) codexPill.sync();
    // Codex is asked when its pill comes into view (stale answers only).
    const shown = codexOn && State.mode === "expanded";
    if (shown && !codexShown) refreshCodexPlanUsage();
    codexShown = shown;
  }
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  /** The diff open in the left card (a FileDiff id), as activeDiffId on macOS. */
  let activeDiffId: number | null = null;
  const closeDiff = () => {
    if (activeDiffId == null) return;
    activeDiffId = null;
    State.notify();
  };
  const ticker = new Ticker((diffId) => {
    actions.blip();
    activeDiffId = diffId;
    State.notify();
  });
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: tl("Open"), onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 12),
  );
  // JARVIS: the live code view of the session, on demand (never by itself).
  const liveBtn = h(
    "button",
    { class: "icon-btn live-btn", title: tl("Watch live"), onclick: () => { actions.blip(); actions.setView("live"); } },
    svg(ICONS.code, 12, { stroke: 2 }),
  );
  const left = card(null, leftBody, jump, liveBtn);
  const pills = h("div", { class: "pills" });
  const right = card(null, pills);
  // JARVIS: who's on Home. Clicking a square makes that app the main: it takes the left card
  // and turns white, and the old main takes its square and that square's colour. Right-click a
  // square → Edit opens its list over the right card, to put another app there. The colour stays
  // with the place (core/pills.ts slotColor), never with the app.
  let pickingSlot: number | null = null;
  const picker = h("div", { class: "slot-picker" });
  picker.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); pickSlot(null); } });

  /** A square's click: it becomes the main. Anything else (a session's pill) just shows its card. */
  function promote(id: string) {
    const next = promoteToMain(sanitizeDeclared(State.settings, State.os), id);
    if (!next) { actions.setFocus(id); return; }
    actions.blip();
    save(next);
  }

  // Right-click: the webview's own menu (Back, Refresh…), with Edit on top when the press was in
  // the squares' card (src-tauri/src/webview_menu.rs). The press tells Rust where it was before
  // the menu opens on release; Edit opens the square under it, else the first empty one.
  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;
    const target = e.target as HTMLElement;
    let slot: number | null = null;
    if (State.view === "overview" && right.contains(target)) {
      const d = sanitizeDeclared(State.settings, State.os);
      const at = target.closest("[data-slot], .pill") as HTMLElement | null;
      const under = at?.dataset.slot != null ? Number(at.dataset.slot) : at?.dataset.id ? d.activeIntegrations.indexOf(at.dataset.id) : -1;
      slot = under >= 0 ? under : Math.min(d.activeIntegrations.length, 3);
    }
    void Bridge.contextZone(slot);
  }, true);
  void onEvent<number>("home-edit", (slot) => pickSlot(slot));
  /** The island stays open while a square's list is up. */
  function hold() { actions.holdOpen(pickingSlot != null); }

  function pickSlot(slot: number | null, quiet = false) {
    pickingSlot = slot;
    hold();
    if (!quiet) { pillIds = ""; State.notify(); }
  }
  function save(next: Declared) {
    State.applyDeclared(next);
    void Bridge.saveSettings(State.settings);
  }
  /** A square's list, over the right card. */
  function drawPicker() {
    if (pickingSlot == null) { picker.remove(); return; }
    const d = sanitizeDeclared(State.settings, State.os);
    const slot = pickingSlot;
    clear(picker);
    const row = (label: string, color: string | null, on: boolean, pick: () => void) => {
      const sq = h("i");
      if (color) sq.style.background = color; else sq.classList.add("none");
      return h("button", { class: on ? "on" : "", onclick: pick }, sq, h("span", { text: label }),
        on ? svg(ICONS.check, 10, { stroke: 2.4 }) : null);
    };
    const close = h("button", { class: "sp-x", title: t("Close"), "aria-label": t("Close"), onclick: () => pickSlot(null) }, svg(ICONS.xmark, 9));
    const list = h("div", { class: "sp-list" });
    const current = d.activeIntegrations[slot] ?? null;
    picker.append(h("p", { class: "sp-head" }, h("span", { text: t("Slot {n}", { n: slot + 1 }) }), close), list);
    const choose = (next: string[] | null) => { if (next) save({ ...d, activeIntegrations: next }); pickSlot(null); };
    if (current) list.append(row(t("Empty"), null, false, () => choose(setSlot(d, slot, null, State.os))));
    for (const def of slotChoices(d, State.os)) {
      list.append(row(def.name, slotColor(d, def.id) ?? "#48484a", def.id === current, () => choose(setSlot(d, slot, def.id, State.os))));
    }
    right.append(picker);
    (list.querySelector(".on") as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }
  // Opened from a plan pill in the header: stands in for the left card.
  const plan = new PlanCard();
  let planTimer: number | null = null;
  // Spotify's card and pill are kept and updated in place: the progress bar
  // runs on, and a slider being dragged must not be rebuilt under the pointer.
  const spotifyCard = buildSpotifyCard();
  let spotifyPill: SpotifyPillHost | null = null;
  // WhatsApp's card too: its reply field keeps the draft and the keyboard while messages arrive.
  // Mail's card too (classic Outlook): the search field keeps its text and the keyboard.
  const mailCard = buildMailCard({ keyboard: (on) => actions.keyboard(on) });
  const whatsappCard = buildWhatsAppCard({
    openSettings: () => actions.openSettingsWindow(),
    keyboard: (on) => actions.keyboard(on),
    holdOpen: (on) => actions.holdOpen(on),
  });

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | "plan" | "diff" | "spotify" | "whatsapp" | "mail" | null = null;
  let cardKey = "";
  /** The list row highlighted at the last sync, to scroll only when it moves. */
  let shownSelection: number | null = null;

  // Leaving the overview or folding the island closes the diff, as on macOS.
  State.subscribe(() => {
    if (activeDiffId != null && (State.view !== "overview" || State.mode !== "expanded")) {
      activeDiffId = null;
    }
  });
  // Escape steps back out of the diff before it closes the island.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || activeDiffId == null || State.view !== "overview") return;
      e.stopImmediatePropagation();
      closeDiff();
    },
    true,
  );

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
  };

  /** The countdowns move every 30 s while a card is open, and only then. */
  function syncPlanTimer(open: boolean) {
    const stop = () => {
      if (planTimer != null) window.clearInterval(planTimer);
      planTimer = null;
    };
    if (!open) return stop();
    if (planTimer != null) return;
    planTimer = window.setInterval(() => {
      if (planCardOpen() && State.mode === "expanded") State.notify();
      else stop();
    }, 30_000);
  }

  return {
    el,
    tick(nowMs: number) {
      if (mode !== "ticker") return false;
      ticker.tick(nowMs);
      return ticker.animating;
    },
    command(command) {
      if (command === "openSelection") {
        // Ctrl+O: what a click on the highlighted row does.
        if (mode !== "card" || State.cardSelection == null) return;
        openRow(listRows(leftBody)[State.cardSelection]);
        return;
      }
      // Ctrl+E (⌘E, islandToggleDiff): closes the diff that is open, else
      // opens the focused pill's latest edit.
      if (activeDiffId != null) {
        closeDiff();
        return;
      }
      const task = State.focusTask;
      const diffs = task ? State.sessionDiffs.get(task.id) : undefined;
      const last = diffs?.[diffs.length - 1];
      if (last?.id == null) return;
      activeDiffId = last.id;
      State.notify();
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        activeDiffId = null;
        cardKey = "";
        mode = null;
      }

      // A workspace or agent pill with a live session keeps the ticker; every
      // other pill shows its own card, exactly like IntegrationCardView.
      const sessionActive = task != null && hasSessionTicker(task);

      const planOpen = planCardOpen();
      if (mode === "plan" && !planOpen) {
        mode = null;
        cardKey = "";
      }
      syncPlanTimer(planOpen);

      // A diff that has since been dropped (cap, expiry, session end) just closes.
      const diff = task && activeDiffId != null ? State.findDiff(task.id, activeDiffId) : null;
      if (!diff) activeDiffId = null;

      if (planOpen) {
        if (mode !== "plan") {
          clear(leftBody);
          leftBody.append(plan.el);
          mode = "plan";
        }
        plan.sync();
      } else if (task && diff) {
        const key = `diff~${task.id}~${diff.id}`;
        if (key !== cardKey) {
          cardKey = key;
          mode = "diff";
          clear(leftBody);
          leftBody.append(buildDiffCard(diff, {
            dismiss: () => {
              actions.blip();
              closeDiff();
            },
            open: (path) => void Bridge.openFileInVSCode(path),
          }));
        }
      } else if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        // The agent's name is already the pill's: the label says what kind of
        // pill it is, as on the Mac (PillDefinition.sessionSubtitle).
        who.append(
          dot(task.color, 7),
          h("span", { class: "name", text: task.name }),
          h("span", { class: "tool", text: t(sessionSubtitle(task.id)) }),
        );
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
      } else if (task && task.id === SPOTIFY_ID) {
        // Its own card for every state: playing, idle, not installed.
        if (mode !== "spotify") {
          clear(leftBody);
          leftBody.append(spotifyCard.el);
          mode = "spotify";
          cardKey = "";
        }
        spotifyCard.sync();
      } else if (task && task.id === MAIL_ID) {
        if (mode !== "mail") {
          clear(leftBody);
          leftBody.append(mailCard.el);
          mode = "mail";
          cardKey = "";
        }
        mailCard.sync();
      } else if (task && task.id === WHATSAPP_ID) {
        // Its own card in every state: not linked, no message, conversations, one open.
        if (mode !== "whatsapp") {
          clear(leftBody);
          leftBody.append(whatsappCard.el);
          mode = "whatsapp";
          cardKey = "";
        }
        whatsappCard.sync();
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          language(), task.id, task.color, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      }

      jump.style.display = detailOpen || mode === "plan" || mode === "diff" ? "none" : "";
      const focusLive = State.focusTask ? Live.active(State.focusTask.id) : false;
      const liveShown = focusLive && !detailOpen && mode !== "plan" && mode !== "diff";
      liveBtn.style.display = liveShown ? "" : "none";
      // The header text makes room for the second corner button.
      left.classList.toggle("has-live", liveShown);

      // Ctrl+↓ Ctrl+↑ walk the open GitHub list (cardItemCount / cardSelection).
      const rows = mode === "card" ? listRows(leftBody) : [];
      State.cardItemCount = rows.length;
      if (State.cardSelection != null && State.cardSelection >= rows.length) State.cardSelection = null;
      highlightRow(rows, State.cardSelection, State.cardSelection !== shownSelection);
      shownSelection = State.cardSelection;

      // Editing ends when Home goes away or the island folds.
      if ((State.view !== "overview" || State.mode !== "expanded") && pickingSlot != null) pickSlot(null, true);
      const declared = sanitizeDeclared(State.settings, State.os);
      const others = State.otherTasks.slice(0, 4);
      const pillKey = others.map((t) => `${t.id}:${t.color}:${t.pillBadge ?? ""}`).join("|")
        + `~${declared.mainPill}:${declared.activeIntegrations.join(",")}:${pickingSlot}`;
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        spotifyPill = null;
        drawPicker();
        for (const t of others) {
          if (t.id === SPOTIFY_ID) {
            spotifyPill = buildSpotifyPill(t, () => promote(t.id));
            pills.append(spotifyPill.el);
          } else {
            pills.append(buildPill(t, actions, () => promote(t.id)));
          }
        }
        // Empty squares (fewer than four apps chosen): "+ Add" opens that square's list.
        for (let slot = declared.activeIntegrations.length; slot < 4 && pills.childElementCount < 4; slot++) {
          const n = slot;
          pills.append(h("button", { class: "pill empty", "data-slot": String(n), onclick: () => pickSlot(n) },
            h("span", { class: "lbl", text: t("+ Add") })));
        }
        pruneMiniBots();
      }
      spotifyPill?.sync();
    },
  };
}

/**
 * IntegrationCardView.agentSessionActive: a workspace tool or an agent — or
 * any other tagged agent — with something going on.
 */
export function hasSessionTicker(task: AgentTask): boolean {
  // A pill made for an agent's session (Gemini CLI, Codex… not declared) only
  // exists while that session does: it keeps the ticker from the first event.
  if (task.source === "agent" && !task.isIntegration) return true;
  const category = pillDefinition(task.id)?.category;
  const isSession = category === "workspace" || category === "agent" ||
    (category == null && task.id.startsWith("agent_"));
  return isSession && (task.state !== "idle" || task.steps.length > 0);
}

function buildPill(task: AgentTask, actions: ViewActions, onClick?: () => void): HTMLElement {
  const label = task.id === "integration_claude" ? pillDefinition(task.id)!.name : task.name;
  const canvas = createMiniBot(task, 30); // JARVIS: the prototype's pill square, 36 × 26
  const pill = h(
    "div",
    { class: "pill", "data-id": task.id, onclick: onClick ?? (() => actions.setFocus(task.id)) },
    canvas,
    h("span", { class: "lbl", text: label }),
  );
  pill.style.borderColor = `${task.color}24`;
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "";
    pill.style.borderColor = `${task.color}24`;
    pill.style.boxShadow = "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = "";
  });

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: tl("Nothing running right now.") }),
      h("div", { class: "sub", text: tl("Drop a file or window, or ask me anything.") }),
    ),
    h("div", { class: "grow" }),
    btn(tl("Ask Claude"), "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

/** How long a fresh permission card ignores clicks on its buttons. */
const CLICK_GUARD_MS = 600;

/**
 * The ⌃ in the corner of a waiting card: folds the island to its compact size
 * and leaves the request waiting — nothing is answered (Mac #290). Opening the
 * island again brings the card back.
 */
function foldButton(actions: ViewActions): HTMLElement {
  return h(
    "button",
    { class: "icon-btn fold", title: tl("Later — keep it waiting"), onclick: () => actions.foldApproval() },
    svg(ICONS.chevronUp, 8, { stroke: 2.4 }),
  );
}

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" },
    card("amber", stack(116, 16, who, code, row), foldButton(actions)));
  let rowKey = "";
  // The card pops up under a cursor that was busy with something else: a click
  // meant for the window underneath must not land on Allow. Clicks in the first
  // moments after a new request appears are ignored.
  let shownFor: string | null = null;
  let shownAt = 0;
  const guarded = (d: "allow" | "deny") => () => {
    if (performance.now() - shownAt < CLICK_GUARD_MS) return;
    actions.decide(d);
  };
  const inTerminal = () => {
    if (performance.now() - shownAt < CLICK_GUARD_MS) return;
    actions.answerInTerminal();
  };
  return {
    el,
    sync() {
      const req = State.pendingApproval?.requestId ?? null;
      if (req !== shownFor) {
        shownFor = req;
        shownAt = performance.now();
      }
      clear(who);
      who.append(agentWho(State.focusTask, t("needs permission")));
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      // Two buttons, built once per kind of card. Rebuilding them between a
      // mouse-down and a mouse-up would swallow the click. "Always" is gone until
      // the remembered-rules list exists to back it. Antigravity waits on the card:
      // a third button hands the command back to its own prompt in the terminal,
      // where its "Always allow" lives (as on the Mac).
      const agy = State.pendingApproval?.pillId === "agent_antigravity";
      const key = agy ? "agy" : "built";
      if (rowKey === key) return;
      rowKey = key;
      clear(row);
      row.append(
        btn(tl("Deny"), "secondary", guarded("deny"), "N"),
        btn(tl("Allow"), "primary", guarded("allow"), "Y"),
      );
      if (agy) row.append(btn(tl("Reply in terminal"), "secondary", inTerminal));
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title question-text" });
  const row = h("div", { class: "actions options" });
  const fold = foldButton(actions);
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row), fold));

  // Where we are in the request on screen: which question, what is answered so
  // far, and what is ticked in a pick-several question.
  let requestId = "";
  let index = 0;
  let answers: Record<string, string | string[]> = {};
  let picked = new Set<string>();
  // The buttons are only rebuilt when what they show changes: rebuilding them
  // between a mouse-down and a mouse-up would swallow the click.
  let rowKey = "";

  const next = (question: string, answer: string | string[], total: number) => {
    answers[question] = answer;
    picked = new Set();
    index += 1;
    if (index >= total) actions.answer(answers);
    else State.notify();
  };

  return {
    el,
    sync() {
      const questions = State.pendingApproval?.questions;
      clear(who);
      // Only a request that is waiting can be folded away and come back.
      fold.style.display = State.pendingApproval ? "" : "none";

      // A question that arrived as a notification has nothing to pick from.
      if (!questions) {
        who.append(agentWho(State.focusTask, t("is asking a question")));
        const task = State.focusTask;
        title.textContent = (task && lastTextStep(task.steps)) ?? t("Claude needs an answer.");
        if (rowKey !== "terminal") {
          rowKey = "terminal";
          clear(row);
          row.append(h("div", { class: "sub", text: tl("Answer it in your terminal.") }));
        }
        return;
      }

      if (State.pendingApproval!.requestId !== requestId) {
        requestId = State.pendingApproval!.requestId;
        index = 0;
        answers = {};
        picked = new Set();
      }
      const q = questions[Math.min(index, questions.length - 1)];
      const asking = questions.length > 1
        ? t("is asking ({index} of {total})", { index: index + 1, total: questions.length })
        : t("is asking");
      who.append(agentWho(State.focusTask, asking));
      title.textContent = q.question;
      title.title = q.question;

      const key = `${requestId}:${index}:${[...picked].join("|")}`;
      if (rowKey === key) return;
      rowKey = key;
      clear(row);
      for (const option of q.options) {
        const on = picked.has(option.label);
        const button = btn(option.label, on ? "primary" : "secondary", () => {
          if (!q.multiSelect) {
            next(q.question, option.label, questions.length);
            return;
          }
          if (on) picked.delete(option.label);
          else picked.add(option.label);
          State.notify();
        });
        if (option.description) button.title = option.description;
        row.append(button);
      }
      if (q.multiSelect) {
        const done = btn(tl("Done"), "primary", () => {
          if (picked.size > 0) next(q.question, [...picked], questions.length);
        });
        if (picked.size === 0) done.classList.add("off");
        row.append(done);
      }
      row.append(
        h("button", {
          class: "link-btn",
          style: "color:#8e939c",
          text: tl("Answer in terminal"),
          onclick: () => actions.answerInTerminal(),
        }),
      );
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" },
    btn(tl("Retry"), "primary", () => actions.setView(State.defaultView())),
    btn(tl("Open in n8n"), "secondary", () => actions.openUrl("")),
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      // agentWho already shows an agent's name: its label is just the kind.
      const whoLabel = task?.source === "n8n" ? "n8n" : task?.source === "agent" ? t("Agent") : "Claude Code";
      who.append(agentWho(task, whoLabel));
      title.textContent = task?.source === "n8n" ? t("Workflow stopped.") : t("Session stopped on an error.");
      detail.textContent = (task && lastTextStep(task.steps)) ?? t("No detail available.");
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title one-line" });
  const open = btn(tl("Open terminal"), "primary", () => actions.openTerminal());
  const row = h("div", { class: "actions" },
    open,
    btn(tl("OK"), "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      const agent = State.focusTask?.source === "agent";
      who.append(agentWho(State.focusTask, agent ? t("finished") : t("Claude Code finished")));
      // The final message, else the last step that is not a diff (FinishedView).
      const task = State.focusTask;
      title.textContent = task?.finalLine || (task && lastTextStep(task.steps)) || t("Session finished");
      // Sessions from the Claude desktop app live there, not in a terminal.
      const label = task?.id === "agent_claude-desktop" ? t("Open Claude") : t("Open terminal");
      const span = open.firstElementChild as HTMLElement;
      if (span.textContent !== label) span.textContent = label;
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: tl("Too many hits at once.") }),
    h("div", { class: "sub", text: tl("Give me a sec — back to work in three seconds.") }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: tl("Sound") }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: tl("Settings…"),
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = t("Auto-close · {seconds}s", { seconds: Math.round(s.autoCloseInterval) });
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(dot("#F4505E", 6), h("span", { text: "API" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: Msg, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions));
  map.set("question", buildQuestion(actions));
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  map.set("recap", buildRecap(actions));
  map.set("wardrobe", buildWardrobe(actions));
  map.set("update", buildUpdate());
  map.set("whatsNew", buildWhatsNew());
  map.set("launch", buildLaunch(actions));
  const pocket = { keyboard: (on: boolean) => actions.keyboard(on), holdOpen: (on: boolean) => actions.holdOpen(on), resize: onChatHeightChange };
  map.set("calendar", buildCalendar(pocket));
  map.set("reminders", buildReminders(pocket));
  map.set("notes", buildNotes(pocket));
  map.set("clipboard", buildClipboard(pocket));
  const focusHost = {
    setView: (x: IslandViewName) => actions.setView(x),
    blip: () => actions.blip(),
    resize: onChatHeightChange,
    holdOpen: (on: boolean) => actions.holdOpen(on),
    started: () => actions.focusStarted(),
    ended: (done: boolean) => actions.focusEnded(done),
  };
  map.set("focus", buildFocusTab(focusHost));
  map.set("agents", buildAgents({
    setView: (x) => actions.setView(x),
    setFocus: (id) => actions.setFocus(id),
    decide: (d) => actions.decide(d),
    blip: () => actions.blip(),
    resize: onChatHeightChange,
  }));
  map.set("focusing", buildFocusMode(focusHost));
  map.set("widgets", buildWidgets({ setView: (x) => actions.setView(x), blip: () => actions.blip(), resize: onChatHeightChange }));
  map.set("live", buildLive(actions, onChatHeightChange));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder(tl("Sending by email isn't in this version."), ""));
  map.set("searching", buildPlaceholder(tl("Claude is searching…"), ""));
  map.set("result", buildPlaceholder(tl("Result"), ""));
  return map;
}
