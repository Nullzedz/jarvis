// The JARVIS window: a sidebar with Flow (dictation, the Notetaker, the
// statistics, the dictionary, the snippets, the styles and their settings)
// and Notch (every setting of the island), and the page on the right, under
// its coloured band. Port of FlowHub.swift.

import "./hub.css";
import "./redesign.css";
import { initTheme } from "../theme/theme";
import { homePage, sectionIcon, type HomeHandle } from "./home";
import { SECTIONS, sectionOf, type Section } from "./sections";
import { windowControls } from "./winctl";
import { h, clear } from "../views/dom";
import { t, onLanguageChange } from "../i18n/i18n";
import { Bridge, onEvent } from "../core/bridge";
import { photo } from "./pages/profile";
import { FlowBridge, type FlowPrefs, type FlowStatus, type ModelsStatus, flowKeyId } from "../core/flow";
import { hero, setVoiceLevel, setWindowShown } from "./hero";
import { icon, keyLabel } from "./ui";
import { searchSettings, type SettingsSearchHit } from "./search";

export type PageId =
  | "home" | "dictation" | "notes" | "insights" | "dictionary" | "snippets" | "styles" | "flowsettings"
  | "general" | "pills" | "agents" | "chat" | "voice" | "integrations" | "phone" | "shortcuts"
  | "mail" | "mailOverview" | "mailRules" | "mailBanned" | "mailVIP" | "sessions" | "talk" | "prefs" | "profile";

interface PageDef {
  id: PageId;
  icon: string;
  title: () => string;
  /** The band's line; none for pages that draw their own band. */
  subtitle?: () => string;
}

export const FLOW_PAGES: PageDef[] = [
  { id: "dictation", icon: "mic", title: () => t("Dictation") },
  { id: "notes", icon: "record", title: () => t("Notetaker") },
  { id: "insights", icon: "chart", title: () => t("Statistics") },
  { id: "dictionary", icon: "book", title: () => t("Dictionary") },
  { id: "snippets", icon: "bolt", title: () => t("Snippets") },
  { id: "styles", icon: "text", title: () => t("Styles") },
  { id: "flowsettings", icon: "sliders", title: () => t("Settings") },
];

export const NOTCH_PAGES: PageDef[] = [
  { id: "general", icon: "gear", title: () => t("General"), subtitle: () => t("JARVIS, his sounds and how the island behaves.") },
  { id: "pills", icon: "grid", title: () => t("Active pills"), subtitle: () => t("The pills shown in the island, their order and their colours.") },
  { id: "agents", icon: "terminal", title: () => t("Agents"), subtitle: () => t("Claude Code, Codex and the other agents JARVIS follows.") },
  { id: "chat", icon: "chat", title: () => t("Chat"), subtitle: () => t("The AI of the island's chat, with your own keys.") },
  { id: "voice", icon: "wave", title: () => "Hey JARVIS" },
  { id: "integrations", icon: "puzzle", title: () => t("Integrations"), subtitle: () => t("Stripe, GitHub, Vercel, n8n, Notion and the rest.") },
  { id: "phone", icon: "phone", title: () => t("Android phone"), subtitle: () => t("Your agents and their approvals on your Android phone, over your Wi-Fi.") },
  { id: "shortcuts", icon: "keyboard", title: () => t("Shortcuts"), subtitle: () => t("The keys that open the island and its actions.") },
];

/** Mail (classic Outlook): Windows only, Linux has no Outlook. */
export const MAIL_PAGES: PageDef[] = [
  { id: "mail", icon: "calendar", title: () => t("Overview") },
  { id: "mailOverview", icon: "tray", title: () => t("Sorting") },
  { id: "mailRules", icon: "filter", title: () => t("Rules") },
  { id: "mailBanned", icon: "nosign", title: () => t("Banned words") },
  { id: "mailVIP", icon: "star", title: () => t("VIP") },
];

const HOME_PAGE: PageDef = { id: "home", icon: "grid", title: () => t("Home") };
/** The Agents section's first tab: his orbit and the sessions (#65). */
const SESSIONS_PAGE: PageDef = { id: "sessions", icon: "terminal", title: () => t("Sessions") };
/** The JARVIS section's first tab: the listening panel and today's conversation (#67). */
const TALK_PAGE: PageDef = { id: "talk", icon: "wave", title: () => t("Conversation") };
/** Settings (#70): the demo's groups, every setting of the old pages in them. */
const PREFS_PAGE: PageDef = { id: "prefs", icon: "gear", title: () => t("Settings") };
/** Your profile (#104): the first tab of Settings, drawn by pages/profile.ts. */
const PROFILE_PAGE: PageDef = { id: "profile", icon: "person", title: () => t("Profile") };
const ALL = [HOME_PAGE, SESSIONS_PAGE, TALK_PAGE, PROFILE_PAGE, PREFS_PAGE, ...FLOW_PAGES, ...NOTCH_PAGES, ...MAIL_PAGES];
/** Old pages that now live elsewhere: opening one opens its new home (page, and where on it). */
const MOVED: Partial<Record<PageId, [PageId, string]>> = {
  general: ["prefs", "group-general"], pills: ["prefs", "group-island"], shortcuts: ["prefs", "group-shortcuts"],
  agents: ["prefs", "group-agents"], chat: ["prefs", "group-accounts"], phone: ["prefs", "group-phone"],
  voice: ["prefs", "group-voice"], flowsettings: ["prefs", "group-dictation"],
  // Notes (#72): Statistics, Dictionary, Snippets and Styles are on the Dictation page now.
  // Mail (#74): the rules, banned words and VIPs are rows of the Sorting tab now.
  mailRules: ["mailOverview", "mail.rules"], mailBanned: ["mailOverview", "mail.banned"], mailVIP: ["mailOverview", "mail.vip"],
  insights: ["dictation", ""], dictionary: ["dictation", ""], snippets: ["dictation", ""], styles: ["dictation", ""],
};

/** What a page gets to draw itself and reach the rest of the window. */
export interface HubContext {
  status: FlowStatus;
  navigate(page: PageId): void;
  /** Reads the status again (prefs, models) and redraws the sidebar's line. */
  refresh(): Promise<FlowStatus>;
  /** Saves new preferences and keeps them as the window's. */
  setPrefs(change: (p: FlowPrefs) => void): Promise<void>;
  /** The band of a page, its Mochis walking. */
  hero(page: PageId, title: string, subtitle: string | null, actions?: HTMLElement[], compact?: boolean): HTMLElement;
  /** Set by a page: called when the page is left. */
  onLeave?: () => void;
  /** Draws one of the island's settings pages (settings/main.ts) into `container`. */
  notch(page: PageId, container: HTMLElement): Promise<void>;
}

export type FlowPageRenderer = (container: HTMLElement, ctx: HubContext) => void | Promise<void>;

export interface HubOptions {
  version: string;
  flowPages: Partial<Record<PageId, FlowPageRenderer>>;
  /** Draws the island's settings for one of the Notch pages into `container`. */
  renderNotch(page: PageId, container: HTMLElement): Promise<void>;
}

const DEFAULT_STATUS: FlowStatus = {
  prefs: {
    enabled: false, key: "right_ctrl", keyCombo: [], edge: "bottom", hidePill: false, mic: "", keepDays: 30, cleanup: false,
    defaultStyle: "natural", summaryEngine: "claude", openAtLaunch: true, voice: false, voiceOutput: "jarvis", voiceGender: "male", voiceName: "george", geminiVoice: "Charon", geminiFallback: "piper", voiceOnlyMe: false, voiceStrictness: "balanced", muteOthers: true, talkKeys: ["ControlLeft", "MetaLeft"], askKeys: ["ControlLeft", "ShiftLeft", "KeyZ"], moreKeys: ["ShiftLeft", "MetaLeft"], drawModel: "claude:claude-sonnet-5-5",
    oneTapHandsFree: false,
  },
  models: { parakeet: { state: "missing" }, downloadMb: 700 },
  keys: "ok",
  hasClaudeKey: false,
  mics: [],
  platform: navigator.userAgent.includes("Windows") ? "windows" : "linux",
  autostarted: false,
};

export async function startHub(root: HTMLElement, opts: HubOptions) {
  document.body.classList.add("hub-window");
  initTheme();
  // The window is created hidden and only shown and hidden afterwards: its
  // canvases animate only while it is on screen (#792).
  await onEvent<boolean>("hub-visible", setWindowShown);
  // While you dictate: the loudest of the pill's bands.
  await onEvent<number[]>("flow-bands", (bands) => setVoiceLevel(Math.max(0, ...bands)));
  const shown = await FlowBridge.hubShown();
  if (shown !== null) setWindowShown(shown);
  let current: PageId = "home";
  let home: HomeHandle | null = null;
  let activeAnchor: string | null = null;
  let searchHits: SettingsSearchHit[] = [];
  let status: FlowStatus = (await FlowBridge.status()) ?? DEFAULT_STATUS;
  const searchRows = new Map<string, HTMLElement>();
  const statusLine = h("div", { class: "hub-status" });
  const scroll = h("div", { class: "hub-scroll" });
  let rendering = 0;

  const ctx: HubContext = {
    get status() {
      return status;
    },
    navigate: (page) => void show(page),
    refresh: async () => {
      status = (await FlowBridge.status()) ?? status;
      drawStatus();
      return status;
    },
    setPrefs: async (change) => {
      const next = { ...status.prefs };
      change(next);
      status = { ...status, prefs: next };
      drawStatus();
      await FlowBridge.setPrefs(next);
    },
    hero: (page, title, subtitle, actions = [], compact = false) => hero(page, title, subtitle, actions, compact),
    notch: (page, container) => opts.renderNotch(page, container),
  };

  function drawStatus() {
    clear(statusLine);
    const models = status.models.parakeet.state;
    let color = "#6b7079";
    let text: string;
    if (!status.prefs.enabled) {
      text = t("Dictation is off");
    } else if (models !== "ready") {
      color = "#f7b32b";
      text = models === "downloading" ? t("Downloading the voice model…") : t("Download the voice model to dictate");
    } else if (status.keys !== "ok" && status.keys !== "wayland") {
      color = "#f7b32b";
      text = t("Use the pill's microphone to dictate");
    } else {
      color = "#34d399";
      text = t("Ready · hold {0}", { 0: keyLabel(status.keys === "wayland" ? "wayland" : flowKeyId(status.prefs), status.platform) });
    }
    statusLine.append(h("i", { class: "dot", style: `background:${color}` }), h("span", { text }));
  }

  function updateSearchRowHighlights() {
    for (const [id, rowEl] of searchRows) {
      rowEl.classList.toggle("on", id === activeAnchor);
    }
  }

  /** Where to land on a page: an anchor, a label's text, then the group a moved page went to. */
  interface Target { anchor?: string; label?: string; fallback?: string }

  /** The element a target names on the page, or null (yet). */
  function findTarget(root: HTMLElement, t: Target): HTMLElement | null {
    if (t.anchor) {
      const el = root.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(t.anchor)}"]`);
      if (el) return el;
    }
    if (t.label) {
      const want = t.label.trim().toLowerCase();
      const names = root.querySelectorAll<HTMLElement>(".srow .lbl > b, .hub-row .hub-row-title, .hub-row b, label, h3, h4, .jv-srow .lbl b");
      for (const n of names) {
        if ((n.textContent ?? "").trim().toLowerCase() === want) return (n.closest<HTMLElement>(".srow, .hub-row, .row, .jv-srow, section") ?? n);
      }
    }
    if (t.fallback) return root.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(t.fallback)}"]`);
    return null;
  }

  /** Scrolls to the target and lights it softly for a moment (#84: no glow). Parts drawn later are waited for. */
  function landOn(root: HTMLElement, t: Target, token: number) {
    let tries = 0;
    const attempt = () => {
      if (token !== rendering) return;
      const el = findTarget(root, t);
      // The row itself is worth waiting for (Voice and Dictation draw after the page); the group isn't.
      const exact = el && !(t.fallback && el.matches(`[data-anchor="${CSS.escape(t.fallback)}"]`));
      if (!exact && tries++ < 12) { window.setTimeout(attempt, 100); return; }
      if (!el) { scroll.scrollTop = 0; return; }
      // Straight there (a smooth ride down a long Settings page takes seconds); the light marks it.
      const top = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      scroll.scrollTop = Math.max(0, top - scroll.clientHeight / 2 + el.offsetHeight / 2);
      el.classList.remove("jv-lit");
      void el.offsetWidth;
      el.classList.add("jv-lit");
      window.setTimeout(() => el.classList.remove("jv-lit"), 1600);
    };
    attempt();
  }

  const leaveNote = h("div", { class: "jv-toast", role: "status" });
  document.body.append(leaveNote);
  let leaveAt = 0;
  /** Home's scroll when it was left, so coming back lands where you were. */
  let homeScroll = 0;

  async function show(page: PageId, targetAnchor?: string, label?: string, fallback?: string) {
    // A key typed but not saved: the first try to leave says so; leaving again drops it (#84).
    const unsaved = [...(scroll.querySelectorAll?.<HTMLInputElement>('input[type="password"]') ?? [])].find((i) => i.value.trim() && !i.dataset.warned);
    if (unsaved) {
      unsaved.dataset.warned = "1";
      unsaved.focus();
      leaveNote.textContent = t("This key isn't saved yet. Save it, or leave again to drop it.");
      leaveNote.classList.add("on");
      window.clearTimeout(leaveAt);
      leaveAt = window.setTimeout(() => leaveNote.classList.remove("on"), 5000);
      return;
    }
    leaveNote.classList.remove("on");
    const moved = MOVED[page];
    if (moved) return show(moved[0], targetAnchor, label, moved[1] || fallback);
    const def = ALL.find((p) => p.id === page) ?? HOME_PAGE;
    if (current === "home") homeScroll = scroll.scrollTop;
    ctx.onLeave?.();
    ctx.onLeave = undefined;
    current = def.id;
    activeAnchor = targetAnchor ?? null;
    const sec = sectionOf(current);
    for (const [id, el] of rail) el.classList.toggle("on", id === sec.id);
    document.body.classList.toggle("at-home", current === "home");
    // Hidden on Home (redesign.css), so out of reach of Tab and the pointer as well (#84).
    side.inert = current === "home";
    updateSearchRowHighlights();
    const token = ++rendering;
    home?.destroy();
    home = null;
    const page_ = h("div", { class: "hub-page" });
    const renderer = opts.flowPages[def.id];
    if (def.id === "home") {
      home = homePage(ctx, (id) => go(id));
      page_.classList.add("jv-homepage");
      page_.append(home.el);
    } else if (renderer) {
      // #84: each render gets its own context: a page that finishes after you've moved on is
      // cleaned up here, instead of putting its leave hook over the page you're on.
      const pageCtx: HubContext = Object.create(ctx);
      await renderer(page_, pageCtx);
      const leave = Object.prototype.hasOwnProperty.call(pageCtx, "onLeave") ? pageCtx.onLeave : undefined;
      if (token !== rendering) { leave?.(); return; }
      ctx.onLeave = leave;
    } else {
      page_.append(hero(def.id, def.title(), def.subtitle?.() ?? null));
      const container = h("div", { id: "settings-root" });
      page_.append(container);
      await opts.renderNotch(def.id, container);
    }
    if (token !== rendering) return;
    clear(scroll);
    // A section with several pages shows them as tabs at its top.
    const pages = sec.pages.filter((id) => ALL.some((p) => p.id === id));
    if (pages.length > 1) {
      const tabs = h("div", { class: "jv-tabs", role: "tablist" });
      for (const id of pages) {
        const pd = ALL.find((p) => p.id === id)!;
        tabs.append(h("button", { class: id === current ? "on" : "", role: "tab", "aria-selected": String(id === current), text: pd.title(), onclick: () => void show(id) }));
      }
      // The section says its name beside its tabs (#84, N3): with the sidebar folded, nothing else did.
      scroll.append(h("div", { class: "jv-sechead" }, h("h1", { class: "jv-sectitle", text: sec.name() }), tabs));
    }
    scroll.append(page_);
    if (targetAnchor || label || fallback) {
      scroll.scrollTop = 0;
      landOn(page_, { anchor: targetAnchor, label, fallback }, token);
    } else {
      // Back on Home: where you were, not the top (the widgets sit below the greeting).
      scroll.scrollTop = def.id === "home" ? homeScroll : 0;
    }
  }

  // ── The sidebar: a slim pill of line icons that widens over the page on hover (SPEC §4) ──
  const rail = new Map<Section["id"], HTMLElement>();
  const side = h("nav", { class: "jv-rail", "aria-label": "JARVIS" });
  // His visor in this corner is the window's controls (winctl.ts); the sidebar keeps his name beside it.
  side.append(h("div", { class: "jv-rlogo" }, h("span", { class: "jv-rlogo-slot" }), h("span", { class: "n", text: "JARVIS" })));
  /** A section (its first tab), or one page of a section: Home's Dictation opens Notes › Dictation (#84). */
  const go = (id: Section["id"] | PageId) => {
    const sec = SECTIONS.find((x) => x.id === id);
    void show(sec ? sec.pages[0] : (id as PageId));
  };
  const railItem = (sec: Section) => {
    const g = h("span", { class: "g", style: `--c:${sec.color}` });
    g.append(sectionIcon(sec.id, 19));
    const b = h("button", { class: "jv-ri", title: sec.name(), "aria-label": sec.name(), onclick: () => go(sec.id) }, g, h("span", { class: "n", text: sec.name() }));
    rail.set(sec.id, b);
    return b;
  };
  for (const sec of SECTIONS) {
    if (sec.id === "settings" || (sec.windowsOnly && status.platform !== "windows")) continue;
    side.append(railItem(sec));
  }
  // You, where Settings was (#104, as in Claude's app): your photo, and your name when it widens.
  const meName = h("b", { text: "" }), mePhoto = h("span", { class: "g jv-me-g" }), meSub = h("span", { text: t("Profile · Settings") });
  const meItem = h("button", { class: "jv-ri jv-me", title: t("Profile · Settings"), "aria-label": t("Profile · Settings"), onclick: () => go("settings") },
    mePhoto, h("span", { class: "n jv-me-n" }, meName, meSub));
  rail.set("settings", meItem);
  const drawMe = async () => {
    const me = await Bridge.profileGet();
    meName.textContent = me?.name?.trim() || t("You");
    mePhoto.replaceChildren(photo(me?.photo));
  };
  void drawMe();
  void onEvent("profile-changed", () => void drawMe());
  side.append(h("div", { class: "spacer" }), meItem, statusLine);
  // #84, hover intent (docs/jarvis/design/UX-PRINCIPLES.md H1, H2): it opens when the pointer
  // RESTS on it (no move for 300 ms), never as it crosses on its way to the window's edge or
  // overshoots a tab by a few pixels. Leaving towards the page closes it at once, so it never
  // covers what you're reaching for; leaving any other way waits 350 ms, so a slip doesn't shut
  // it. From the keyboard, at once.
  const REST_MS = 300, GRACE_MS = 350;
  let rest = 0, grace = 0;
  const openRail = () => { window.clearTimeout(rest); window.clearTimeout(grace); side.classList.add("open"); };
  const closeRail = () => { window.clearTimeout(rest); window.clearTimeout(grace); side.classList.remove("open"); };
  side.addEventListener("pointermove", () => {
    window.clearTimeout(grace);
    window.clearTimeout(rest);
    if (!side.classList.contains("open")) rest = window.setTimeout(openRail, REST_MS);
  });
  side.addEventListener("pointerleave", (e) => {
    window.clearTimeout(rest);
    if (!side.classList.contains("open")) return;
    // Up into his visor and the window's dots while they're out: the sidebar stays (winctl.ts closes both).
    if ((e.relatedTarget as Element | null)?.closest?.(".jv-wc.open")) return;
    const intoPage = e.clientX >= side.getBoundingClientRect().right - 2;
    window.clearTimeout(grace);
    if (intoPage) closeRail();
    else grace = window.setTimeout(closeRail, GRACE_MS);
  });
  side.addEventListener("focusin", openRail);
  side.addEventListener("focusout", () => { if (!side.matches(":focus-within")) closeRail(); });

  // Keys (#84, N4): Esc closes what's open (the sidebar, then a sub-page through its Back link);
  // Alt+Left goes back the same way; Ctrl+, opens Settings.
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
    const back = () => {
      const b = [...scroll.querySelectorAll<HTMLElement>(".back")].find((x) => x.offsetParent !== null);
      if (b) { b.click(); return true; }
      return false;
    };
    if (e.key === "Escape" && !typing) {
      if (side.classList.contains("open")) { closeRail(); (document.activeElement as HTMLElement | null)?.blur?.(); return; }
      if (back()) e.preventDefault();
    } else if (e.altKey && e.key === "ArrowLeft") {
      if (back()) e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      void show("prefs");
    }
  });

  // Settings search: Ctrl K anywhere in the window.
  const searchInput = h("input", {
    class: "hub-search-input",
    type: "text",
    placeholder: t("Search settings"),
    spellcheck: "false",
  }) as HTMLInputElement;

  const searchClear = h("button", {
    class: "hub-search-clear",
    title: t("Close"),
    style: "display:none",
  }, icon("x"));

  const searchBox = h("div", { class: "hub-search" },
    icon("search"),
    searchInput,
    searchClear,
    h("span", { class: "jv-kc", text: "Ctrl K" }),
  );
  searchBox.querySelector("svg")?.classList.add("hub-search-icon");
  const resultsContainer = h("div", { class: "hub-search-results", style: "display:none" });
  const searchPop = h("div", { class: "jv-searchpop", role: "dialog", "aria-label": t("Search settings") }, searchBox, resultsContainer);
  const searchVeil = h("div", { class: "jv-veil", onclick: () => closeSearch() }, searchPop);
  searchPop.addEventListener("click", (e) => e.stopPropagation());
  const openSearch = () => {
    searchVeil.classList.add("on");
    searchInput.focus();
    searchInput.select();
  };
  const closeSearch = () => {
    searchVeil.classList.remove("on");
    searchInput.value = "";
    renderSearchResults();
  };
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (searchVeil.classList.contains("on")) closeSearch();
      else openSearch();
    }
  });

  let searchSel = 0;
  function lightSearchRow() {
    [...resultsContainer.querySelectorAll<HTMLElement>(".hub-search-row")].forEach((r, i) => {
      r.classList.toggle("sel", i === searchSel);
      if (i === searchSel) r.scrollIntoView({ block: "nearest" });
    });
  }
  /** Opens a result: its page, landing on its row (the matched label, else its title), else its group. */
  function openHit(hit: SettingsSearchHit) {
    closeSearch();
    void show(hit.entry.page, undefined, hit.label ?? t(hit.entry.title), hit.entry.group);
  }

  function renderSearchResults() {
    searchSel = 0;
    clear(resultsContainer);
    searchRows.clear();
    const query = searchInput.value.trim();
    if (!query) {
      searchClear.style.display = "none";
      resultsContainer.style.display = "none";
      searchHits = [];
      return;
    }
    searchClear.style.display = "";
    resultsContainer.style.display = "";
    searchHits = searchSettings(query, (pageId) => ALL.find((p) => p.id === pageId)?.title() ?? pageId);
    if (searchHits.length === 0) {
      resultsContainer.append(h("div", { class: "hub-search-empty", text: t("No setting found") }));
      return;
    }
    for (const hit of searchHits) {
      const pageDef = ALL.find((p) => p.id === hit.entry.page);
      const row = h("button", { class: "hub-search-row" });
      if (activeAnchor === hit.entry.id && current === hit.entry.page) {
        row.classList.add("on");
      }
      row.append(icon(pageDef?.icon ?? "sliders"));
      const textContainer = h("div", { class: "hub-search-row-text" });
      const rowTitle = h("div", { class: "hub-search-row-title", text: hit.label ?? t(hit.entry.title) });
      // Where it lives today: "Settings › Notch", "Mail › Sorting", then the box when a label matched.
      const place = [pageDef?.title() ?? "", hit.entry.where ? t(hit.entry.where) : ""].filter(Boolean).join(" › ");
      const rowSubtitle = h("div", {
        class: "hub-search-row-subtitle",
        // The box's name, unless the place already ends with it ("Settings › Shortcuts", not "… › Shortcuts › Shortcuts").
        text: hit.label && t(hit.entry.title) !== (hit.entry.where ? t(hit.entry.where) : "") ? `${place} › ${t(hit.entry.title)}` : place,
      });
      textContainer.append(rowTitle, rowSubtitle);
      row.append(textContainer);
      row.addEventListener("click", () => openHit(hit));
      searchRows.set(hit.entry.id, row);
      resultsContainer.append(row);
    }
    lightSearchRow();
  }

  searchInput.addEventListener("input", renderSearchResults);
  // Arrow keys move through the results, Enter opens the one lit (#84).
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearch();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!searchHits.length) return;
      e.preventDefault();
      searchSel = (searchSel + (e.key === "ArrowDown" ? 1 : -1) + searchHits.length) % searchHits.length;
      lightSearchRow();
    } else if (e.key === "Enter") {
      const hit = searchHits[searchSel] ?? searchHits[0];
      if (hit) openHit(hit);
    }
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    renderSearchResults();
    searchInput.focus();
  });

  onLanguageChange(() => {
    searchInput.placeholder = t("Search settings");
    if (searchInput.value.trim()) renderSearchResults();
  });

  statusLine.title = `JARVIS ${opts.version}`;

  clear(root);
  const panel = h("main", { class: "hub-panel" }, scroll);
  root.append(side, panel, searchVeil, windowControls());
  drawStatus();
  await show(current);

  void onEvent<string>("hub-page", (page) => {
    const id = (page === "settings" ? "flowsettings" : page) as PageId;
    if (ALL.some((p) => p.id === id)) void show(id);
  });
  void onEvent<FlowPrefs>("flow-prefs", (prefs) => {
    status = { ...status, prefs };
    drawStatus();
  });
  void onEvent<ModelsStatus>("speech-models", (models) => {
    status = { ...status, models };
    drawStatus();
  });
  return {
    redraw: () => {
      for (const sec of SECTIONS) {
        const b = rail.get(sec.id);
        if (!b) continue;
        // You (#104): your name stays; the line under it and its label follow the language.
        if (b.classList.contains("jv-me")) {
          b.title = t("Profile · Settings");
          b.setAttribute("aria-label", t("Profile · Settings"));
          meSub.textContent = t("Profile · Settings");
          continue;
        }
        b.title = sec.name();
        b.setAttribute("aria-label", sec.name());
        (b.querySelector(".n") as HTMLElement).textContent = sec.name();
      }
      drawStatus();
      void show(current);
    },
    current: () => current,
  };
}
