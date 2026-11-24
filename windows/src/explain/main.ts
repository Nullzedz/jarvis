// JARVIS: his explanation windows (issue #12), on the see-through layer that
// voice/explain.rs puts over the monitor. For each window: his visor pointer
// goes to the target and traces a glowing circle round it, moves to the
// window's corner, drags the card out beside what he explains (never on it),
// then flies into the empty slot at the top left of its header and stays there
// as its icon; the contents appear meanwhile. About 2.5 s once the answer is
// ready. The circle fades a few seconds later. The card stays until its ×,
// Esc, a new question or the ask shortcut; drag its header to move it, its
// corner to resize it; ↻ redraws the same answer in another form. It never
// goes past the screen's edge. Its reply bar continues the conversation in it:
// each follow-up is a section below the last (issue #16).
// "Where is…?" (#88): no card at all; he flies to it, circles it, and the ring
// stays lit a few seconds while he says where it is.

import "./explain.css";
import { Bridge, onEvent } from "../core/bridge";
import { resolveLanguage, setLanguage, systemLanguages, t } from "../i18n/i18n";
import { BLUE, content, fitViewBox, textOverlap, widthFor } from "./draw";
import { EDGE, place, type Rect } from "./place";

/** The approved pace (ms), and how long the circle stays lit once the window is drawn. */
const PACE = { go: 350, ring: 500, to: 250, drag: 650, dock: 300, show: 400 };
const RING_STAYS = 3000;
/** No answer or drawing back by then: the card says so instead of thinking forever (#88). */
const GIVE_UP = 90_000;
const NS = "http://www.w3.org/2000/svg";

type Box = [number, number, number, number];
type Show = { add: boolean; draw: number; question: string; said: string; window: Record<string, any>; target: Box | null; about: Box | null; cursor: [number, number] };
/** "Where is…?" (#88): only the place to circle. */
type Point = { add: boolean; target: Box; cursor: [number, number] };
type Drawn = { draw: number; window?: Record<string, any>; failed?: boolean };
type Answer = { card: number; said?: string; draw?: number; window?: Record<string, any>; failed?: boolean };
/** One answer in a window: the first, or a follow-up (`question`). `draw`: its drawing's id (0: none);
 *  `fixed`: one redraw for overlapping text was asked. */
type Sec = { draw: number; question: string | null; said: string; w: Record<string, any>; tried: string[]; fixed: boolean; el: HTMLElement };
/** `ready`: drawn out and docked; `moved`: the user dragged it; `width`/`height`: the user's own size;
 *  `early`: drawings that came before it was ready; `waiting`: a follow-up is being answered;
 *  `spot`: where it is going (its full size, while it's still being drawn out); `gone`: closed. */
type Card = {
  id: number; el: HTMLElement; inner: HTMLElement; body: HTMLElement; slot: HTMLElement; reply: HTMLTextAreaElement;
  marks: SVGElement[]; s: Show; secs: Sec[]; about: Rect; target: Rect | null;
  ready: boolean; moved: boolean; width: number | null; height: number | null; early: Drawn[]; waiting: boolean;
  spot: Rect; gone: boolean;
};

const ink = document.createElementNS(NS, "svg");
ink.id = "ink";
const ptr = Object.assign(document.createElement("div"), { className: "ex-ptr" });
ptr.append(document.createElement("b"));
document.body.append(ink, ptr);

let cards: Card[] = [];
let timers: number[] = [];
let nextId = 1;
/** Marks of a "where is…?" (no card owns them). */
let loose: SVGElement[] = [];
/** Bumped by every close: motion started before it stops (#88: an old tween ended after a new
 *  question and hid his pointer for the whole new answer). */
let era = 0;
// Fired timers leave the list (#88: it only ever grew).
const later = (ms: number, f: () => void) => {
  const id = window.setTimeout(() => {
    timers = timers.filter((t) => t !== id);
    f();
  }, ms);
  timers.push(id);
};
const rectOf = (b: Box): Rect => ({ x: b[0], y: b[1], w: b[2], h: b[3] });
const formOf = (w: Record<string, any>) => String(w.form ?? w.kind ?? "");
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
/** A section with a picture in it (not a words-only follow-up). */
const pictured = (sec: { w: Record<string, any> }) => sec.w.kind !== "none";

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

/** A motion over `ms`; it stops, done never called, once everything closes (`era` moves on) or
 *  its own card does (`alive`). */
function tween(ms: number, fn: (k: number) => void, done?: () => void, alive: () => boolean = () => true) {
  const t0 = performance.now();
  const mine = era;
  const step = (n: number) => {
    if (mine !== era || !alive()) return;
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
  card.gone = true;
  // Closed while still being drawn out: its motion stops and, if no other card is coming out, his
  // pointer goes too (#88: its line and ring stayed for good).
  if (!card.ready && !cards.some((c) => !c.ready)) ptr.style.opacity = "0";
  card.el.style.opacity = "0";
  card.marks.forEach(fadeMark);
  window.setTimeout(() => {
    card.el.remove();
    report();
  }, 160);
}

function closeAll() {
  era++;
  timers.forEach(clearTimeout);
  timers = [];
  loose.forEach(fadeMark);
  loose = [];
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

/** The section ↻ and the tag are about: the last one with a picture. */
const lastPictured = (card: Card) => [...card.secs].reverse().find(pictured) ?? card.secs[0];

/** Fills a section: the follow-up's question, his line, then the picture (the parts start hidden, `.ix`). */
function fill(card: Card, sec: Sec) {
  sec.el.replaceChildren();
  // Each in the direction of its own text (#88: Arabic read left to right).
  if (sec.question !== null) sec.el.append(Object.assign(document.createElement("div"), { className: "ex-fq", textContent: sec.question, dir: "auto" }));
  if (sec.said) sec.el.append(Object.assign(document.createElement("div"), { className: `ex-said ix${sec.said === t("Thinking…") ? " thinking" : ""}`, textContent: sec.said, dir: "auto" }));
  if (pictured(sec)) sec.el.append(content(sec.w));
  card.inner.querySelector(".ex-tag")!.textContent = tagFor(lastPictured(card).w);
}

function addSec(card: Card, sec: Omit<Sec, "el">): Sec {
  const full: Sec = { ...sec, el: Object.assign(document.createElement("div"), { className: sec.question === null ? "ex-sec" : "ex-sec ex-follow" }) };
  card.secs.push(full);
  card.body.append(full.el);
  fill(card, full);
  return full;
}

/** The parts not shown yet appear one after another within `ms`. */
function reveal(root: Element, ms: number) {
  const parts = [...root.querySelectorAll<Element>(".ix:not(.on)")];
  const gap = parts.length > 1 ? Math.max(0, ms - 160) / (parts.length - 1) : 0;
  parts.forEach((p, i) => later(i * gap, () => p.classList.add("on")));
}

/** The reply bar: typing goes to the window only while it's used (issue #16). */
function replyBar(card: Card): HTMLElement {
  const bar = Object.assign(document.createElement("div"), { className: "ex-reply" });
  const field = card.reply;
  field.rows = 1;
  field.spellcheck = false;
  field.dir = "auto";
  field.placeholder = t("Ask a follow-up");
  field.setAttribute("aria-label", t("Ask a follow-up"));
  bar.append(field, Object.assign(document.createElement("span"), { className: "ex-enter", textContent: "↵" }));
  bar.addEventListener("pointerdown", (e) => {
    if (document.activeElement === field) return;
    e.preventDefault();
    void Bridge.explainFocus(true).then(() => field.focus());
  });
  field.addEventListener("blur", () => window.setTimeout(() => {
    if (!(document.activeElement instanceof HTMLTextAreaElement)) void Bridge.explainFocus(false);
  }, 0));
  field.addEventListener("input", () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 72)}px`;
  });
  field.addEventListener("keydown", (e) => {
    // Not while a Japanese or Chinese character is being chosen (#88: Enter sent it half-written).
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      follow(card);
    }
  });
  return bar;
}

/** The card's frame B: corner brackets; header (his slot, the question, tag, ↻, ×); the sections; the reply bar; the grip. */
function build(s: Show): Card {
  const el = document.createElement("div");
  el.className = "ex-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", s.question);
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
  hd.append(slot, Object.assign(document.createElement("div"), { className: "ex-q", textContent: s.question, dir: "auto" }), Object.assign(document.createElement("span"), { className: "ex-tag" }), again, x);
  const body = Object.assign(document.createElement("div"), { className: "ex-body" });
  body.setAttribute("aria-live", "polite");
  const card: Card = {
    id: nextId++, el, inner, body, slot, reply: document.createElement("textarea"), marks: [], s, secs: [],
    about: { x: 0, y: 0, w: 0, h: 0 }, target: null, ready: false, moved: false, width: null, height: null, early: [], waiting: false,
    spot: { x: 0, y: 0, w: 0, h: 0 }, gone: false,
  };
  inner.append(hd, body, replyBar(card));
  const grip = Object.assign(document.createElement("div"), { className: "ex-grip" });
  el.append(inner, grip);
  const pending = s.window.kind === "pending";
  addSec(card, { draw: s.draw, question: null, said: s.said, w: s.window, tried: pending ? [] : [formOf(s.window)], fixed: false });
  if (pending) again.disabled = true;
  x.addEventListener("click", () => remove(card));
  again.addEventListener("click", () => redraw(card, again));
  // Drag the header to move it, never past the screen's edge (its link line, now pointing nowhere, goes).
  hd.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    hd.setPointerCapture(e.pointerId);
    const r = bounds(el), sx = e.clientX, sy = e.clientY;
    card.moved = true;
    card.marks.filter((m) => m.tagName === "line").forEach(fadeMark);
    const move = (m: PointerEvent) => {
      el.style.left = `${clamp(r.x + m.clientX - sx, EDGE, window.innerWidth - r.w - EDGE)}px`;
      el.style.top = `${clamp(r.y + m.clientY - sy, EDGE, window.innerHeight - r.h - EDGE)}px`;
    };
    hd.addEventListener("pointermove", move);
    hd.addEventListener("pointerup", () => {
      hd.removeEventListener("pointermove", move);
      card.spot = bounds(el);
      report();
    }, { once: true });
  });
  // Drag the corner to resize, up to the screen's edge: its contents reflow, drawings scale, the rest scrolls.
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const r = bounds(el), sx = e.clientX, sy = e.clientY;
    // At least room for two lines of answer under the header and above the reply bar (#88: 21 px was
    // left), at most 12 px from the screen's edge as everywhere else.
    const least = hd.offsetHeight + (inner.querySelector<HTMLElement>(".ex-reply")?.offsetHeight ?? 40) + 16 + 52;
    const move = (m: PointerEvent) => {
      const w = clamp(r.w + m.clientX - sx, 240, window.innerWidth - r.x - EDGE);
      const hgt = clamp(r.h + m.clientY - sy, least, window.innerHeight - r.y - EDGE);
      card.width = w;
      card.height = hgt;
      inner.style.width = `${w}px`;
      inner.style.height = `${hgt}px`;
      el.style.width = `${w}px`;
      el.style.height = `${hgt}px`;
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", () => {
      grip.removeEventListener("pointermove", move);
      card.spot = bounds(el);
      report();
    }, { once: true });
  });
  return card;
}

/** The card's width: the user's own, or the widest of its pictures. */
const widthOf = (card: Card) => card.width ?? Math.max(...card.secs.map((sec) => (pictured(sec) ? widthFor(sec.w) : 0)), 320);

/** Sizes a card to its contents at `width`, at most the screen's height (then its sections scroll). */
function measure(card: Card, width: number): number {
  card.inner.style.width = `${width}px`;
  card.inner.style.height = "auto";
  // The height you gave it stays (#88: a follow-up or ↻ put it back to its own).
  const height = Math.min(card.height ?? card.inner.offsetHeight, window.innerHeight - 2 * EDGE);
  card.inner.style.height = `${height}px`;
  return height;
}

/** His glowing circle round the target, traced as the pointer goes round it. */
function ring(r: Rect, ms: number, alive: () => boolean = () => true): SVGElement {
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
  }, undefined, alive);
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
  const width = widthOf(card);
  Object.assign(el.style, { left: "-9999px", top: "0px", width: `${width}px` });
  document.body.append(el);
  const height = measure(card, width);
  const target = s.target ? rectOf(s.target) : null;
  // Beside what he explains: the area he marked, else the target, else where the mouse is.
  const about = s.about ? rectOf(s.about) : target ?? { x: s.cursor[0] - 4, y: s.cursor[1] - 4, w: 8, h: 8 };
  // Cards still being drawn out count at their full size (#88: at 0 × 0 the next one landed on them).
  const taken = cards.map((c) => c.spot);
  if (target && s.about) taken.push(target);
  const spot = place(about, width, height, window.innerWidth, window.innerHeight, taken);
  // A card taller or wider than the screen is made to fit it; its sections scroll.
  if (spot.h < height) card.inner.style.height = `${spot.h}px`;
  if (spot.w < width) card.inner.style.width = `${spot.w}px`;
  Object.assign(card, { about, target, spot: { x: spot.x, y: spot.y, w: spot.w, h: spot.h } });
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
      if (card.gone) return;
      const r = ring(target, PACE.ring, () => !card.gone);
      card.marks.push(r);
      later(PACE.ring + PACE.to + PACE.drag + PACE.dock + RING_STAYS, () => fadeMark(r));
    });
    t0 += PACE.ring;
  }
  later(t0, () => !card.gone && at(spot.x, spot.y, PACE.to));
  t0 += PACE.to;
  later(t0, () => {
    if (card.gone) return;
    if (spot.linked && target) card.marks.push(link(spot, target));
    tween(PACE.drag, (k) => {
      at(spot.x + spot.w * k, spot.y + spot.h * k);
      el.style.width = `${spot.w * k}px`;
      el.style.height = `${spot.h * k}px`;
    }, () => {
      if (card.gone) return;
      report();
      // Home: into the empty slot at the top left of the header, as its icon.
      const sb = card.slot.getBoundingClientRect();
      at(sb.left + 4, sb.top + 4, PACE.dock);
      later(PACE.dock * 0.6, () => ptr.classList.add("docked"));
      later(PACE.dock, () => {
        if (card.gone) return;
        ptr.style.opacity = "0";
        card.slot.replaceChildren(face());
        card.slot.classList.add("home");
        card.ready = true;
        // Still being drawn: his eye sweeps until it comes (issue #14).
        settle(card);
        const early = card.early.splice(0);
        later(PACE.show, () => early.forEach(drawn));
      });
      reveal(card.el, PACE.show);
    }, () => !card.gone);
  });
}

/** ↻: the last picture again, in a form he hasn't tried; the card keeps its place. */
function redraw(card: Card, button: HTMLButtonElement) {
  if (button.disabled) return;
  const sec = lastPictured(card);
  if (!sec.draw) return;
  button.disabled = true;
  sec.fixed = false;
  card.slot.classList.add("thinking");
  void Bridge.explainRedraw(sec.draw, sec.tried, null);
  giveUp(card, () => card.slot.classList.contains("thinking") && button.disabled, () => drawn({ draw: sec.draw, failed: true }));
}

/** Nothing came back in time (or the call itself failed): `then`, once, if `still` (#88: "Thinking…" forever). */
function giveUp(card: Card, still: () => boolean, then: () => void) {
  window.setTimeout(() => {
    if (!card.gone && still()) then();
  }, GIVE_UP);
}

/** Its new size, kept where it is (or beside what he explains if the user hasn't moved it), always on screen. */
function resize(card: Card) {
  const width = widthOf(card);
  const height = measure(card, width);
  const b = bounds(card.el);
  let { x, y } = b;
  if (!card.moved && card.height === null && card.secs.length === 1) {
    const taken = cards.filter((c) => c !== card).map(({ el }) => bounds(el));
    if (card.target && card.s.about) taken.push(card.target);
    ({ x, y } = place(card.about, width, height, window.innerWidth, window.innerHeight, taken));
  }
  card.el.style.transition = "opacity .15s ease, width .25s ease, height .25s ease, left .25s ease, top .25s ease";
  const left = clamp(x, EDGE, window.innerWidth - width - EDGE), top = clamp(y, EDGE, window.innerHeight - height - EDGE);
  card.spot = { x: left, y: top, w: width, h: height };
  Object.assign(card.el.style, { width: `${width}px`, height: `${height}px`, left: `${left}px`, top: `${top}px` });
  window.setTimeout(() => {
    card.el.style.transition = "";
    report();
  }, 270);
}

/** Who has drawing `draw`: its card and section. */
function owner(draw: number): [Card, Sec] | null {
  for (const card of cards) {
    const sec = card.secs.find((s) => s.draw === draw);
    if (sec) return [card, sec];
  }
  return null;
}

/** His eye sweeps while anything in the card is being answered or drawn; ↻ works on the last picture once it's there. */
function settle(card: Card) {
  const last = lastPictured(card);
  const button = card.el.querySelector<HTMLButtonElement>(".ex-again")!;
  card.slot.classList.toggle("thinking", card.waiting || card.secs.some((s) => s.w.kind === "pending"));
  button.disabled = !last.draw || last.w.kind === "pending";
}

/** A drawing came (or didn't) for a section: checked for overlapping text, then shown. */
function drawn(r: Drawn) {
  const found = owner(r.draw);
  if (!found) return;
  const [card, sec] = found;
  if (!card.ready) {
    card.early.push(r);
    return;
  }
  const waiting = sec.w.kind === "pending";
  if (r.failed || !r.window) {
    if (waiting) {
      sec.w = { kind: "failed", text: t("I couldn't draw this, sir. Try ↻.") };
      fill(card, sec);
      resize(card);
      reveal(sec.el, PACE.show);
    } else {
      const button = card.el.querySelector<HTMLButtonElement>(".ex-again")!;
      button.classList.add("nope");
      window.setTimeout(() => button.classList.remove("nope"), 600);
    }
    settle(card);
    return;
  }
  const before = sec.w;
  sec.w = r.window;
  fill(card, sec);
  // A drawing that still can't be read says so, with ↻ (#88: the card was left blank).
  if (r.window.kind === "drawing" && !sec.el.querySelector("svg.ex-own")) {
    sec.w = { kind: "failed", text: t("I couldn't draw this, sir. Try ↻.") };
    fill(card, sec);
    sec.tried.push(formOf(r.window));
    settle(card);
    resize(card);
    reveal(sec.el, PACE.show);
    return;
  }
  measure(card, widthOf(card));
  const own = sec.el.querySelector<SVGSVGElement>("svg.ex-own");
  if (own) fitViewBox(own);
  // Text on top of other text: one more try, his eye still sweeping (issue #14).
  const overlap = own ? textOverlap(own) : null;
  if (overlap && !sec.fixed) {
    sec.fixed = true;
    sec.w = before;
    fill(card, sec);
    sec.el.querySelectorAll(".ix").forEach((e) => e.classList.add("on"));
    card.slot.classList.add("thinking");
    void Bridge.explainRedraw(sec.draw, [], overlap);
    return;
  }
  sec.tried.push(formOf(r.window));
  settle(card);
  resize(card);
  reveal(sec.el, PACE.show);
}

/** Enter in the reply bar: the follow-up becomes a section; his answer fills it (issue #16). */
function follow(card: Card) {
  const q = card.reply.value.trim();
  if (!q || card.waiting) return;
  card.waiting = true;
  card.reply.readOnly = true;
  card.el.classList.add("asking");
  const sec = addSec(card, { draw: 0, question: q, said: t("Thinking…"), w: { kind: "none" }, tried: [], fixed: false });
  sec.el.querySelectorAll(".ix").forEach((e) => e.classList.add("on"));
  settle(card);
  resize(card);
  later(30, () => sec.el.scrollIntoView({ block: "end", behavior: "smooth" }));
  void Bridge.explainAsk(card.s.draw, q);
  giveUp(card, () => card.waiting && sec.said === t("Thinking…"), () => answered({ card: card.s.draw, failed: true }));
}

/** His answer to a follow-up: its words, and a drawing (being made, or ready) when it helps. */
function answered(a: Answer) {
  const card = cards.find((c) => c.s.draw === a.card);
  if (!card) return;
  const sec = [...card.secs].reverse().find((s) => s.question !== null && s.said === t("Thinking…"));
  card.waiting = false;
  card.reply.readOnly = false;
  card.el.classList.remove("asking");
  if (sec) {
    sec.said = a.failed ? t("I couldn't answer that just now, sir.") : a.said ?? "";
    if (a.window && a.draw) {
      sec.draw = a.draw;
      sec.w = a.window;
      if (a.window.kind !== "pending") sec.tried.push(formOf(a.window));
    }
    fill(card, sec);
    resize(card);
    reveal(sec.el, PACE.show);
    later(30, () => sec.el.scrollIntoView({ block: "end", behavior: "smooth" }));
  }
  if (!a.failed) {
    card.reply.value = "";
    card.reply.style.height = "";
  }
  settle(card);
}

/** "Where is…?" (#88): he goes to it and circles it; the ring stays lit a while, then all of it goes. No card. */
function point(p: Point) {
  if (!p.add) closeAll();
  const target = rectOf(p.target);
  ptr.classList.remove("docked");
  at(p.cursor[0], p.cursor[1]);
  ptr.style.opacity = "1";
  later(0, () => at(target.x + target.w / 2, target.y - 12, PACE.go));
  later(PACE.go, () => {
    const r = ring(target, PACE.ring);
    loose.push(r);
    // Then he waits just outside it, below its left end, while you look.
    later(PACE.ring, () => at(Math.max(EDGE, target.x - 34), target.y + target.h + 8, PACE.to));
    later(PACE.ring + RING_STAYS, () => {
      ptr.style.opacity = "0";
      loose = loose.filter((m) => m !== r);
      fadeMark(r);
      // Nothing else up: the layer goes off screen.
      if (!cards.length && !loose.length) window.setTimeout(report, 560);
    });
  });
}

async function main() {
  const boot = await Bridge.boot();
  setLanguage(resolveLanguage(boot?.settings.language, systemLanguages()));
  void onEvent<Show>("explain-show", (s) => show(s));
  void onEvent<Point>("explain-point", (p) => point(p));
  // Esc in the page too, on every system (#88: only Rust's, on Windows).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (cards.length || loose.length)) closeAll();
  });
  void onEvent<null>("explain-close", () => closeAll());
  void onEvent<Drawn>("explain-drawn", (r) => drawn(r));
  void onEvent<Answer>("explain-answer", (a) => answered(a));
}

void main();
