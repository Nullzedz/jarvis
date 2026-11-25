// JARVIS: the startup — "Reactor". Replaces jarvis's greeting (greeting.ts) with
// the same contract (start / hover / interrupt / leave / draw / onComplete), so
// the island and its state machine drive it unchanged.
//
// A ring of light draws itself and spins up; as it slows, its gaps close and it
// bends, point by point, into the visor's rounded shape (the same ray/rounded-rect
// morph jarvis uses to turn Mochi into a box). The white shell fills in behind
// it, a spark at the centre stretches into the eye, the eye holds dead centre
// for a beat and blinks. The visor stays there until the island folds: the
// island then carries it into the compact island itself (island.ts), so it
// never reaches its small spot before the island does.

import { Ease, lerp } from "../core/anim";
import { Sound } from "../core/sound";
import { rrPoint, VISOR_BOTTOM, VISOR_LIGHT, VISOR_TOP } from "./engine";

export const REACTOR_W = 640;
export const REACTOR_H = 150;

/** Timeline, seconds. END matches jarvis's greeting so the island's timers still fit. */
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

/** `charge` (0…1): how much the black hole has swallowed — the ring burns brighter with it. */
export function drawReactor(x: CanvasRenderingContext2D, p: ReactorPose, charge = 0) {
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
    x.lineWidth = p.ringW * (R / BIG.R) * (1 + 0.5 * charge);
    x.strokeStyle = RING;
    x.shadowColor = RING;
    x.shadowBlur = lerp(16, 6, p.morph) + 30 * charge;
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

// ── The black hole ────────────────────────────────────────────────────────────
//
// Specks of light drift across the island. While the ring spins, gravity grows
// at its centre: every speck spirals in, streaking, and is swallowed by a core
// that brightens with each one. At BOOM, the instant the ring bends into the
// visor, the core explodes: a flash, two shockwaves, and every speck blasts
// back out, slows and fades. Simulated in a space twice the canvas (the
// mock-up's), drawn at half scale.

const N = 90;
export const BOOM = 1.62;
const SIM = 2; // simulation units per canvas pixel

interface Speck {
  x: number; y: number; vx: number; vy: number;
  px: number; py: number;
  s: number; hot: boolean; tw: number;
  gone: boolean; life: number;
}

export class BlackHole {
  specks: Speck[] = [];
  absorbed = 0;
  boomed = false;

  seed(random: () => number = Math.random) {
    this.absorbed = 0;
    this.boomed = false;
    this.specks = Array.from({ length: N }, () => {
      const a = random() * Math.PI * 2;
      const d = 0.35 + random() * 0.65;
      const x = Math.cos(a) * d * 600;
      const y = Math.sin(a) * d * 130;
      return { x, y, px: x, py: y, vx: (random() - 0.5) * 8, vy: (random() - 0.5) * 4, s: random() * 2 + 1, hot: random() < 0.3, tw: random() * 6.3, gone: false, life: 0 };
    });
  }

  /** How much has been swallowed, 0…1 (back to 0 once it has exploded). */
  get charge(): number {
    return this.boomed ? 0 : this.absorbed / N;
  }

  step(t: number, dt: number, random: () => number = Math.random) {
    const grav = seg(t, 0.15, 1.4);
    if (!this.boomed && t >= BOOM) {
      this.boomed = true;
      for (const p of this.specks) {
        const a = random() * Math.PI * 2;
        const sp = 900 + random() * 1300;
        p.gone = false;
        p.x = Math.cos(a) * 8;
        p.y = Math.sin(a) * 4;
        p.px = p.x;
        p.py = p.y;
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp * 0.36;
        p.life = 0;
      }
    }
    for (const p of this.specks) {
      p.px = p.x;
      p.py = p.y;
      if (p.gone) continue;
      const d = Math.hypot(p.x, p.y * 2.6) || 1;
      if (!this.boomed) {
        const g = grav * grav;
        const pull = (900 + 40000 / Math.max(d, 30)) * g;
        p.vx += (-p.x / d) * pull * dt * 3.2;
        p.vy += ((-p.y * 2.6) / d) * pull * dt * 1.25;
        const tan = g * (0.6 + 90 / Math.max(d, 25));
        p.vx += ((-p.y * 2.6) / d) * tan * dt * 60;
        p.vy += (p.x / d) * tan * dt * 23;
        p.vx *= Math.pow(0.2, dt);
        p.vy *= Math.pow(0.2, dt);
        if (d < 32 * SIM && grav > 0.25) {
          p.gone = true;
          this.absorbed++;
        }
      } else {
        p.life += dt;
        p.vx *= Math.pow(0.06, dt);
        p.vy *= Math.pow(0.06, dt);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Everything behind the visor: specks, the dark well, the core, the flash, the shockwaves, the glow. */
  draw(x: CanvasRenderingContext2D, t: number, cx: number, cy: number, fade: number) {
    if (fade <= 0) return;
    const k = 1 / SIM;
    x.save();
    x.globalAlpha = fade;
    x.lineCap = "round";
    for (const p of this.specks) {
      if (p.gone) continue;
      let a = seg(t, 0, 0.45) * (0.6 + 0.4 * Math.sin(t * 3 + p.tw)) * (p.hot ? 1 : 0.6);
      if (this.boomed) a *= 1 - seg(p.life, 0.5, 2.4);
      if (a <= 0) continue;
      const col = p.hot ? "181,212,244" : "133,183,235";
      const w = p.s * (p.hot ? 1.5 : 1) * k * 1.4;
      x.strokeStyle = `rgba(${col},${a})`;
      x.fillStyle = x.strokeStyle;
      x.shadowColor = RING;
      x.shadowBlur = p.hot ? 6 : 0;
      const sx = cx + p.px * k;
      const sy = cy + p.py * k;
      const ex = cx + p.x * k;
      const ey = cy + p.y * k;
      x.lineWidth = w;
      x.beginPath();
      if (Math.hypot(ex - sx, ey - sy) < 0.8) {
        x.arc(ex, ey, w * 0.6, 0, Math.PI * 2);
        x.fill();
      } else {
        x.moveTo(sx - (ex - sx) * 1.5, sy - (ey - sy) * 1.5);
        x.lineTo(ex, ey);
        x.stroke();
      }
    }
    x.shadowBlur = 0;

    const grav = seg(t, 0.15, 1.4);
    if (!this.boomed && grav > 0) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 70);
      g.addColorStop(0, "rgba(0,0,0,0.95)");
      g.addColorStop(0.5, `rgba(0,0,0,${0.5 * grav})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(cx - 160, cy - 80, 320, 160);
    }
    const charge = this.charge;
    if (charge > 0) {
      x.fillStyle = `rgba(181,212,244,${0.35 + 0.6 * charge})`;
      x.shadowColor = RING;
      x.shadowBlur = 15 * charge + 3;
      x.beginPath();
      x.arc(cx, cy, (2 + 10 * charge) * (0.9 + 0.1 * Math.sin(t * 30)), 0, Math.PI * 2);
      x.fill();
      x.shadowBlur = 0;
    }
    if (t >= BOOM && t < BOOM + 0.45) {
      const q = seg(t, BOOM, BOOM + 0.45);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 40 + q * 300);
      g.addColorStop(0, `rgba(230,242,252,${(1 - q) * 0.9})`);
      g.addColorStop(0.4, `rgba(133,183,235,${(1 - q) * 0.45})`);
      g.addColorStop(1, "rgba(133,183,235,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, REACTOR_W, REACTOR_H);
    }
    for (const [delay, strength] of [[0, 1], [0.12, 0.7]]) {
      if (t >= BOOM + delay && t < BOOM + delay + 0.75) {
        const f = seg(t, BOOM + delay, BOOM + delay + 0.75);
        const q = Ease.out(f);
        x.strokeStyle = `rgba(133,183,235,${(1 - f) * 0.75 * strength})`;
        x.lineWidth = (2.5 * (1 - f) + 0.5) * strength;
        x.beginPath();
        x.ellipse(cx, cy, 15 + q * 320, 7 + q * 100, 0, 0, Math.PI * 2);
        x.stroke();
      }
    }
    const glow = seg(t, BOOM, BOOM + 0.2) * (1 - seg(t, BOOM + 0.3, 3.6) * 0.6);
    if (glow > 0) {
      const R = BIG.R;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 4.2);
      g.addColorStop(0, `rgba(133,183,235,${0.4 * glow})`);
      g.addColorStop(1, "rgba(55,138,221,0)");
      x.fillStyle = g;
      x.fillRect(cx - R * 5, cy - R * 5, R * 10, R * 10);
    }
    x.restore();
  }
}

// ── Controller (same contract as greeting.ts's Greeting) ─────────────────────

export class ReactorGreeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];
  private hole = new BlackHole();
  private lastT = 0;

  onComplete: (() => void) | null = null;

  start() {
    this.startMs = performance.now();
    this.hole.seed();
    this.lastT = 0;
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
    const pose = reactorPose(t, this.tc);
    // Fixed small steps, so a slow frame never lets a speck jump past the core.
    let dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    while (dt > 1e-6) {
      const h = Math.min(dt, 1 / 120);
      this.hole.step(t - dt + h, h);
      dt -= h;
    }
    // Leaving early: the specks fade out with the fold.
    const cut = Number.isFinite(this.tc) && t >= this.tc;
    const fade = cut ? 1 - seg(t, this.tc, this.tc + 0.25) : 1;
    this.hole.draw(x, t, pose.x, pose.y, fade);
    drawReactor(x, pose, this.hole.charge);
  }
}
