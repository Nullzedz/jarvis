// JARVIS: where an explanation window goes (issue #12). Beside what he points
// at, on the side with the most room, never covering it nor a window already up;
// with no room anywhere beside it, at the screen's edge, linked back by a line.

export type Rect = { x: number; y: number; w: number; h: number };

/** Space kept between the target and the window, and from the screen's edge. */
export const GAP = 18;
export const EDGE = 12;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The window's place for a target (or the pointer when there's none), its size
 * (w, h), the screen (vw, vh) and the windows already up. `linked`: it had to go
 * to the edge, away from the target.
 */
export function place(target: Rect, w: number, h: number, vw: number, vh: number, taken: Rect[] = []): Rect & { linked: boolean } {
  const fitY = (y: number) => clamp(y, EDGE, vh - h - EDGE);
  const fitX = (x: number) => clamp(x, EDGE, vw - w - EDGE);
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
  const fits = (side: keyof typeof room, r: Rect) =>
    room[side] >= (side === "right" || side === "left" ? w : h) && !taken.some((t) => overlaps(r, t));
  // The side with the most room that the window fits on.
  const ok = sides.filter(([s, r]) => fits(s, r)).sort((a, b) => room[b[0]] - room[a[0]]);
  if (ok.length) return { ...ok[0][1], linked: false };
  // Nowhere beside it: the screen corner farthest from the target, linked back to it.
  const cx = target.x + target.w / 2 < vw / 2 ? vw - w - EDGE : EDGE;
  const cy = target.y + target.h / 2 < vh / 2 ? vh - h - EDGE : EDGE;
  return { x: fitX(cx), y: fitY(cy), w, h, linked: true };
}
