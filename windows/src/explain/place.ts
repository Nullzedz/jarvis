// JARVIS: where an explanation window goes (issue #12). Beside what he points
// at, on the side with the most room, never covering it nor a window already up;
// with no room anywhere beside it, at the screen's edge, linked back by a line.
// Never past the screen's edge: a window bigger than the screen is made to fit (#88).

export type Rect = { x: number; y: number; w: number; h: number };

/** Space kept between the target and the window, and from the screen's edge. */
export const GAP = 18;
export const EDGE = 12;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The window's place for a target (or the pointer when there's none), its size
 * (w, h), the screen (vw, vh) and the windows already up. `linked`: it had to go
 * away from the target, so a line links it back. The size it returns may be
 * smaller than asked: never more than the screen less its edges.
 */
export function place(target: Rect, w: number, h: number, vw: number, vh: number, taken: Rect[] = []): Rect & { linked: boolean } {
  // #88: a window bigger than the screen ran off its right or bottom edge.
  w = Math.max(1, Math.min(w, vw - 2 * EDGE));
  h = Math.max(1, Math.min(h, vh - 2 * EDGE));
  const fitY = (y: number) => clamp(y, EDGE, vh - h - EDGE);
  const fitX = (x: number) => clamp(x, EDGE, vw - w - EDGE);
  const onScreen = (r: Rect) => r.x >= EDGE - 0.5 && r.y >= EDGE - 0.5 && r.x + r.w <= vw - EDGE + 0.5 && r.y + r.h <= vh - EDGE + 0.5;
  const free = (r: Rect) => !taken.some((t) => overlaps(r, t));
  const room = {
    right: vw - (target.x + target.w) - GAP - EDGE,
    left: target.x - GAP - EDGE,
    below: vh - (target.y + target.h) - GAP - EDGE,
    above: target.y - GAP - EDGE,
  };
  const sides: [keyof typeof room, Rect][] = [
    ["right", { x: target.x + target.w + GAP, y: fitY(target.y + target.h / 2 - h / 2), w, h }],
    ["left", { x: target.x - GAP - w, y: fitY(target.y + target.h / 2 - h / 2), w, h }],
    ["below", { x: fitX(target.x + target.w / 2 - w / 2), y: target.y + target.h + GAP, w, h }],
    ["above", { x: fitX(target.x + target.w / 2 - w / 2), y: target.y - GAP - h, w, h }],
  ];
  // #88: beside it means wholly on screen too, not only on the side's own axis.
  const fits = (side: keyof typeof room, r: Rect) =>
    room[side] >= (side === "right" || side === "left" ? w : h) && onScreen(r) && !overlaps(r, target) && free(r);
  // The side with the most room that the window fits on.
  const ok = sides.filter(([s, r]) => fits(s, r)).sort((a, b) => room[b[0]] - room[a[0]]);
  if (ok.length) return { ...ok[0][1], linked: false };
  // Nowhere beside it: the screen's corners and edges (#88: it tried one corner only, and covered
  // an older window or the target when another spot was free). Free of both first, nearest the
  // target so its line is short; then off the target at least, covering as few windows as can be.
  const xs = [EDGE, vw / 2 - w / 2, vw - w - EDGE].map(fitX);
  const ys = [EDGE, vh / 2 - h / 2, vh - h - EDGE].map(fitY);
  const tcx = target.x + target.w / 2, tcy = target.y + target.h / 2;
  const spots: Rect[] = [];
  for (const [j, y] of ys.entries()) for (const [i, x] of xs.entries()) if (i !== 1 || j !== 1) spots.push({ x, y, w, h });
  const dist = (r: Rect) => Math.hypot(r.x + w / 2 - tcx, r.y + h / 2 - tcy);
  const covered = (r: Rect) => taken.filter((t) => overlaps(r, t)).length;
  const clear = spots.filter((r) => !overlaps(r, target) && free(r)).sort((a, b) => dist(a) - dist(b));
  if (clear.length) return { ...clear[0], linked: true };
  const offTarget = spots.filter((r) => !overlaps(r, target)).sort((a, b) => covered(a) - covered(b) || dist(a) - dist(b));
  if (offTarget.length) return { ...offTarget[0], linked: true };
  // Nothing off the target (it fills the screen): the corner farthest from its middle.
  const cx = tcx < vw / 2 ? vw - w - EDGE : EDGE;
  const cy = tcy < vh / 2 ? vh - h - EDGE : EDGE;
  return { x: fitX(cx), y: fitY(cy), w, h, linked: true };
}
