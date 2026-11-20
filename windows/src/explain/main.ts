// JARVIS: his explanation windows (issue #12), on the see-through layer that
// voice/explain.rs puts over the monitor. For each window: his visor pointer
// goes to the target and traces a glowing circle round it, moves to the
// window's corner, drags the card out beside what he explains (never on it),
// then flies into the empty slot at the top left of its header and stays there
// as its icon; the contents appear meanwhile. About 2.5 s once the answer is
// ready. The circle fades a few seconds later. The card stays until its ×,
// Esc, a new question or the ask shortcut; drag its header to move it, its
// corner to resize it; ↻ redraws the same answer in another form.

import "./explain.css";
import { Bridge, onEvent } from "../core/bridge";
import { resolveLanguage, setLanguage, systemLanguages, t } from "../i18n/i18n";
import { BLUE, content, widthFor } from "./draw";
import { place, type Rect } from "./place";

/** The approved pace (ms), and how long the circle stays lit once the window is drawn. */
const PACE = { go: 350, ring: 500, to: 250, drag: 650, dock: 300, show: 400 };
const RING_STAYS = 3000;
const NS = "http://www.w3.org/2000/svg";

type Box = [number, number, number, number];
type Show = { add: boolean; question: string; said: string; window: Record<string, any>; target: Box | null; about: Box | null; cursor: [number, number] };
type Card = { id: number; el: HTMLElement; inner: HTMLElement; slot: HTMLElement; marks: SVGElement[]; s: Show; tried: string[] };

const ink = document.createElementNS(NS, "svg");
ink.id = "ink";
const ptr = Object.assign(document.createElement("div"), { className: "ex-ptr" });
ptr.append(document.createElement("b"));
document.body.append(ink, ptr);

let cards: Card[] = [];
let timers: number[] = [];
let nextId = 1;
const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
const rectOf = (b: Box): Rect => ({ x: b[0], y: b[1], w: b[2], h: b[3] });
const formOf = (w: Record<string, any>) => String(w.form ?? w.kind ?? "");

const TAGS: Record<string, () => string> = {
  steps: () => t("Steps"),
  diagram: () => t("Diagram"),
  checklist: () => t("Checklist"),
  compare: () => t("Compare"),
  breakdown: () => t("Breakdown"),
  timeline: () => t("Timeline"),
};
/** The tag: the ready-made kind's name, or the form he named for his own drawing. */
const tagFor = (w: Record<string, any>) => (w.kind === "drawing" ? String(w.form ?? "").slice(0, 16) : TAGS[w.kind]?.() ?? "");

function at(x: number, y: number, ms = 0) {
  ptr.style.transition = ms ? `left ${ms}ms cubic-bezier(.4,.1,.2,1), top ${ms}ms cubic-bezier(.4,.1,.2,1), opacity .15s, width .2s, height .2s, border-radius .2s` : "opacity .15s, width .2s, height .2s, border-radius .2s";
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

const bounds = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** Tells Rust where the cards are, so only they take the mouse. */
function report() {
  void Bridge.explainHot(cards.map(({ el }) => {
    const r = bounds(el);
    return [r.x, r.y, r.w, r.h] as Box;
  }));
}

function fadeMark(m: SVGElement) {
  m.style.transition = "opacity .5s ease";
  m.style.opacity = "0";
  window.setTimeout(() => m.remove(), 520);
}

function remove(card: Card) {
  cards = cards.filter((c) => c !== card);
  card.el.style.opacity = "0";
  card.marks.forEach(fadeMark);
  window.setTimeout(() => {
    card.el.remove();
    report();
  }, 160);
}

function closeAll() {
  timers.forEach(clearTimeout);
  timers = [];
  [...cards].forEach(remove);
  ptr.style.opacity = "0";
  window.setTimeout(report, 170);
}

/** His visor, docked in a header's slot: the window's icon. */
function face(): HTMLElement {
  const f = Object.assign(document.createElement("span"), { className: "ex-face" });
  f.append(document.createElement("b"));
  return f;
}

/** Fills a card's inside: his line, then the drawing (the parts start hidden, `.ix`). */
function fill(card: Card) {
  const { s, inner } = card;
  inner.querySelectorAll(".ex-said, .ex-content").forEach((e) => e.remove());
  inner.querySelector(".ex-tag")!.textContent = tagFor(s.window);
  inner.append(Object.assign(document.createElement("div"), { className: "ex-said ix", textContent: s.said }), content(s.window));
}

/** The parts appear one after another within `ms`. */
function reveal(card: Card, ms: number) {
  const parts = [...card.el.querySelectorAll<Element>(".ix")];
  const gap = parts.length > 1 ? Math.max(0, ms - 160) / (parts.length - 1) : 0;
  parts.forEach((p, i) => later(i * gap, () => p.classList.add("on")));
}

/** The card's frame B: corner brackets; header (his slot, the question, tag, ↻, ×); his line; the contents; the grip. */
function build(s: Show): Card {
  const el = document.createElement("div");
  el.className = "ex-card";
  for (const c of ["left:-1px;top:-1px;border-left-width:2px;border-top-width:2px;border-top-left-radius:10px", "right:-1px;top:-1px;border-right-width:2px;border-top-width:2px;border-top-right-radius:10px", "left:-1px;bottom:-1px;border-left-width:2px;border-bottom-width:2px;border-bottom-left-radius:10px", "right:-1px;bottom:-1px;border-right-width:2px;border-bottom-width:2px;border-bottom-right-radius:10px"]) {
    const i = document.createElement("i");
    i.setAttribute("style", c);
    el.append(i);
  }
  const inner = Object.assign(document.createElement("div"), { className: "ex-inner" });
  const hd = Object.assign(document.createElement("div"), { className: "ex-hd" });
  const slot = Object.assign(document.createElement("span"), { className: "ex-slot" });
  const again = Object.assign(document.createElement("button"), { className: "ex-btn ex-again", textContent: "↻", title: t("Draw it differently") });
  again.setAttribute("aria-label", t("Draw it differently"));
  const x = Object.assign(document.createElement("button"), { className: "ex-btn ex-x", textContent: "×", title: t("Close") });
  x.setAttribute("aria-label", t("Close"));
  hd.append(slot, Object.assign(document.createElement("div"), { className: "ex-q", textContent: s.question }), Object.assign(document.createElement("span"), { className: "ex-tag" }), again, x);
  inner.append(hd);
  const grip = Object.assign(document.createElement("div"), { className: "ex-grip" });
  el.append(inner, grip);
  const card: Card = { id: nextId++, el, inner, slot, marks: [], s, tried: [formOf(s.window)] };
  fill(card);
  x.addEventListener("click", () => remove(card));
  again.addEventListener("click", () => redraw(card, again));
  // Drag the header to move it (its link line, now pointing nowhere, goes).
  hd.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    hd.setPointerCapture(e.pointerId);
    const r = bounds(el), sx = e.clientX, sy = e.clientY;
    card.marks.filter((m) => m.tagName === "line").forEach(fadeMark);
    const move = (m: PointerEvent) => {
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, r.x + m.clientX - sx))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, r.y + m.clientY - sy))}px`;
    };
    hd.addEventListener("pointermove", move);
    hd.addEventListener("pointerup", () => {
      hd.removeEventListener("pointermove", move);
      report();
    }, { once: true });
  });
  // Drag the corner to resize: its contents reflow, drawings scale.
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const r = bounds(el), sx = e.clientX, sy = e.clientY;
    const move = (m: PointerEvent) => {
      const w = Math.max(240, r.w + m.clientX - sx);
      inner.style.width = `${w}px`;
      el.style.width = `${w}px`;
      el.style.height = `${Math.max(inner.offsetHeight, r.h + m.clientY - sy)}px`;
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", () => {
      grip.removeEventListener("pointermove", move);
      report();
    }, { once: true });
  });
  return card;
}

/** Sizes a card to its contents at `width`, at most the screen's height. */
function measure(card: Card, width: number): number {
  card.inner.style.width = `${width}px`;
  return Math.min(card.inner.offsetHeight, window.innerHeight - 24);
}

/** His glowing circle round the target, traced as the pointer goes round it. */
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
  const card = build(s);
  const { el } = card;
  // Measured unseen at its starting width, then placed.
  const width = widthFor(s.window);
  Object.assign(el.style, { left: "-9999px", top: "0px", width: `${width}px` });
  document.body.append(el);
  const height = measure(card, width);
  const target = s.target ? rectOf(s.target) : null;
  // Beside what he explains: the area he marked, else the target, else where the mouse is.
  const about = s.about ? rectOf(s.about) : target ?? { x: s.cursor[0] - 4, y: s.cursor[1] - 4, w: 8, h: 8 };
  const taken = cards.map(({ el: c }) => bounds(c));
  if (target && s.about) taken.push(target);
  const spot = place(about, width, height, window.innerWidth, window.innerHeight, taken);
  Object.assign(el.style, { left: `${spot.x}px`, top: `${spot.y}px`, width: "0px", height: "0px" });
  cards.push(card);
  // The pointer comes out where the mouse is.
  ptr.classList.remove("docked");
  at(s.cursor[0], s.cursor[1]);
  ptr.style.opacity = "1";
  let t0 = 0;
  if (target) {
    later(t0, () => at(target.x + target.w / 2, target.y - 12, PACE.go));
    t0 += PACE.go;
    later(t0, () => {
      const r = ring(target, PACE.ring);
      card.marks.push(r);
      later(PACE.ring + PACE.to + PACE.drag + PACE.dock + RING_STAYS, () => fadeMark(r));
    });
    t0 += PACE.ring;
  }
  later(t0, () => at(spot.x, spot.y, PACE.to));
  t0 += PACE.to;
  later(t0, () => {
    if (spot.linked && target) card.marks.push(link(spot, target));
    tween(PACE.drag, (k) => {
      at(spot.x + width * k, spot.y + height * k);
      el.style.width = `${width * k}px`;
      el.style.height = `${height * k}px`;
    }, () => {
      report();
      // Home: into the empty slot at the top left of the header, as its icon.
      const sb = card.slot.getBoundingClientRect();
      at(sb.left + 4, sb.top + 4, PACE.dock);
      later(PACE.dock * 0.6, () => ptr.classList.add("docked"));
      later(PACE.dock, () => {
        ptr.style.opacity = "0";
        card.slot.replaceChildren(face());
        card.slot.classList.add("home");
      });
      reveal(card, PACE.show);
    });
  });
}

/** ↻: the same answer in a form he hasn't tried; the card keeps its place. */
function redraw(card: Card, button: HTMLButtonElement) {
  if (button.disabled) return;
  button.disabled = true;
  card.slot.classList.add("thinking");
  void Bridge.explainRedraw(card.id, card.s.question, card.s.said, card.s.window, card.tried);
}

function redrawn(r: { id: number; said?: string; window?: Record<string, any>; failed?: boolean }) {
  const card = cards.find((c) => c.id === r.id);
  if (!card) return;
  const button = card.el.querySelector<HTMLButtonElement>(".ex-again")!;
  button.disabled = false;
  card.slot.classList.remove("thinking");
  if (r.failed || !r.window) {
    button.classList.add("nope");
    window.setTimeout(() => button.classList.remove("nope"), 600);
    return;
  }
  card.s = { ...card.s, said: r.said || card.s.said, window: r.window };
  card.tried.push(formOf(r.window));
  fill(card);
  // Same place, its new size, kept on screen.
  const width = widthFor(r.window);
  const height = measure(card, width);
  const b = bounds(card.el);
  Object.assign(card.el.style, {
    width: `${width}px`,
    height: `${height}px`,
    left: `${Math.max(12, Math.min(b.x, window.innerWidth - width - 12))}px`,
    top: `${Math.max(12, Math.min(b.y, window.innerHeight - height - 12))}px`,
  });
  reveal(card, PACE.show);
  report();
}

async function main() {
  const boot = await Bridge.boot();
  setLanguage(resolveLanguage(boot?.settings.language, systemLanguages()));
  void onEvent<Show>("explain-show", (s) => show(s));
  void onEvent<null>("explain-close", () => closeAll());
  void onEvent<{ id: number; said?: string; window?: Record<string, any>; failed?: boolean }>("explain-redrawn", (r) => redrawn(r));
}

void main();
