// The front page (#59, prototypes/jarvis-front.html: design A, dots 2, bar 2), by Apple's rules:
// JARVIS large and alone on a faint dot texture, the greeting and the date under him; at the
// bottom a floating glass tab bar (five tabs or fewer, filled symbols, one-word labels, the page
// you are on in a tinted pill) with "Ask JARVIS" docked beside it, as iOS places Search;
// Connections and Settings as two round glass buttons at the top right.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge } from "../core/bridge";
import type { HubContext } from "./shell";
import { visor } from "../theme/theme";
import type { Section } from "./sections";

/** The squares' line icons, on a 24×24 grid. */
const DOCK_ICONS: Record<string, string> = {
  jarvis: "M3 12h2l2-6 4 12 3-9 2 5h5",
  agents: "M4 17l6-5-6-5M12 19h8",
  windows: "M3 4h18v16H3zM3 9h18",
  notes: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  mail: "M3 5h18v14H3zM3 7l9 6 9-6",
  connections: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  home: "M4 11l8-7 8 7M6 10v10h12V10",
  // At a glance's own (jarvis-home.html): the plan's half-filled circle, the Notetaker's record dot.
  plan: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 4a8 8 0 0 1 8 8h-8z",
  notetaker: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
};

export function sectionIcon(id: string, size = 24): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", DOCK_ICONS[id] ?? "");
  svg.append(p);
  return svg;
}

/** Filled symbols for the tab bar and the toolbar (HIG: "prefer filled symbols"), on a 24×24 grid, even-odd cut-outs. */
const FILLED: Record<string, string> = {
  home: "M12 3.2 2.8 11a1 1 0 0 0 1.3 1.5L5 11.8V19a2 2 0 0 0 2 2h3.2v-5.2a1.8 1.8 0 0 1 3.6 0V21H17a2 2 0 0 0 2-2v-7.2l.9.7A1 1 0 0 0 21.2 11z",
  jarvis: "M6.5 5h11A4.5 4.5 0 0 1 22 9.5v5a4.5 4.5 0 0 1-4.5 4.5h-11A4.5 4.5 0 0 1 2 14.5v-5A4.5 4.5 0 0 1 6.5 5zM8 10.6a1.4 1.4 0 0 0 0 2.8h8a1.4 1.4 0 0 0 0-2.8z",
  agents: "M5 3h14a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm1.7 5.3a1 1 0 0 0-.4 1.4L8.4 12l-2.1 2.3a1 1 0 0 0 1.4 1.4l2.8-3a1 1 0 0 0 0-1.4l-2.8-3a1 1 0 0 0-1 0zM12 14.5a1 1 0 0 0 0 2h5a1 1 0 0 0 0-2z",
  notes: "M12 2a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-7 0v-6A3.5 3.5 0 0 1 12 2zM5.5 10.5a1 1 0 0 1 1 1 5.5 5.5 0 0 0 11 0 1 1 0 1 1 2 0 7.5 7.5 0 0 1-6.5 7.4V21a1 1 0 1 1-2 0v-2.1a7.5 7.5 0 0 1-6.5-7.4 1 1 0 0 1 1-1z",
  mail: "M4 5h16a2 2 0 0 1 2 2v.4l-10 6.1L2 7.4V7a2 2 0 0 1 2-2zm-2 4.7 9.5 5.8a1 1 0 0 0 1 0L22 9.7V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z",
  connections: "M8.5 2.5a1 1 0 0 1 1 1V7h5V3.5a1 1 0 1 1 2 0V7H18a1 1 0 0 1 1 1v3.5a6 6 0 0 1-6 6v3a1 1 0 1 1-2 0v-3a6 6 0 0 1-6-6V8a1 1 0 0 1 1-1h1.5V3.5a1 1 0 0 1 1-1z",
  settings: "M10.3 2h3.4l.5 2.6a7.6 7.6 0 0 1 1.8 1l2.5-.9 1.7 2.9-2 1.8a7.7 7.7 0 0 1 0 2.1l2 1.8-1.7 2.9-2.5-.9a7.6 7.6 0 0 1-1.8 1l-.5 2.7h-3.4l-.5-2.7a7.6 7.6 0 0 1-1.8-1l-2.5.9-1.7-2.9 2-1.8a7.7 7.7 0 0 1 0-2.1l-2-1.8 1.7-2.9 2.5.9a7.6 7.6 0 0 1 1.8-1zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
};

function filledIcon(id: string, size: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", FILLED[id] ?? "");
  p.setAttribute("fill-rule", "evenodd");
  svg.append(p);
  return svg;
}

/**
 * The tab bar: five tabs (HIG: "a default list of five or fewer"). Voice and His windows are
 * both him, so one JARVIS tab; Connections and Settings sit at the top right instead.
 */
const TABS: { id: Section["id"]; name: () => string }[] = [
  { id: "home", name: () => t("Home") },
  { id: "jarvis", name: () => "JARVIS" },
  { id: "agents", name: () => t("Agents") },
  { id: "notes", name: () => t("Dictation") },
  { id: "mail", name: () => "Mail" },
];

/**
 * "At a glance, sir." (step 1 of #57): one Apple-style widget per section under the front page,
 * one to one with jarvis-home.html's bento: 4 columns, 190 px rows, 16 px gaps, radius 26; each
 * headed by its coloured icon, its name and ›, and opening its section. Their insides come one by
 * one in the next steps.
 */
const GLANCE: { id: string; name: () => string; color: string; to: Section["id"] | null; size: "wide" | "big" | "small" }[] = [
  { id: "agents", name: () => t("Agents"), color: "#30d158", to: "agents", size: "big" },
  { id: "jarvis", name: () => "JARVIS", color: "#bf5af2", to: "jarvis", size: "wide" },
  { id: "plan", name: () => t("Claude plan"), color: "#3a3a3c", to: null, size: "small" },
  { id: "notetaker", name: () => t("Notetaker"), color: "#ff453a", to: "notes", size: "small" },
  { id: "mail", name: () => "Mail", color: "#0a84ff", to: "mail", size: "wide" },
  { id: "notes", name: () => t("Dictation"), color: "#ff9f0a", to: "notes", size: "wide" },
  { id: "windows", name: () => t("His windows"), color: "#5e5ce6", to: "jarvis", size: "wide" },
  { id: "connections", name: () => t("Connections"), color: "#64d2ff", to: "connections", size: "wide" },
];

/** The widgets, each with an empty body (`data-body`) for its step to fill. */
export function glance(go: (section: Section["id"]) => void): HTMLElement {
  const bento = h("div", { class: "jv-bento" });
  for (const w of GLANCE) {
    const ic = h("span", { class: "ic" }, sectionIcon(w.id, 14));
    ic.style.background = w.color;
    const head = h("div", { class: "jv-wh" }, ic, h("span", { text: w.name() }), ...(w.to ? [h("span", { class: "go", text: "›" })] : []));
    const card = h("div", { class: `jv-w ${w.size}`, "data-widget": w.id }, head, h("div", { class: "jv-wbody", "data-body": w.id }));
    if (w.to) {
      const to = w.to;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.classList.add("opens");
      card.addEventListener("click", () => go(to));
      card.addEventListener("keydown", (e) => { if (e.key === "Enter") go(to); });
    }
    bento.append(card);
  }
  return h("div", { class: "jv-glance" },
    h("div", { class: "jv-glance-h" },
      h("p", { class: "t" }, document.createTextNode(`${t("At a glance,")} `), h("span", { text: t("sir.") })),
      h("p", { class: "s", text: t("Everything in one place. Press a widget to open it.") })),
    bento);
}

function greeting(now = new Date()): string {
  const hr = now.getHours();
  return hr < 12 ? t("Good morning,") : hr < 18 ? t("Good afternoon,") : t("Good evening,");
}

export interface HomeHandle {
  el: HTMLElement;
  destroy(): void;
}

export function homePage(ctx: HubContext, go: (section: Section["id"]) => void): HomeHandle {
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const hero = h("section", { class: "jv-hero" },
    h("div", { class: "jv-center" },
      h("span", { class: "jv-him" }, visor(190)),
      h("p", { class: "jv-h1" }, document.createTextNode(`${greeting()} `), h("span", { text: t("sir.") })),
      h("p", { class: "jv-sub", text: date })),
  );
  const below = h("section", { class: "jv-below" }, glance(go));
  const el = h("div", { class: "jv-home" }, h("div", { class: "jv-dots", "aria-hidden": "true" }), hero, below);

  // The control layer, floating over the page (fixed, so it stays while you scroll).
  const tabs = h("nav", { class: "jv-tabbar", "aria-label": t("Home") });
  for (const tab of TABS) {
    if (tab.id === "mail" && ctx.status.platform !== "windows") continue;
    const on = tab.id === "home";
    const b = h("button", { class: `jv-tab${on ? " on" : ""}`, "aria-current": on ? "page" : "false", onclick: () => { if (!on) go(tab.id); } },
      filledIcon(tab.id, 24), h("span", { text: tab.name() }));
    tabs.append(b);
  }
  const talk = h("span", { class: "talk" }, sectionIcon("jarvis", 20));
  const ask = h("button", { class: "jv-askdock", onclick: () => void Bridge.askOpen() }, h("span", { class: "q", text: t("Ask JARVIS anything") }), talk);
  const bottom = h("div", { class: "jv-bottom" }, tabs, ask);
  const tool = (id: "connections" | "settings", name: string) =>
    h("button", { class: "jv-tool", title: name, "aria-label": name, onclick: () => go(id) }, filledIcon(id, 17));
  const tools = h("div", { class: "jv-tools" }, tool("connections", t("Connections")), tool("settings", t("Settings")));
  document.body.append(bottom, tools);

  return {
    el,
    destroy() {
      bottom.remove();
      tools.remove();
    },
  };
}
