// JARVIS: Home's Agents widget (step 2 of #57), one to one with the demo's #gAgents
// (prototypes/jarvis-home.html): on the left his solar system (JARVIS in the middle, three rings,
// each agent a planet in its state colour, slowly turning); beside it the list (his small visor,
// the project, what it does, "needs you" / "done" / how long); along the bottom the approval bar,
// only while one asks: Deny / Allow. The rows come from the island (island/share-agents.ts).

import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";
import { emitToWindow, onEvent } from "../core/bridge";
import { visor } from "../theme/theme";
import {
  AGENTS_SNAPSHOT, AGENTS_WANTED, AGENT_DECIDE, AGENT_SHOW, agentEye, minutesBetween, orbitAngle, orbitRing, rankRows,
  type AgentRow,
} from "../core/agents";

const NS = "http://www.w3.org/2000/svg";
/** The rings' radii in the 240 × 240 drawing, inner to outer (the demo's RR). */
const RR = [48, 76, 104];
/** List rows that fit beside the orbit: five, four above the approval bar. */
const ROWS = 5, ROWS_WITH_BAR = 4;

const quiet = (e: Event) => e.stopPropagation();

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** The solar system: rings, the planets on them, JARVIS in the middle. */
function orbit(rows: readonly AgentRow[]): SVGSVGElement {
  const svg = el("svg", { viewBox: "-120 -120 240 240", width: 180, height: 180, class: "jv-orbit", "aria-hidden": "true" });
  const defs = el("defs", {});
  const grad = el("linearGradient", { id: "jvOrbitBody", x1: 0, y1: 0, x2: 0, y2: 1 });
  for (const [o, c] of [["0", "#f6f7f9"], [".7", "#eceef1"], ["1", "#dcdfe4"]]) grad.append(el("stop", { offset: o, "stop-color": c }));
  defs.append(grad);
  svg.append(defs,
    el("circle", { r: 104, fill: "none", stroke: "#2c2c2e", "stroke-dasharray": "4 5" }),
    el("circle", { r: 76, fill: "none", stroke: "#2c2c2e" }),
    el("circle", { r: 48, fill: "rgba(10,132,255,.07)", stroke: "rgba(10,132,255,.35)" }));
  for (const ring of [0, 1, 2] as const) {
    const on = rows.filter((r) => orbitRing(r) === ring);
    const g = el("g", { class: `spin r${ring + 1}` });
    on.forEach((r, i) => {
      const a = orbitAngle(i, on.length, ring);
      const done = r.state === "finished" || r.state === "idle";
      g.append(el("circle", { cx: (Math.cos(a) * RR[ring]).toFixed(1), cy: (Math.sin(a) * RR[ring]).toFixed(1), r: done ? 6 : 8, fill: agentEye(r.state) }));
    });
    svg.append(g);
  }
  // JARVIS: the white shell, the slot, his blue eye glancing.
  const eye = el("rect", { x: -9, y: -2.5, width: 18, height: 5, rx: 2.5, fill: "#0a84ff" });
  eye.append(el("animate", { attributeName: "x", values: "-9;-14;-9;-4;-9", dur: "7s", repeatCount: "indefinite" }));
  svg.append(
    el("rect", { x: -30, y: -21, width: 60, height: 42, rx: 14, fill: "url(#jvOrbitBody)" }),
    el("rect", { x: -19, y: -5, width: 38, height: 10, rx: 5, fill: "#0b0f17", stroke: "#c9cdd4", "stroke-width": 0.8 }),
    eye);
  return svg;
}

/** Draws the widget's inside into `box`. */
export function renderAgents(box: HTMLElement, rows: readonly AgentRow[], now = Date.now()) {
  clear(box);
  const ranked = rankRows(rows);
  const asking = ranked.find((r) => r.ask) ?? null;
  const list = h("div", { class: "jv-aglist" });

  if (ranked.length === 0) {
    list.append(h("div", { class: "jv-ag-empty" },
      h("p", { class: "t", text: t("No agents running") }),
      h("p", { class: "d", text: t("Start a Claude Code session and it shows up here.") }),
      h("button", { class: "jv-btn", text: t("New session"), onclick: (e: Event) => { quiet(e); void emitToWindow("island", AGENT_SHOW, "launch"); } })));
  }
  const max = asking ? ROWS_WITH_BAR : ROWS;
  for (const r of ranked.slice(0, max)) {
    const v = visor(34);
    v.style.setProperty("--eye", agentEye(r.state));
    const mins = minutesBetween(r.since, now);
    const done = r.state === "finished" || r.state === "idle";
    const what = r.ask
      ? (r.ask.question ? t("has a question") : t("wants to run {command}", { command: r.ask.command }))
      : r.state === "finished" ? t("done {n} min ago", { n: mins }) : r.doing ?? (r.state === "idle" ? t("Ready") : t("Working"));
    const side = r.ask
      ? h("span", { class: "s ask", text: t("Needs you") })
      : h("span", { class: "s", text: done ? t("Done") : mins < 1 ? t("just now") : t("{n} min", { n: mins }) });
    list.append(h("div", { class: "jv-agrow" }, v,
      h("div", { class: "x" }, h("p", { class: "t", text: r.title }), h("p", { class: "d", text: what })), side));
  }
  if (ranked.length > max) list.append(h("p", { class: "jv-ag-more", text: t("+ {n} more", { n: ranked.length - max }) }));
  box.append(h("div", { class: "jv-agmain" }, orbit(ranked), list));

  // The approval bar: the one asking you, and your answer.
  if (asking?.ask) {
    const ask = asking.ask;
    const send = (d: "allow" | "deny") => (e: Event) => { quiet(e); void emitToWindow("island", AGENT_DECIDE, { requestId: ask.requestId, d }); };
    const text = h("span", { class: "x" }, h("b", { text: asking.title }), document.createTextNode(" "),
      h("span", { class: "d", text: ask.question ? t("has a question") : t("wants to run {command}", { command: ask.command }) }));
    const bar = h("div", { class: "jv-wapprove" }, h("span", { class: "dot" }), text,
      ...(ask.question
        ? [h("button", { class: "jv-btn blue", text: t("Answer"), onclick: (e: Event) => { quiet(e); void emitToWindow("island", AGENT_SHOW, "question"); } })]
        : [h("button", { class: "jv-btn", text: t("Deny"), onclick: send("deny") }), h("button", { class: "jv-btn blue", text: t("Allow"), onclick: send("allow") })]));
    bar.addEventListener("keydown", quiet);
    box.append(bar);
  }
}

/** Fills `body` and keeps it current; returns a function that stops it. */
export function agentsWidget(body: HTMLElement): () => void {
  let rows: AgentRow[] = [];
  const box = h("div", { class: "jv-ag" });
  body.append(box);
  const draw = () => renderAgents(box, rows);
  draw();
  const off = onEvent<AgentRow[]>(AGENTS_SNAPSHOT, (r) => { rows = Array.isArray(r) ? r : []; draw(); });
  void emitToWindow("island", AGENTS_WANTED);
  // "4 min" moves on with the clock.
  const tick = window.setInterval(draw, 30_000);
  return () => {
    window.clearInterval(tick);
    void off.then((f) => f());
  };
}
