// The Coucou window: a sidebar with Flow (dictation, the Notetaker, the
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
import { onEvent } from "../core/bridge";
import { FlowBridge, type FlowPrefs, type FlowStatus, type ModelsStatus, flowKeyId } from "../core/flow";
import { hero, setVoiceLevel, setWindowShown } from "./hero";
import { icon, keyLabel } from "./ui";
import { searchSettings, type SettingsSearchHit } from "./search";

export type PageId =
  | "home" | "dictation" | "notes" | "insights" | "dictionary" | "snippets" | "styles" | "flowsettings"
  | "general" | "pills" | "agents" | "chat" | "voice" | "integrations" | "phone" | "shortcuts"
  | "mailOverview" | "mailRules" | "mailBanned" | "mailVIP" | "sessions" | "talk" | "prefs";

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
  { id: "general", icon: "gear", title: () => t("General"), subtitle: () => t("Mochi, his sounds and how the island behaves.") },
  { id: "pills", icon: "grid", title: () => t("Active pills"), subtitle: () => t("The pills shown in the island, their order and their colours.") },
  { id: "agents", icon: "terminal", title: () => t("Agents"), subtitle: () => t("Claude Code, Codex and the other agents Mochi follows.") },
  { id: "chat", icon: "chat", title: () => t("Chat"), subtitle: () => t("The AI of the island's chat, with your own keys.") },
  { id: "voice", icon: "wave", title: () => "Hey JARVIS" },
  { id: "integrations", icon: "puzzle", title: () => t("Integrations"), subtitle: () => t("Stripe, GitHub, Vercel, n8n, Notion and the rest.") },
  { id: "phone", icon: "phone", title: () => t("Android phone"), subtitle: () => t("Your agents and their approvals on your Android phone, over your Wi-Fi.") },
  { id: "shortcuts", icon: "keyboard", title: () => t("Shortcuts"), subtitle: () => t("The keys that open the island and its actions.") },
];

/** Mail (classic Outlook): Windows only, Linux has no Outlook. */
export const MAIL_PAGES: PageDef[] = [
  { id: "mailOverview", icon: "tray", title: () => t("Overview") },
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
const ALL = [HOME_PAGE, SESSIONS_PAGE, TALK_PAGE, PREFS_PAGE, ...FLOW_PAGES, ...NOTCH_PAGES, ...MAIL_PAGES];
/** Old pages that now live elsewhere: opening one opens its new home (page, and where on it). */
const MOVED: Partial<Record<PageId, [PageId, string]>> = {
  general: ["prefs", "group-general"], pills: ["prefs", "group-island"], shortcuts: ["prefs", "group-shortcuts"],
  agents: ["prefs", "group-agents"], chat: ["prefs", "group-accounts"], phone: ["prefs", "group-phone"],
  voice: ["prefs", "group-voice"], flowsettings: ["prefs", "group-dictation"],
  // Notes (#72): Statistics, Dictionary, Snippets and Styles are on the Dictation page now.
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

  async function show(page: PageId, targetAnchor?: string) {
    const moved = MOVED[page];
    if (moved) return show(moved[0], targetAnchor ?? (moved[1] || undefined));
    const def = ALL.find((p) => p.id === page) ?? HOME_PAGE;
    ctx.onLeave?.();
    ctx.onLeave = undefined;
    current = def.id;
    activeAnchor = targetAnchor ?? null;
    const sec = sectionOf(current);
    for (const [id, el] of rail) el.classList.toggle("on", id === sec.id);
    document.body.classList.toggle("at-home", current === "home");
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
      await renderer(page_, ctx);
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
      scroll.append(tabs);
    }
    scroll.append(page_);
    if (targetAnchor) {
      const el = page_.querySelector(`[data-anchor="${targetAnchor}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("hub-card-glowing");
        void el.offsetWidth;
        el.classList.add("hub-card-glowing");
      } else {
        scroll.scrollTop = 0;
      }
    } else {
      scroll.scrollTop = 0;
    }
  }

  // ── The sidebar: a slim pill of line icons that widens over the page on hover (SPEC §4) ──
  const rail = new Map<Section["id"], HTMLElement>();
  const side = h("nav", { class: "jv-rail", "aria-label": "JARVIS" });
  // His visor in this corner is the window's controls (winctl.ts); the sidebar keeps his name beside it.
  side.append(h("div", { class: "jv-rlogo" }, h("span", { class: "jv-rlogo-slot" }), h("span", { class: "n", text: "JARVIS" })));
  const go = (id: Section["id"]) => {
    const sec = SECTIONS.find((x) => x.id === id) ?? SECTIONS[0];
    void show(sec.pages[0]);
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
  side.append(h("div", { class: "spacer" }), railItem(SECTIONS.find((x) => x.id === "settings")!), statusLine);
  // It opens as soon as the pointer settles on it, not as it flies across on its way to the
  // screen's edge: a slow move inside opens it at once, a pointer that stops opens it after a
  // blink (90 ms); one that crosses fast has left before either. From the keyboard, at once.
  const SETTLE_MS = 90, SLOW = 0.5; // px per ms
  let settle = 0;
  let last: { x: number; y: number; t: number } | null = null;
  const openRail = () => { window.clearTimeout(settle); side.classList.add("open"); };
  side.addEventListener("pointerenter", (e) => {
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    settle = window.setTimeout(openRail, SETTLE_MS);
  });
  side.addEventListener("pointermove", (e) => {
    const now = performance.now();
    if (last && now > last.t) {
      const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / (now - last.t);
      if (speed < SLOW) openRail();
      else { window.clearTimeout(settle); settle = window.setTimeout(openRail, SETTLE_MS); }
    }
    last = { x: e.clientX, y: e.clientY, t: now };
  });
  side.addEventListener("pointerleave", (e) => {
    window.clearTimeout(settle);
    last = null;
    // Up into his visor and the window's dots: the sidebar stays open (winctl.ts closes it with them).
    if ((e.relatedTarget as Element | null)?.closest?.(".jv-winctl")) return;
    side.classList.remove("open");
  });
  side.addEventListener("focusin", () => side.classList.add("open"));
  side.addEventListener("focusout", () => { if (!side.matches(":focus-within")) side.classList.remove("open"); });

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

  function renderSearchResults() {
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
      const rowSubtitle = h("div", {
        class: "hub-search-row-subtitle",
        text: hit.label
          ? `${pageDef?.title() ?? ""} › ${t(hit.entry.title)}`
          : (pageDef?.title() ?? ""),
      });
      textContainer.append(rowTitle, rowSubtitle);
      row.append(textContainer);
      row.addEventListener("click", () => {
        closeSearch();
        void show(hit.entry.page, hit.entry.id);
      });
      searchRows.set(hit.entry.id, row);
      resultsContainer.append(row);
    }
  }

  searchInput.addEventListener("input", renderSearchResults);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearch();
    } else if (e.key === "Enter") {
      if (searchHits.length > 0) {
        const first = searchHits[0].entry;
        closeSearch();
        void show(first.page, first.id);
      }
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
