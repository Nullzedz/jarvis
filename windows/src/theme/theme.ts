// JARVIS's theme: dark (default), light (palette A) or following Windows.
// Every window reads the same choice and follows a change made in any of them.
import "./tokens.css";
import { h } from "../views/dom";

export type ThemeChoice = "dark" | "light" | "auto";
const KEY = "jarvis-theme";
// Looked up lazily: the module also loads in tests, where there is no matchMedia.
const media = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null);

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "auto") return v;
  } catch {}
  return "dark";
}

/** Whether the choice asks for light, for when the pages get a light version. */
export function wantsLight(c = themeChoice()): boolean {
  return c === "light" || (c === "auto" && !!media()?.matches);
}

function apply() {
  // #84: the new pages are drawn dark only, as the demos are; a stored light choice would put
  // white boxes into dark panels. The choice is kept (wantsLight) for a light version later.
  document.documentElement.dataset.theme = "dark";
}

export function setTheme(c: ThemeChoice) {
  try { localStorage.setItem(KEY, c); } catch {}
  apply();
}

/** Call once per window. */
export function initTheme() {
  apply();
  media()?.addEventListener("change", apply);
  addEventListener("storage", (e) => { if (e.key === KEY) apply(); });
}

/** JARVIS design A as an element; `state` picks the eye colour (SPEC §3). */
export function visor(width: number, state = "idle"): HTMLElement {
  return h("span", { class: "jv-visor", "data-state": state, style: `width:${width}px`, "aria-hidden": "true" }, h("b"));
}
