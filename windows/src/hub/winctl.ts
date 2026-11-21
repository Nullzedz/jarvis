// The window has no title bar (SPEC: "just the app"). Its controls live at JARVIS's
// visor in the top-left corner: bring the pointer near the top and three dots slide
// out from behind him — close, minimise, full screen, as Apple's traffic lights — while he glances at them.
// Drag the window by his visor or the top edge; double-click him to fill the screen.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge } from "../core/bridge";
import { visor } from "../theme/theme";

const NEAR_TOP = 56; // px from the top where the dots come out
const CORNER_W = 240; // and from the left: his corner, not the whole top edge

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
    }
  };
  // Open near his corner only, not along the whole top edge; once open they stay while
  // the pointer is on him, the dots or the sidebar they opened, and close as soon as it leaves.
  const rail = () => document.querySelector(".jv-rail");
  window.addEventListener?.("mousemove", (e) => {
    const nearCorner = e.clientY < NEAR_TOP && e.clientX < CORNER_W;
    const onThem = wc.matches(":hover") || (wc.classList.contains("open") && !!rail()?.matches(":hover"));
    open(nearCorner || onThem);
  });
  // Leaving the window (towards its edge, say) sends no more moves: close then too.
  document.addEventListener?.("mouseout", (e) => { if (!(e as MouseEvent).relatedTarget) open(false); });
  window.addEventListener?.("blur", () => open(false));

  return h("div", { class: "jv-winctl" }, edge, wc);
}
