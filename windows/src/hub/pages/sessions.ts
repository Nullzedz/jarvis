// JARVIS: the Agents section's first tab (#65), one to one with the demo's Agents view
// (prototypes/jarvis-home.html #agents): "Agents · N sessions" with the Claude plan chip; his
// orbit, three rings (Watch closely, Normal, Quiet) with every agent a planet in its state colour,
// its name and what it does beside it (labels never overlap); drag a planet to another ring to
// set how closely he watches it; the approval bar; then the sessions as a card stack, the front
// card open, the others peeking above it. The rows come from the island (island/share-agents.ts).

import { h, clear } from "../../views/dom";
import { t, tn } from "../../i18n/i18n";
import { Bridge, emitToWindow, onEvent } from "../../core/bridge";
import { visor } from "../../theme/theme";
import {
  AGENTS_SNAPSHOT, AGENTS_WANTED, AGENT_SHOW, agentEye, loadWatch, minutesBetween, rankRows, ringAt, saveWatch, watchOf,
  type AgentRow, type Watch,
} from "../../core/agents";
import { storedPlan } from "../plan-widget";
import { agentName, approveBar } from "../approve-bar";
import type { HubContext } from "../shell";

const NS = "http://www.w3.org/2000/svg";
const C = { x: 450, y: 205 }, R = [92, 140, 186], SQ = 0.82;
const RINGS = [
  { name: () => t("Watch closely"), say: () => t("tells you every step and asks before it acts"), col: "#0a84ff", speed: 0.022 },
  { name: () => t("Normal"), say: () => t("tells you when it needs you or finishes"), col: "#8e8e93", speed: -0.016 },
  { name: () => t("Quiet"), say: () => t("only speaks up when it's done or stuck"), col: "#636366", speed: 0.008 },
];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

const done = (r: AgentRow) => r.state === "finished" || r.state === "idle";
function whatOf(r: AgentRow, now: number): string {
  if (r.ask) return r.ask.question ? t("has a question") : t("wants to run {command}", { command: r.ask.command });
  if (r.state === "finished") return t("done {n} min ago", { n: minutesBetween(r.since, now) });
  return r.doing ?? (r.state === "idle" ? t("Ready") : t("Working"));
}
const askColor = "#ff9f0a";

interface Planet { row: AgentRow; g: SVGGElement; angle: number; watch: Watch; drag: { x: number; y: number } | null; dragged: boolean; px: number; py: number; ly: number | null; left: boolean }

/** `rows`: start with these (a preview without the island); the island's replace them. */
export function sessionsPage(page: HTMLElement, ctx: HubContext, start: AgentRow[] = []) {
  let rows: AgentRow[] = start;
  let order: string[] = [];
  const now = () => Date.now();

  // ── The top: title, the plan chip ──
  const count = h("span");
  const plan = storedPlan();
  // A new session from here, any time (#84: it was only in Home's empty widget).
  const newSession = h("button", { class: "jv-btn", text: `+ ${t("New session")}`, onclick: () => void emitToWindow("island", AGENT_SHOW, "launch") });
  const top = h("div", { class: "jv-ahero-top" },
    h("p", { class: "jv-atitle" }, document.createTextNode(t("Agents")), count),
    h("span", { class: "jv-ahero-acts" },
      ...(plan?.fiveHour ? [h("span", { class: "jv-chip" }, h("span", { class: "dot", style: "background:#ff375f" }), h("span", { text: t("Claude plan {n}%", { n: Math.round(plan.fiveHour.usedPct) }) }))] : []),
      newSession));

  // ── The orbit ──
  const svg = el("svg", { class: "jv-aorbit", viewBox: "0 0 900 420", preserveAspectRatio: "xMidYMid meet" });
  const rings = RINGS.map((_, i) => el("ellipse", {
    cx: C.x, cy: C.y, rx: R[i], ry: R[i] * SQ, fill: i === 0 ? "rgba(10,132,255,.06)" : "none",
    stroke: i === 0 ? "rgba(10,132,255,.32)" : "#1c1c1e", ...(i === 2 ? { "stroke-dasharray": "5 6" } : {}),
  }));
  const labels = RINGS.map((r, i) => el("text", { x: C.x, y: C.y - R[i] * SQ - 7, "text-anchor": "middle", "font-size": 11, fill: r.col }, r.name()));
  const hintText = () => t("Drag a planet to another ring to change how closely he watches it");
  const hint = el("text", { x: C.x, y: 410, "text-anchor": "middle", "font-size": 12.5, fill: "#8e8e93" }, hintText());
  const defs = el("defs");
  const body = el("linearGradient", { id: "jvAoBody", x1: 0, y1: 0, x2: 0, y2: 1 });
  for (const [o, c] of [["0", "#f6f7f9"], [".7", "#eceef1"], ["1", "#dcdfe4"]]) body.append(el("stop", { offset: o, "stop-color": c }));
  const slot = el("linearGradient", { id: "jvAoSlot", x1: 0, y1: 0, x2: 0, y2: 1 });
  for (const [o, c] of [["0", "#0b0f17"], ["1", "#1b2433"]]) slot.append(el("stop", { offset: o, "stop-color": c }));
  defs.append(body, slot);
  const eye = el("rect", { x: C.x - 16, y: C.y - 2.5, width: 32, height: 5, rx: 2.5, fill: "#0a84ff" });
  eye.append(el("animateTransform", { attributeName: "transform", type: "translate", values: "0 0;0 0;-4 0;-4 0;4 0;4 0;0 0", keyTimes: "0;.18;.24;.4;.46;.62;.68", dur: "7s", repeatCount: "indefinite" }));
  const planets = el("g");
  // Space: little white specks, a few of them twinkling (the same sky every time).
  const sky = el("g", { class: "jv-stars", "aria-hidden": "true" });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 110; i++) {
    const x = rnd() * 900, y = rnd() * 420;
    if (Math.hypot(x - C.x, (y - C.y) / SQ) < 60) continue; // none on him
    const star = el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: (0.4 + rnd() * 0.9).toFixed(2), fill: "#fff", opacity: (0.15 + rnd() * 0.55).toFixed(2) });
    if (i % 9 === 0) star.append(el("animate", { attributeName: "opacity", values: "0.15;0.9;0.15", dur: `${(3 + rnd() * 4).toFixed(1)}s`, begin: `${(rnd() * 4).toFixed(1)}s`, repeatCount: "indefinite" }));
    sky.append(star);
  }
  svg.append(sky, rings[2], rings[1], rings[0], ...labels, hint, defs,
    el("rect", { x: C.x - 36, y: C.y - 25, width: 72, height: 50, rx: 17, fill: "url(#jvAoBody)" }),
    el("path", { d: `M${C.x - 18} ${C.y - 24.5} H${C.x + 18}`, stroke: "#fff", "stroke-width": 1.2, "stroke-linecap": "round" }),
    el("rect", { x: C.x - 22.5, y: C.y - 5, width: 45, height: 10, rx: 5, fill: "url(#jvAoSlot)", stroke: "#c9cdd4", "stroke-width": 0.8 }),
    eye, planets);

  const ringGlow = (i: number | null) => {
    rings.forEach((e, k) => e.setAttribute("stroke-width", k === i ? "2.5" : "1"));
    labels.forEach((e, k) => e.setAttribute("font-weight", k === i ? "600" : "400"));
    if (i == null) { hint.textContent = hintText(); hint.setAttribute("fill", "#8e8e93"); }
    else { hint.textContent = `${RINGS[i].name()}: ${RINGS[i].say()}`; hint.setAttribute("fill", RINGS[i].col === "#636366" ? "#aeaeb2" : RINGS[i].col); }
  };

  const map = new Map<string, Planet>();
  const t0 = performance.now();
  const svgPt = (e: PointerEvent) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : pt;
  };
  const ringOf = (x: number, y: number) => ringAt(Math.hypot(x - C.x, (y - C.y) / SQ), R);

  function planetFor(row: AgentRow, i: number, n: number): Planet {
    const g = el("g", { class: "jv-planet" });
    const p: Planet = { row, g, angle: (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 3, watch: watchOf(loadWatch(), row), drag: null, dragged: false, px: C.x, py: C.y, ly: null, left: false };
    g.addEventListener("click", () => {
      if (p.dragged) { p.dragged = false; return; }
      front(p.row.id);
      stack.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const p0 = svgPt(e);
      let moved = false;
      try { g.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      const move = (ev: PointerEvent) => {
        const q = svgPt(ev);
        if (!moved && Math.hypot(q.x - p0.x, q.y - p0.y) < 5) return;
        moved = true;
        p.drag = { x: q.x, y: q.y };
        g.style.cursor = "grabbing";
        g.querySelector(".core")?.setAttribute("transform", "scale(1.25)");
        ringGlow(ringOf(q.x, q.y));
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        g.style.cursor = "";
        g.querySelector(".core")?.removeAttribute("transform");
        if (!moved || !p.drag) return;
        const { x, y } = p.drag;
        const ring = ringOf(x, y);
        const dt = (performance.now() - t0) / 1000;
        p.watch = ring;
        p.angle = Math.atan2((y - C.y) / SQ, x - C.x) - dt * RINGS[ring].speed; // lands where you let go
        p.drag = null;
        p.dragged = true;
        ringGlow(null);
        saveWatch(p.row.id, ring);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
    return p;
  }

  function paintPlanet(p: Planet) {
    const r = p.row;
    const col = agentEye(r.state);
    const size = done(r) ? 7 : r.ask ? 11 : 10;
    clear(p.g);
    p.g.append(
      el("circle", { r: size + 8, fill: "none", stroke: col, "stroke-opacity": done(r) ? 0 : 0.3 }),
      el("circle", { class: "core", r: size, fill: col }),
      el("line", { class: "ld", stroke: "#48484a", "stroke-width": 1, opacity: 0 }),
      el("text", { class: "nm", "font-size": 15, "font-weight": 600, fill: done(r) ? "#8e8e93" : "#f5f5f7" }, r.title),
      el("text", { class: "wh", "font-size": 12.5, fill: r.ask ? askColor : "#8e8e93" }, whatOf(r, now())));
  }

  function syncPlanets() {
    const ranked = rankRows(rows);
    const watch = loadWatch();
    for (const id of [...map.keys()]) if (!ranked.some((r) => r.id === id)) { map.get(id)?.g.remove(); map.delete(id); }
    ranked.forEach((row, i) => {
      let p = map.get(row.id);
      if (!p) { p = planetFor(row, i, ranked.length); map.set(row.id, p); planets.append(p.g); }
      p.row = row;
      if (!p.drag) p.watch = watchOf(watch, row);
      paintPlanet(p);
    });
  }

  let raf = 0;
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function spin(stamp: number) {
    const dt = still ? 0 : (stamp - t0) / 1000;
    const all = [...map.values()];
    for (const s of all) {
      if (s.drag) { s.px = s.drag.x; s.py = s.drag.y; }
      else {
        const a = s.angle + dt * RINGS[s.watch].speed, r = R[s.watch];
        s.px = C.x + Math.cos(a) * r;
        s.py = C.y + Math.sin(a) * r * SQ;
      }
      s.left = s.px < C.x;
      s.g.setAttribute("transform", `translate(${s.px.toFixed(1)} ${s.py.toFixed(1)})`);
    }
    // Labels never overlap: on each side, one that would sit on the one above slides down.
    const GAP = 42, pad = 22;
    for (const side of [true, false]) {
      const list = all.filter((s) => s.left === side).sort((a, b) => a.py - b.py);
      let floor = -Infinity;
      for (const s of list) {
        const want = Math.max(s.py, floor);
        s.ly = s.ly == null ? want : s.ly + (want - s.ly) * 0.2;
        floor = s.ly + GAP;
      }
      let ceil = Infinity;
      for (const s of [...list].reverse()) { if ((s.ly ?? 0) > ceil) s.ly = ceil; ceil = (s.ly ?? 0) - GAP; }
    }
    for (const s of all) {
      const off = (s.ly ?? s.py) - s.py, left = s.left;
      for (const [cls, dy] of [["nm", -3], ["wh", 14]] as const) {
        const tx = s.g.querySelector(`.${cls}`);
        tx?.setAttribute("x", String(left ? -pad : pad));
        tx?.setAttribute("y", (dy + off).toFixed(1));
        tx?.setAttribute("text-anchor", left ? "end" : "start");
      }
      const ld = s.g.querySelector(".ld");
      const far = Math.abs(off) > 8; // a hairline ties a moved label back to its planet
      ld?.setAttribute("opacity", far ? "1" : "0");
      ld?.setAttribute("x1", String(left ? -12 : 12));
      ld?.setAttribute("y1", "0");
      ld?.setAttribute("x2", String(left ? -pad + 4 : pad - 4));
      ld?.setAttribute("y2", (off + 2).toFixed(1));
    }
    raf = requestAnimationFrame(spin);
  }
  raf = requestAnimationFrame(spin);

  // ── The approval bar ──
  const approve = h("div", { class: "jv-approve gone" });
  // #84: the shared bar (approve-bar.ts): every request waiting, one at a time, your answer at once.
  function paintApprove() {
    clear(approve);
    const bar = approveBar(rankRows(rows), "page", paintApprove);
    approve.classList.toggle("gone", !bar);
    if (bar) approve.append(bar);
  }

  // ── The card stack ──
  const stack = h("div", { class: "jv-stack" });
  const cards = new Map<string, HTMLElement>();
  function front(id: string) { order = [id, ...order.filter((x) => x !== id)]; layoutStack(); }
  function cardFor(r: AgentRow): HTMLElement {
    const col = agentEye(r.state);
    const v = visor(42);
    v.style.setProperty("--eye", col);
    const mins = minutesBetween(r.since, now());
    const code = h("div", { class: "jv-code" });
    if (r.ask && !r.ask.question) code.append(h("span", { class: "p", text: "$ " }), h("span", { text: r.ask.command }));
    else if (r.steps?.length) for (const s of r.steps) code.append(h("div", { text: s }));
    else code.append(h("span", { class: "p", text: whatOf(r, now()) }));
    const open = h("button", { class: "jv-btn", text: t("Open terminal"), onclick: (e: Event) => { e.stopPropagation(); void Bridge.openSession(r.sessionId ?? null, r.cwd ?? null); } });
    const c = h("div", { class: "jv-card" },
      h("div", { class: "peek" }, h("span", { class: "dot", style: `background:${col}` }), h("span", { class: "pk", text: `${r.title} · ${whatOf(r, now())}` })),
      h("div", { class: "body" },
        h("div", { class: "head" }, v,
          h("div", { class: "x" }, h("p", { class: "t", text: agentName(r, rows) }), h("p", { class: "d", text: `${r.app} · ${whatOf(r, now())}` })),
          h("span", { class: "jv-chip" }, h("span", { class: "dot", style: `background:${col}` }),
            h("span", { text: done(r) ? t("Done") : mins < 1 ? t("just now") : t("{n} min", { n: mins }) }))),
        code,
        h("div", { class: "foot" }, open)));
    c.addEventListener("click", () => { if (order[0] !== r.id) front(r.id); });
    return c;
  }
  // #84: the cards stay; only their contents are refreshed and their places moved, so bringing one
  // forward slides it (the transform transition) instead of redrawing the stack with a jump.
  function paintStack() {
    const ids = rows.map((r) => r.id);
    order = [...order.filter((id) => ids.includes(id)), ...rankRows(rows).map((r) => r.id).filter((id) => !order.includes(id))];
    for (const [id, c] of cards) if (!ids.includes(id)) { c.remove(); cards.delete(id); }
    stack.querySelector(".jv-stack-empty")?.remove();
    if (!rows.length) {
      stack.style.height = "";
      stack.append(h("p", { class: "jv-stack-empty", text: t("No agents running. Press New session, or start one in your terminal or editor.") }));
      return;
    }
    for (const r of rows) {
      const fresh = cardFor(r);
      const old = cards.get(r.id);
      if (old) old.replaceChildren(...fresh.childNodes);
      else { cards.set(r.id, fresh); stack.append(fresh); }
    }
    layoutStack();
  }
  function layoutStack() {
    for (const c of cards.values()) c.classList.remove("front");
    const behind = order.slice(1).reverse(); // farthest first
    const peek = 26, frontTop = behind.length * peek;
    behind.forEach((id, i) => {
      const c = cards.get(id);
      if (!c) return;
      const inset = (behind.length - i) * 10;
      c.style.zIndex = String(i + 1);
      c.style.transform = `translateY(${i * peek}px) scaleX(${1 - inset / 500})`;
      c.style.background = ["#141416", "#18181b", "#1d1d20"][Math.min(2, i + (3 - behind.length))];
    });
    const f = cards.get(order[0]);
    if (f) {
      f.classList.add("front");
      f.style.zIndex = "10";
      f.style.transform = `translateY(${frontTop}px)`;
      f.style.background = "#232326";
      requestAnimationFrame(() => { stack.style.height = `${frontTop + f.offsetHeight + 40}px`; });
    }
  }

  function paint() {
    count.textContent = tn("{count} running", "{count} running", rows.length);
    syncPlanets();
    paintApprove();
    paintStack();
  }

  page.append(
    // The bar above the orbit while something waits: never below the fold (#84).
    h("div", { class: "jv-ahero" }, top, approve, svg),
    h("p", { class: "jv-greet-sm", text: t("Sessions") }),
    stack);
  paint();

  const off = onEvent<AgentRow[]>(AGENTS_SNAPSHOT, (r) => { rows = Array.isArray(r) ? r : []; paint(); });
  void off.then(() => emitToWindow("island", AGENTS_WANTED));
  const tick = window.setInterval(paint, 30_000);
  // Space is black, as in the demo: the whole panel, while this page shows.
  document.body.classList.add("jv-space");
  ctx.onLeave = () => {
    document.body.classList.remove("jv-space");
    cancelAnimationFrame(raf);
    window.clearInterval(tick);
    void off.then((f) => f());
  };
}
