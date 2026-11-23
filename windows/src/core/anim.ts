// Easing + spring helpers.
// Ease.* mirrors BotEngine.swift `enum Ease` (itself the prototype's `E`).
// Spring mirrors SwiftUI `.spring(response:dampingFraction:)` so open/close motion
// matches the macOS app exactly.

export const Ease = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  lin: (t: number) => t,
  easeIn: (t: number) => t * t * t,
};

export type EaseFn = (t: number) => number;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

/** cubic-bezier(x1,y1,x2,y2) — used for the 340 ms close curve (.45,0,.2,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = (t: number) => ((1 - t) ** 2 * 3 * t * x1) + (3 * (1 - t) * t * t * x2) + t ** 3;
  const cy = (t: number) => ((1 - t) ** 2 * 3 * t * y1) + (3 * (1 - t) * t * t * y2) + t ** 3;
  return (x) => {
    // Newton-ish bisection on x — 12 iterations is plenty at 60 fps.
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 12; i++) {
      const v = cx(t);
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return cy(t);
  };
}

export const closeCurve = cubicBezier(0.45, 0, 0.2, 1);

/** JARVIS: the notch prototype's one motion (jarvis-notch.html): 0.42 s, cubic-bezier(.32,.72,0,1),
 *  for the notch's width, height and corners, and for him riding along with it. */
export const NOTCH_MS = 420;
export const notchCurve = cubicBezier(0.32, 0.72, 0, 1);

/**
 * A value that glides to its target on the notch's curve and ends exactly when it's told to,
 * so what rides on the notch (JARVIS) arrives together with it: never lagging, never overshooting.
 */
export class Glide {
  value: number;
  target: number;
  private from: number;
  private start = 0;
  private end = 0;
  private ease: (t: number) => number = notchCurve;

  constructor(value: number) {
    this.value = value;
    this.target = value;
    this.from = value;
  }

  set(value: number) {
    this.value = this.target = this.from = value;
    this.end = 0;
  }

  /** Glides to `v`, arriving at `endAt` (a performance.now() time). */
  to(v: number, endAt: number, now = performance.now(), ease: (t: number) => number = notchCurve) {
    this.ease = ease;
    this.from = this.value;
    this.target = v;
    this.start = now;
    this.end = Math.max(now + 1, endAt);
  }

  get settled(): boolean {
    return this.value === this.target;
  }

  step(_dt?: number, now = performance.now()) {
    if (this.value === this.target) return;
    const p = clamp((now - this.start) / (this.end - this.start), 0, 1);
    this.value = p >= 1 ? this.target : lerp(this.from, this.target, this.ease(p));
  }
}

/**
 * SwiftUI-equivalent spring: ω₀ = 2π / response, ζ = dampingFraction.
 * Integrated per frame (sub-stepped) so a dropped frame never destabilises it.
 */
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  omega: number;
  zeta: number;

  constructor(value: number, response = 0.5, damping = 0.72) {
    this.value = value;
    this.target = value;
    this.omega = (2 * Math.PI) / response;
    this.zeta = damping;
  }

  configure(response: number, damping: number) {
    this.omega = (2 * Math.PI) / response;
    this.zeta = damping;
  }

  set(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.velocity) < 0.05;
  }

  step(dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc =
        this.omega * this.omega * (this.target - this.value) -
        2 * this.zeta * this.omega * this.velocity;
      this.velocity += acc * h;
      this.value += this.velocity * h;
    }
  }
}

/**
 * Value driven either by a spring (growing) or a timed curve (shrinking) —
 * matches IslandContainer: openSpring for grow, closeEase 340 ms for shrink.
 */
export class Tracked {
  private spring: Spring;
  private curveFrom = 0;
  private curveTo = 0;
  private curveStart = 0;
  private curveDur = 0;
  private mode: "spring" | "curve" | "idle" = "idle";
  private useNotchCurve = false;

  constructor(value: number) {
    this.spring = new Spring(value);
  }

  get value(): number {
    return this.spring.value;
  }

  get animating(): boolean {
    return this.mode !== "idle";
  }

  jump(v: number) {
    this.spring.set(v);
    this.mode = "idle";
  }

  /** Spring to `v` (open / grow). */
  springTo(v: number, response = 0.5, damping = 0.72) {
    this.spring.configure(response, damping);
    this.spring.target = v;
    this.mode = "spring";
  }

  /** JARVIS: the notch prototype's motion, both ways (0.42 s, cubic-bezier(.32,.72,0,1)). */
  tweenTo(v: number, now = performance.now(), ms = NOTCH_MS) {
    this.curveTowards(v, ms, now);
    this.useNotchCurve = true;
  }

  /** Timed curve to `v` (close / shrink), no overshoot. */
  curveTowards(v: number, durationMs = 340, now = performance.now()) {
    this.curveFrom = this.spring.value;
    this.curveTo = v;
    this.curveStart = now;
    this.curveDur = durationMs;
    this.spring.target = v;
    this.spring.velocity = 0;
    this.mode = "curve";
    this.useNotchCurve = false;
  }

  step(dt: number, now = performance.now()) {
    if (this.mode === "spring") {
      this.spring.step(dt);
      if (this.spring.settled) {
        this.spring.value = this.spring.target;
        this.spring.velocity = 0;
        this.mode = "idle";
      }
    } else if (this.mode === "curve") {
      const p = clamp((now - this.curveStart) / this.curveDur, 0, 1);
      this.spring.value = lerp(this.curveFrom, this.curveTo, (this.useNotchCurve ? notchCurve : closeCurve)(p));
      if (p >= 1) {
        this.spring.velocity = 0;
        this.mode = "idle";
      }
    }
  }
}
