// The window has no title bar (SPEC: "just the app"). Its controls live at JARVIS's
// visor in the top-left corner: bring the pointer near the top and three dots slide
// out from behind him — close, minimise, full screen, as Apple's traffic lights — while he glances at them.
// Drag the window by his visor or the top edge; double-click him to fill the screen.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge } from "../core/bridge";
import { visor } from "../theme/theme";

// Where the dots come out: his visor itself (28 px in, 36 px wide), with a little margin, so the
// section tabs just right of it (Sessions…) never open them on the way past.
const NEAR_TOP = 64; // px from the top
const CORNER_W = 76; // px from the left

export function windowControls(): HTMLElement {
  const face = visor(36);
  face.classList.add("jv-wc-face");
  // Apple's traffic lights, in Apple's order: close red, minimise yellow, maximise green. On hover
  // each shows its symbol, drawn (#84): a typed × or − sits on the font's baseline, off-centre.
  const SYMBOL: Record<string, string> = { close: "M2 2l4 4M6 2L2 6", min: "M1.6 4h4.8", max: "M4 1.6v4.8M1.6 4h4.8" };
  const dot = (cls: string, label: string, action: "minimize" | "maximize" | "close") => {
    const b = h("button", { class: `jv-dot ${cls}`, title: label, "aria-label": label, onclick: () => void Bridge.hubWindow(action) });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 8 8");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", SYMBOL[cls]);
    svg.append(path);
    b.append(svg);
    return b;
  };
  const dots = h("div", { class: "jv-dots" },
    dot("close", t("Close"), "close"),
    dot("min", t("Minimize"), "minimize"),
    // It maximises the window (lib.rs hub_window), so it says so.
    dot("max", t("Maximize"), "maximize"),
  );
  const wc = h("div", { class: "jv-wc" }, face, dots);
  const edge = h("div", { class: "jv-dragedge" });

  const drag = (e: MouseEvent) => {
    if (e.button !== 0 || e.detail > 1) return;
    e.preventDefault();
    void Bridge.hubWindow("drag");
  };
  face.addEventListener("mousedown", drag);
  edge.addEventListener("mousedown", drag);
  face.addEventListener("dblclick", () => void Bridge.hubWindow("maximize"));
  edge.addEventListener("dblclick", () => void Bridge.hubWindow("maximize"));

  const open = (on: boolean) => {
    if (on) {
      wc.classList.add("open");
      document.body.classList.add("wc-open");
    } else {
      // At once: the same move that takes the pointer off the sidebar closes them both.
      wc.classList.remove("open");
      document.body.classList.remove("wc-open");
      // The sidebar they kept open closes with them, unless the pointer is on it.
      const r = rail();
      if (r && !r.matches(":hover")) r.classList.remove("open");
    }
  };
  const rail = () => document.querySelector(".jv-rail");
  // They open the moment the pointer is on his visor itself (only there: the corner around him
  // and the tabs beside it never open them). Once open, the dots, him or the sidebar keep them.
  const onFace = (x: number, y: number) => {
    const r = face.getBoundingClientRect();
    return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4 && y < NEAR_TOP && x < CORNER_W;
  };
  window.addEventListener?.("mousemove", (e) => {
    const isOpen = wc.classList.contains("open");
    if (isOpen) {
      const keep = onFace(e.clientX, e.clientY) || wc.matches(":hover") || !!rail()?.matches(":hover");
      if (!keep) open(false);
      return;
    }
    if (!onFace(e.clientX, e.clientY)) return;
    open(true);
  });
  // From the keyboard: Tab onto a dot shows them all; leaving them puts them away (#84).
  wc.addEventListener("focusin", () => open(true));
  wc.addEventListener("focusout", (e) => { if (!wc.contains(e.relatedTarget as Node | null)) open(false); });
  // Leaving the window (towards its edge, say) sends no more moves: close then too.
  document.addEventListener?.("mouseout", (e) => { if (!(e as MouseEvent).relatedTarget) open(false); });
  window.addEventListener?.("blur", () => open(false));

  return h("div", { class: "jv-winctl" }, edge, wc);
}
