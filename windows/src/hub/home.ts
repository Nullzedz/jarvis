// The front page (docs/jarvis/design/SPEC.md §5): "Good evening, sir.", the date and
// status line, the "Ask JARVIS anything" pill and the dock of seven coloured squares.
// Scrolling, the squares glide up and shrink into the pinned top bar.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge } from "../core/bridge";
import type { HubContext } from "./shell";
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

/** The dock: the six sections and Settings, with Windows between Agents and Dictation. */
const DOCK: { id: string; name: () => string; color: string; to: Section["id"] }[] = [
  { id: "jarvis", name: () => t("Voice"), color: "#bf5af2", to: "jarvis" },
  { id: "agents", name: () => t("Agents"), color: "#30d158", to: "agents" },
  // "Windows" alone would read as the operating system: his explanation windows.
  { id: "windows", name: () => t("His windows"), color: "#5e5ce6", to: "jarvis" },
  { id: "notes", name: () => t("Dictation"), color: "#ff9f0a", to: "notes" },
  { id: "mail", name: () => "Mail", color: "#0a84ff", to: "mail" },
  { id: "connections", name: () => t("Connections"), color: "#64d2ff", to: "connections" },
  { id: "settings", name: () => t("Settings"), color: "#3a3a3c", to: "settings" },
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

const KEY_NAMES: Record<string, string> = { Control: "Ctrl", Shift: "⇧", Meta: "Win", Alt: "Alt" };
/** ["ControlLeft", "ShiftLeft", "KeyZ"] → "Ctrl ⇧ Z". */
export function chordLabel(codes: string[] | undefined): string {
  return (codes ?? [])
    .map((c) => {
      const side = c.replace(/(Left|Right)$/, "");
      if (KEY_NAMES[side]) return KEY_NAMES[side];
      if (c.startsWith("Key")) return c.slice(3);
      if (c.startsWith("Digit")) return c.slice(5);
      return c;
    })
    .join(" ");
}

function greeting(now = new Date()): string {
  const hr = now.getHours();
  return hr < 12 ? t("Good morning,") : hr < 18 ? t("Good afternoon,") : t("Good evening,");
}

/** What the line under the greeting says: today, and how dictation is. */
function statusLine(ctx: HubContext): string {
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const s = ctx.status;
  const flow = !s.prefs.enabled ? t("Dictation is off") : s.models.parakeet.state === "ready" ? t("Dictation ready") : t("Voice model not downloaded");
  return `${date} · ${flow}`;
}

export interface HomeHandle {
  el: HTMLElement;
  /** Places the squares again (after a resize, or when the page is shown). */
  layout(): void;
  /** The squares follow the page's scroll. */
  onScroll(): void;
  destroy(): void;
}

export function homePage(ctx: HubContext, scroller: HTMLElement, go: (section: Section["id"]) => void): HomeHandle {
  const mic = h("button", { class: "jv-mic", "aria-label": t("Ask JARVIS anything"), onclick: () => void Bridge.askOpen() });
  mic.append(sectionIcon("jarvis", 18));
  const ask = h("button", { class: "jv-ask", onclick: () => void Bridge.askOpen() },
    h("span", { class: "jv-spark", text: "✦" }),
    h("span", { class: "q", text: t("Ask JARVIS anything") }),
    h("span", { class: "jv-kc", text: chordLabel(ctx.status.prefs.askKeys) }),
  );
  const askRow = h("div", { class: "jv-askrow" }, ask, mic);
  const dock = h("div", { class: "jv-dock" });
  for (const d of DOCK) {
    // The name here only holds the dock's spacing; the visible one rides with its square.
    const name = h("span", { class: "nm", text: d.name() });
    dock.append(h("span", { class: "jv-app" }, h("span", { class: "slot", "data-slot": d.id }), name));
  }

  const center = h("div", { class: "jv-center" },
    h("p", { class: "jv-h1" }, document.createTextNode(`${greeting()} `), h("span", { text: t("sir.") })),
    h("p", { class: "jv-sub", text: statusLine(ctx) }),
    askRow,
  );
  const hero = h("section", { class: "jv-hero" },
    // The top-left corner belongs to his visor, the window's controls (winctl.ts).
    h("div", { class: "jv-top" }),
    center,
    dock,
    h("div", { class: "jv-chev", text: "⌄" }),
  );
  const below = h("section", { class: "jv-below" }, glance(go));
  const el = h("div", { class: "jv-home" }, hero, below);

  // The pinned bar, and the seven squares in one fixed layer that glide between the dock and it.
  const pins = h("span", { class: "jv-pins" });
  for (const d of DOCK) pins.append(h("span", { "data-pin": d.id }));
  const pinMic = h("button", { class: "jv-askmini", onclick: () => void Bridge.askOpen() }, h("span", { text: t("Ask") }));
  const pinbar = h("div", { class: "jv-pinbar" }, h("div", { class: "in" }, h("span", { class: "jv-brand jv-pinbrand", text: "JARVIS" }), pins, pinMic));
  const flyers = h("div", { class: "jv-flyers" });
  // Each name rides under its own square, so the squares never glide over text.
  const riders: HTMLElement[] = [];
  const squares = DOCK.map((d) => {
    const b = h("button", { class: "jv-sq", title: d.name(), "aria-label": d.name(), style: `background:${d.color}`, onclick: () => go(d.to) });
    const name = h("span", { class: "jv-sqname", text: d.name() });
    riders.push(name);
    b.append(sectionIcon(d.id), name);
    flyers.append(b);
    return b;
  });
  document.body.append(pinbar, flyers);

  let from: { x: number; y: number; s: number }[] = [];
  let to: { x: number; y: number; s: number }[] = [];
  const START = 150, RUN = 170; // the glide starts 150 px from the top and takes 170 px of scrolling
  const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

  function layout() {
    const y = scroller.scrollTop;
    const box = (q: Element | null) => q?.getBoundingClientRect?.();
    from = DOCK.map((d) => { const r = box(el.querySelector(`[data-slot="${d.id}"]`)); return r ? { x: r.left, y: r.top + y, s: r.width } : null; }).filter((r) => r !== null);
    to = DOCK.map((d) => { const r = box(pins.querySelector(`[data-pin="${d.id}"]`)); return r ? { x: r.left, y: r.top, s: r.width } : null; }).filter((r) => r !== null);
    if (from.length !== DOCK.length || to.length !== DOCK.length) return;
    onScroll();
  }
  function onScroll() {
    const y = scroller.scrollTop;
    let k = 0;
    squares.forEach((b, i) => {
      const f = from[i], tt = to[i];
      if (!f || !tt) return;
      const natural = f.y - y;
      k = Math.min(1, Math.max(0, (START - natural) / RUN));
      const e = ease(k);
      const size = f.s + (tt.s - f.s) * e;
      b.style.width = b.style.height = `${size}px`;
      b.style.transform = `translate(${f.x + (tt.x - f.x) * e}px, ${k === 0 ? natural : START + (tt.y - START) * e}px)`;
    });
    pinbar.classList.toggle("on", k > 0.55);
    // Each name fades as its square lifts off and shrinks into the bar, and the
    // greeting fades as it nears the bar, so nothing glides over text.
    for (const n of riders) n.style.opacity = String(Math.max(0, 1 - k * 3));
    const top = (center.firstElementChild as HTMLElement | null)?.getBoundingClientRect?.().top ?? 999;
    center.style.opacity = String(Math.min(1, Math.max(0, (top - 60) / 140)));
  }
  const onResize = () => layout();
  window.addEventListener?.("resize", onResize);
  // The first measure can come before the window has its size or its fonts: measure again whenever the page moves.
  const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;
  watch?.observe(el);
  void document.fonts?.ready.then(() => layout());
  return {
    el,
    layout,
    onScroll,
    destroy() {
      window.removeEventListener?.("resize", onResize);
      watch?.disconnect();
      pinbar.remove();
      flyers.remove();
    },
  };
}

