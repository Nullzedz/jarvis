// JARVIS: the startup — "Reactor". Replaces coucou's greeting (greeting.ts) with
// the same contract (start / hover / interrupt / leave / draw / onComplete), so
// the island and its state machine drive it unchanged.
//
// A ring of light draws itself and spins up; as it slows, its gaps close and it
// bends, point by point, into the visor's rounded shape (the same ray/rounded-rect
// morph coucou uses to turn Mochi into a box). The white shell fills in behind
// it, a spark at the centre stretches into the eye, the eye holds dead centre
// for a beat and blinks. The visor stays there until the island folds: the
// island then carries it into the compact island itself (island.ts), so it
// never reaches its small spot before the island does.

import { Ease, lerp } from "../core/anim";
import { Sound } from "../core/sound";
import { rrPoint, VISOR_BOTTOM, VISOR_LIGHT, VISOR_TOP } from "./engine";

export const REACTOR_W = 640;
export const REACTOR_H = 150;

/** Timeline, seconds. END matches coucou's greeting so the island's timers still fit. */
const T = {
  draw1: 0.75, // ring drawn
  spin1: 1.6, // ring stops spinning
  morph0: 1.0,
  morph1: 1.9, // ring → visor
  body0: 1.55,
  body1: 2.05, // white shell fills in
  spark0: 1.5,
  spark1: 2.0,
  eye0: 1.85,
  eye1: 2.35, // eye stretches out of the spark
  blink: 2.95, // after the centred hold
  end: 4.6,
  autoLeave: 4.9,
};

export const REACTOR_END = T.end;

const SOUND = "greeting";
const BLUE = `rgb(${VISOR_LIGHT.map((c) => Math.round(c * 255)).join(",")})`;
const RING = "#85B7EB";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const rgb = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/** Where the visor sits in the open island, and how big (the engine's R: R = 0.3 × its canvas width). */
export const REACTOR_POSE = { x: REACTOR_W / 2, y: 80, R: 40 };
const BIG = REACTOR_POSE;

export interface ReactorPose {
  /** Spin of the ring, radians. */
  spin: number;
  /** How much of the ring is drawn, 0…1. */
  draw: number;
  /** Ring (0) → visor (1). */
  morph: number;
  /** Opacity of the white shell. */
  body: number;
  /** Width of the eye, 0…1 (with overshoot). */
  eye: number;
  /** Eye openness, for the blink. */
  open: number;
  /** The centre spark, 0…1 (1 = biggest). */
  spark: number;
  /** Width of the ring's outline. */
  ringW: number;
  /** Where the visor is and how big. */
  x: number;
  y: number;
  R: number;
}

/** The pose at `t` seconds, collapsing from `tc` when the pointer left early. */
export function reactorPose(t: number, tc = Number.POSITIVE_INFINITY): ReactorPose {
  const cut = Number.isFinite(tc) && t >= tc;
  const morph = cut ? 1 : Ease.inOut(seg(t, T.morph0, T.morph1));
  const b = seg(t, T.blink, T.blink + 0.2);
  const open = b <= 0 || b >= 1 ? 1 : b < 0.35 ? lerp(1, 0.06, Ease.inOut(b / 0.35)) : lerp(0.06, 1, Ease.out((b - 0.35) / 0.65));
  const sp = seg(t, T.spark0, T.spark1);
  return {
    spin: cut ? 0 : Ease.inOut(seg(t, 0, T.spin1)) * Math.PI * 3 * (1 - morph),
    draw: cut ? 1 : Ease.out(seg(t, 0, T.draw1)),
    morph,
    body: cut ? 1 : seg(t, T.body0, T.body1),
    eye: cut ? 1 : Ease.back(seg(t, T.eye0, T.eye1)),
    open,
    spark: cut || sp <= 0 || sp >= 1 ? 0 : (1 - seg(t, T.spark0, T.spark0 + 0.35)) * (1 - seg(t, T.spark1 - 0.15, T.spark1)) + 0.2,
    ringW: cut ? 0 : lerp(4.5, 0, seg(t, T.eye0, T.eye1 + 0.1)),
    x: BIG.x,
    y: BIG.y,
    R: BIG.R,
  };
}

/** The ring-to-visor outline: a circle of radius `ring` bent toward the visor by `m`. */
function shape(R: number, ring: number, m: number): Path2D {
  const vw = R * 1.14 * 0.96;
  const vh = R * 0.88 * 0.86;
  const vr = R * 0.38;
  const p = new Path2D();
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const v = rrPoint(ca, sa, vw, vh, vr);
    const chin = sa > 0 ? 1 - 0.1 * sa * sa : 1;
    const px = lerp(ca * ring, v.x * chin, m);
    const py = lerp(sa * ring, v.y, m);
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, r: number) {
  r = Math.max(0, Math.min(r, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

export function drawReactor(x: CanvasRenderingContext2D, p: ReactorPose) {
  const { R } = p;
  const ring = R * 0.95;
  const path = shape(R, ring, p.morph);
  x.save();
  x.translate(p.x, p.y);

  x.save();
  x.rotate(p.spin);
  if (p.body > 0) {
    x.save();
    x.globalAlpha = p.body;
    x.shadowColor = "rgba(0,0,0,0.45)";
    x.shadowBlur = R * 0.22;
    x.shadowOffsetY = R * 0.07;
    const g = x.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, rgb(VISOR_TOP));
    g.addColorStop(1, rgb(VISOR_BOTTOM));
    x.fillStyle = g;
    x.fill(path);
    x.restore();
  }
  if (p.ringW > 0.15) {
    x.save();
    x.lineWidth = p.ringW * (R / BIG.R);
    x.strokeStyle = RING;
    x.shadowColor = RING;
    x.shadowBlur = lerp(16, 6, p.morph);
    if (p.morph < 0.98) x.setLineDash([lerp(26, 260, p.morph) * (R / BIG.R), lerp(9, 0, p.morph) * (R / BIG.R)]);
    if (p.draw < 1) {
      // The ring draws itself clockwise from the top.
      const clip = new Path2D();
      clip.moveTo(0, 0);
      clip.arc(0, 0, R * 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.draw);
      clip.closePath();
      x.clip(clip);
    }
    x.stroke(path);
    x.restore();
  }
  x.restore();

  // Glass line once the shell is there.
  if (p.body > 0.6 && R > 10) {
    const rx = R * 1.14;
    const ry = R * 0.88;
    x.save();
    x.globalAlpha = (p.body - 0.6) / 0.4;
    x.strokeStyle = "rgba(255,255,255,0.95)";
    x.lineWidth = Math.max(1, R * 0.05);
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(-rx * 0.62, -ry * 0.66);
    x.quadraticCurveTo(0, -ry * 0.78, rx * 0.62, -ry * 0.66);
    x.stroke();
    x.restore();
  }

  if (p.spark > 0) {
    x.save();
    x.fillStyle = RING;
    x.shadowColor = RING;
    x.shadowBlur = R * 0.6;
    x.beginPath();
    x.arc(0, 0, R * 0.08 + p.spark * R * 0.32, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }

  if (p.eye > 0.01 && p.body > 0.5) {
    const w = R * 0.95 * p.eye;
    const h = Math.max(R * 0.16 * p.open, R * 0.05);
    x.save();
    x.fillStyle = BLUE;
    x.shadowColor = BLUE;
    x.shadowBlur = R * 0.3;
    roundRect(x, -w / 2, -h / 2, w, h, h / 2);
    x.fill();
    x.restore();
  }
  x.restore();
}

// ── Controller (same contract as greeting.ts's Greeting) ─────────────────────

export class ReactorGreeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];

  onComplete: (() => void) | null = null;

  start() {
    this.startMs = performance.now();
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    this.cancelTimers();
    Sound.play(SOUND);
    this.timers.push(window.setTimeout(() => this.fire(), (T.end + 0.05) * 1000));
  }

  /** Mouse entered the island during the startup — hold it open. */
  hover() {
    if (this.tc >= T.autoLeave) this.tc = Number.POSITIVE_INFINITY;
  }

  /** Mouse left — the island folds now and carries the visor down. */
  interrupt() {
    const t = this.elapsed;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
    Sound.fadeOut(SOUND, 0.25);
  }

  /** The startup view is gone: let what is left of its sound fade away. */
  leave() {
    this.cancelTimers();
    Sound.fadeOut(SOUND, 0.2);
  }

  get elapsed(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  get done(): boolean {
    return this.fired;
  }

  private fire() {
    if (this.fired) return;
    this.fired = true;
    this.cancelTimers();
    this.onComplete?.();
  }

  private cancelTimers() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
  }

  draw(x: CanvasRenderingContext2D) {
    const t = this.elapsed;
    if (!this.fired && t >= T.end && this.tc >= T.autoLeave) this.fire();
    x.clearRect(0, 0, REACTOR_W, REACTOR_H);
    drawReactor(x, reactorPose(t, this.tc));
  }
}
