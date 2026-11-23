// JARVIS: Home's Claude plan widget (step 4 of #57), one to one with the demo's
// (prototypes/jarvis-home.html): two rings, the session's (5 hours, pink) outside and the week's
// (green) inside, the two percentages and when the session resets. The numbers are the island's
// (views/usage.ts keeps them in this window's shared storage, "coucou.claudePlanUsage"); when
// they are missing or old, one tiny Claude Code question refreshes them, as the notch does.

import { h, clear } from "../views/dom";
import { Bridge, onEvent } from "../core/bridge";
import { PLAN_TEXT, parseClaudePlan, type PlanUsage } from "../core/plan";

const STORE_KEY = "coucou.claudePlanUsage";
/** Older than this, the numbers are asked again (at most this often), as the notch does. */
const STALE_MS = 10 * 60_000;
let askedAt = 0;

const NS = "http://www.w3.org/2000/svg";
const OUTER = { r: 29, track: "#3a1420", color: "#ff375f" };
const INNER = { r: 17, track: "#0f3318", color: "#30d158" };

function stored(): PlanUsage | null {
  try {
    const v = JSON.parse(window.localStorage?.getItem(STORE_KEY) ?? "null");
    return v && typeof v === "object" ? (v as PlanUsage) : null;
  } catch {
    return null;
  }
}

/** A ring's dash offset: the unused part of its circumference. */
export function ringOffset(r: number, pct: number | undefined): number {
  const c = 2 * Math.PI * r;
  return c * (1 - Math.max(0, Math.min(100, pct ?? 0)) / 100);
}

function rings(u: PlanUsage | null): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of [["width", "80"], ["height", "80"], ["viewBox", "0 0 70 70"], ["aria-hidden", "true"]]) svg.setAttribute(k, v);
  const circle = (r: number, stroke: string, pct?: number) => {
    const c = document.createElementNS(NS, "circle");
    for (const [k, v] of [["cx", "35"], ["cy", "35"], ["r", String(r)], ["fill", "none"], ["stroke", stroke], ["stroke-width", "9"]]) c.setAttribute(k, v);
    if (pct !== undefined) {
      c.setAttribute("stroke-linecap", "round");
      c.setAttribute("stroke-dasharray", (2 * Math.PI * r).toFixed(1));
      c.setAttribute("stroke-dashoffset", ringOffset(r, pct).toFixed(1));
      c.setAttribute("transform", "rotate(-90 35 35)");
      if (pct <= 0) c.setAttribute("stroke-opacity", "0");
    }
    return c;
  };
  svg.append(
    circle(OUTER.r, OUTER.track), circle(OUTER.r, OUTER.color, u?.fiveHour?.usedPct ?? 0),
    circle(INNER.r, INNER.track), circle(INNER.r, INNER.color, u?.sevenDay?.usedPct ?? 0));
  return svg;
}

const pct = (n: number | undefined) => (n === undefined ? "—" : `${Math.round(n)}%`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Draws the widget's inside into `box`. */
export function renderPlan(box: HTMLElement, u: PlanUsage | null) {
  clear(box);
  const line = (n: number | undefined, color: string, label: string) =>
    h("p", {}, h("b", { style: `color:${color}`, text: pct(n) }), document.createTextNode(` ${label}`));
  const resets = u?.fiveHour?.resetsAt;
  box.append(rings(u), h("div", { class: "nums" },
    line(u?.fiveHour?.usedPct, OUTER.color, PLAN_TEXT.fiveHours),
    line(u?.sevenDay?.usedPct, INNER.color, PLAN_TEXT.week),
    h("p", { class: "when", text: resets ? `${PLAN_TEXT.resets} ${clock(resets)}` : PLAN_TEXT.waiting })));
}

/** Fills `body` and keeps it current; returns a function that stops it. */
export function planWidget(body: HTMLElement): () => void {
  const box = h("div", { class: "jv-plan" });
  body.append(box);
  const draw = (u: PlanUsage | null) => renderPlan(box, u);
  draw(stored());
  // The island saved new numbers (another window, same storage).
  const onStore = (e: StorageEvent) => { if (e.key === STORE_KEY) draw(stored()); };
  window.addEventListener("storage", onStore);
  // JARVIS's own Claude Code pushed numbers (voice/warm.rs).
  const off = onEvent<unknown>("claude-plan", (raw) => { const u = parseClaudePlan(raw); if (u) draw(u); });
  const now = Date.now();
  const u = stored();
  if ((!u || now - u.updatedAt > STALE_MS) && now - askedAt > STALE_MS) {
    askedAt = now;
    void Bridge.claudePlanUsage().then((raw) => { const v = parseClaudePlan(raw); if (v) draw(v); }).catch(() => {});
  }
  return () => {
    window.removeEventListener("storage", onStore);
    void off.then((f) => f());
  };
}
