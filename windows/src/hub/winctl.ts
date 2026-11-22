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
  // Apple's traffic lights, in Apple's order and with no symbols: close red, minimise yellow, full screen green.
  const dot = (cls: string, label: string, action: "minimize" | "maximize" | "close") =>
    h("button", { class: `jv-dot ${cls}`, title: label, "aria-label": label, onclick: () => void Bridge.hubWindow(action) });
  const dots = h("div", { class: "jv-dots" },
    dot("close", t("Close"), "close"),
    dot("min", t("Minimize"), "minimize"),
    dot("max", t("Full screen"), "maximize"),
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
  // Open near his corner only, not along the whole top edge; once open they stay while
  // the pointer is on him, the dots or the sidebar they opened, and close as soon as it leaves.
  const rail = () => document.querySelector(".jv-rail");
  // To open, the pointer has to settle on his visor itself (not just pass the corner):
  // 150 ms there, or a slow move on it. Once open, the dots, him or the sidebar keep them.
  const SETTLE_MS = 150, SLOW = 0.4; // px per ms
  let settle = 0;
  let last: { x: number; y: number; t: number } | null = null;
  const onFace = (x: number, y: number) => {
    const r = face.getBoundingClientRect();
    return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4 && y < NEAR_TOP && x < CORNER_W;
  };
  window.addEventListener?.("mousemove", (e) => {
    const now = performance.now();
    const isOpen = wc.classList.contains("open");
    if (isOpen) {
      const keep = onFace(e.clientX, e.clientY) || wc.matches(":hover") || !!rail()?.matches(":hover");
      if (!keep) open(false);
      last = null;
      return;
    }
    // Coming from the open sidebar: straight to the dots, nothing closes in between.
    if (onFace(e.clientX, e.clientY) && rail()?.classList.contains("open")) {
      window.clearTimeout(settle);
      open(true);
      return;
    }
    if (!onFace(e.clientX, e.clientY)) {
      window.clearTimeout(settle);
      settle = 0;
      last = null;
      return;
    }
    const slow = last && now > last.t && Math.hypot(e.clientX - last.x, e.clientY - last.y) / (now - last.t) < SLOW;
    last = { x: e.clientX, y: e.clientY, t: now };
    if (slow) { window.clearTimeout(settle); open(true); return; }
    window.clearTimeout(settle);
    settle = window.setTimeout(() => open(true), SETTLE_MS);
  });
  // Leaving the window (towards its edge, say) sends no more moves: close then too.
  document.addEventListener?.("mouseout", (e) => { if (!(e as MouseEvent).relatedTarget) { window.clearTimeout(settle); open(false); } });
  window.addEventListener?.("blur", () => { window.clearTimeout(settle); open(false); });

  return h("div", { class: "jv-winctl" }, edge, wc);
}
