// JARVIS: his explanation windows (issue #12), on the see-through layer that
// voice/explain.rs puts over the monitor. For each window: his visor pointer
// goes to the target and circles it, moves to the window's corner, drags the
// card out beside it (frame B), the contents appear, and he parks outside it —
// about 2.2 s once the answer is ready. The card stays until its ×, Esc, a new
// question or the ask shortcut; its corner resizes it.

import "./explain.css";
import { Bridge, onEvent } from "../core/bridge";
import { resolveLanguage, setLanguage, systemLanguages, t } from "../i18n/i18n";
import { BLUE, WIDTH, content } from "./draw";
import { place, type Rect } from "./place";

/** The approved pace (ms). */
const PACE = { go: 350, ring: 500, to: 250, drag: 650, show: 400, park: 250 };
const NS = "http://www.w3.org/2000/svg";

type Show = { add: boolean; question: string; said: string; window: Record<string, any>; target: [number, number, number, number] | null; cursor: [number, number] };
type Card = { el: HTMLElement; marks: SVGElement[] };

const ink = document.createElementNS(NS, "svg");
ink.id = "ink";
const ptr = Object.assign(document.createElement("div"), { className: "ex-ptr" });
ptr.append(document.createElement("b"));
document.body.append(ink, ptr);

let cards: Card[] = [];
let timers: number[] = [];
const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));

const TAGS: Record<string, () => string> = {
  steps: () => t("Steps"),
  diagram: () => t("Diagram"),
  checklist: () => t("Checklist"),
  compare: () => t("Compare"),
  breakdown: () => t("Breakdown"),
  timeline: () => t("Timeline"),
};

function at(x: number, y: number, ms = 0) {
  ptr.style.transition = ms ? `left ${ms}ms cubic-bezier(.4,.1,.2,1), top ${ms}ms cubic-bezier(.4,.1,.2,1), opacity .15s` : "opacity .15s";
  ptr.style.left = `${x}px`;
  ptr.style.top = `${y}px`;
}

function tween(ms: number, fn: (k: number) => void, done?: () => void) {
  const t0 = performance.now();
  const step = (n: number) => {
    const k = Math.min(1, (n - t0) / ms);
    fn(k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

/** Tells Rust where the cards are, so only they take the mouse. */
function report() {
  const rects = cards.map(({ el }) => {
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height] as [number, number, number, number];
  });
  void Bridge.explainHot(rects);
}

function remove(card: Card) {
  cards = cards.filter((c) => c !== card);
  card.el.style.opacity = "0";
  card.marks.forEach((m) => m.remove());
  window.setTimeout(() => {
    card.el.remove();
    if (!cards.length) ptr.style.opacity = "0";
    report();
  }, 160);
}

function closeAll() {
  timers.forEach(clearTimeout);
  timers = [];
  [...cards].forEach(remove);
  ptr.style.opacity = "0";
  if (!cards.length) window.setTimeout(report, 170);
}

/** The card's frame B: corner brackets, header (face, question, tag, ×), his line, the contents, the grip. */
function build(s: Show): { el: HTMLElement; inner: HTMLElement; card: Card } {
  const el = document.createElement("div");
  el.className = "ex-card";
  for (const c of ["left:-1px;top:-1px;border-left-width:2px;border-top-width:2px;border-top-left-radius:10px", "right:-1px;top:-1px;border-right-width:2px;border-top-width:2px;border-top-right-radius:10px", "left:-1px;bottom:-1px;border-left-width:2px;border-bottom-width:2px;border-bottom-left-radius:10px", "right:-1px;bottom:-1px;border-right-width:2px;border-bottom-width:2px;border-bottom-right-radius:10px"]) {
    const i = document.createElement("i");
    i.setAttribute("style", c);
    el.append(i);
  }
  const inner = Object.assign(document.createElement("div"), { className: "ex-inner" });
  const hd = Object.assign(document.createElement("div"), { className: "ex-hd" });
  const face = Object.assign(document.createElement("span"), { className: "ex-face" });
  face.append(document.createElement("b"));
  const x = Object.assign(document.createElement("button"), { className: "ex-x", textContent: "×", title: t("Close") });
  x.setAttribute("aria-label", t("Close"));
  hd.append(face, Object.assign(document.createElement("div"), { className: "ex-q", textContent: s.question }), Object.assign(document.createElement("span"), { className: "ex-tag", textContent: TAGS[s.window.kind]?.() ?? "" }), x);
  const said = Object.assign(document.createElement("div"), { className: "ex-said ix", textContent: s.said });
  inner.append(hd, said, content(s.window));
  const grip = Object.assign(document.createElement("div"), { className: "ex-grip" });
  el.append(inner, grip);
  const card: Card = { el, marks: [] };
  x.addEventListener("click", () => remove(card));
  // Drag the corner: the card follows, its contents reflow (drawings scale).
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    const move = (m: PointerEvent) => {
      const w = Math.max(240, r.width + m.clientX - sx);
      inner.style.width = `${w}px`;
      el.style.width = `${w}px`;
      el.style.height = `${Math.max(inner.offsetHeight, r.height + m.clientY - sy)}px`;
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      report();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
  });
  return { el, inner, card };
}

/** His circle round the target, drawn as the pointer goes round it. */
function ring(r: Rect, ms: number): SVGElement {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2 + 10, ry = r.h / 2 + 8;
  let d = "";
  for (let i = 0; i <= 48; i++) {
    const a = -2.4 + (i / 48) * Math.PI * 2.12, w = 1 + Math.sin(i * 0.6) * 0.03;
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rx * w).toFixed(1)} ${(cy + Math.sin(a) * ry * w).toFixed(1)}`;
  }
  const p = document.createElementNS(NS, "path");
  for (const [k, v] of Object.entries({ d, fill: "none", stroke: BLUE, "stroke-width": "3", "stroke-linecap": "round", style: "filter:drop-shadow(0 0 4px #4fa3ff)" })) p.setAttribute(k, v);
  ink.append(p);
  const L = p.getTotalLength();
  p.style.strokeDasharray = `${L}`;
  p.style.strokeDashoffset = `${L}`;
  tween(ms, (k) => {
    p.style.strokeDashoffset = `${L * (1 - k)}`;
    const a = -2.4 + k * Math.PI * 2.12;
    at(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  });
  return p;
}

/** A thin line from a window at the screen's edge back to its target. */
function link(card: Rect, target: Rect): SVGElement {
  const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
  const x = Math.max(card.x, Math.min(tx, card.x + card.w)), y = Math.max(card.y, Math.min(ty, card.y + card.h));
  const l = document.createElementNS(NS, "line");
  for (const [k, v] of Object.entries({ x1: x, y1: y, x2: tx, y2: ty, stroke: BLUE, "stroke-width": "1.5", "stroke-dasharray": "4 4", opacity: "0.8" })) l.setAttribute(k, String(v));
  ink.append(l);
  return l;
}

function show(s: Show) {
  if (!s.add) closeAll();
  const { el, inner, card } = build(s);
  // Measured at its starting width, unseen, then placed.
  const width = WIDTH[s.window.kind] ?? 330;
  inner.style.width = `${width}px`;
  Object.assign(el.style, { left: "-9999px", top: "0px", width: `${width}px` });
  document.body.append(el);
  const height = Math.min(inner.offsetHeight, window.innerHeight - 24);
  const target: Rect = s.target ? { x: s.target[0], y: s.target[1], w: s.target[2], h: s.target[3] } : { x: s.cursor[0] - 4, y: s.cursor[1] - 4, w: 8, h: 8 };
  const spot = place(target, width, height, window.innerWidth, window.innerHeight, cards.map(({ el: c }) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }));
  Object.assign(el.style, { left: `${spot.x}px`, top: `${spot.y}px`, width: "0px", height: "0px" });
  cards.push(card);
  // The pointer starts where the mouse is, unless it's already parked from a window before.
  if (ptr.style.opacity !== "1") {
    at(s.cursor[0], s.cursor[1]);
    ptr.style.opacity = "1";
  }
  let t0 = 0;
  if (s.target) {
    later(t0, () => at(target.x + target.w / 2, target.y - 12, PACE.go));
    t0 += PACE.go;
    later(t0, () => card.marks.push(ring(target, PACE.ring)));
    t0 += PACE.ring;
  }
  later(t0, () => at(spot.x, spot.y, PACE.to));
  t0 += PACE.to;
  later(t0, () => {
    if (spot.linked && s.target) card.marks.push(link(spot, target));
    tween(PACE.drag, (k) => {
      at(spot.x + width * k, spot.y + height * k);
      el.style.width = `${width * k}px`;
      el.style.height = `${height * k}px`;
    }, () => {
      report();
      // Out of the way: just outside the window's bottom-right corner, never on it.
      at(Math.min(spot.x + width + 10, window.innerWidth - 30), Math.min(spot.y + height - 6, window.innerHeight - 24), PACE.park);
      const parts = [...el.querySelectorAll<Element>(".ix")];
      const gap = parts.length > 1 ? (PACE.show - 160) / (parts.length - 1) : 0;
      parts.forEach((p, i) => later(i * gap, () => p.classList.add("on")));
    });
  });
}

async function main() {
  const boot = await Bridge.boot();
  setLanguage(resolveLanguage(boot?.settings.language, systemLanguages()));
  void onEvent<Show>("explain-show", (s) => show(s));
  void onEvent<null>("explain-close", () => closeAll());
}

void main();
