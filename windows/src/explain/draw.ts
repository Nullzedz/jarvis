// JARVIS: what's inside each explanation window (issue #12), from the brain's
// window block (window_prompt.txt). Each returns the content, with the parts
// that appear one after another marked `.ix` (main.ts fades them in, in order).

const NS = "http://www.w3.org/2000/svg";
export const BLUE = "#4fa3ff";
const RED = "#ff7a6b";

type Any = Record<string, any>;
const str = (v: unknown, max = 60) => String(v ?? "").slice(0, max);
const list = (v: unknown, max = 8): Any[] => (Array.isArray(v) ? v.slice(0, max) : []);

function h(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(w: number, hgt: number): SVGSVGElement {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
  s.setAttribute("class", "ex-svg");
  return s;
}

function add(p: Element, tag: string, a: Any, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in a) e.setAttribute(k, String(a[k]));
  if (text !== undefined) e.textContent = text;
  p.appendChild(e);
  return e;
}

/** A group that fades in with the others, in order. */
function step(p: Element): SVGGElement {
  const g = add(p, "g", {}) as SVGGElement;
  g.classList.add("ix");
  return g;
}

const text = (p: Element, x: number, y: number, s: string, o: Any = {}) =>
  add(p, "text", { x, y, fill: o.f ?? "#e6e7ea", "font-size": o.z ?? 11.5, "text-anchor": o.a ?? "start", "font-weight": o.b ? 600 : 400 }, s);

/** The kinds and the width each window starts at (page px). */
export const WIDTH: Record<string, number> = { pending: 360, steps: 320, checklist: 330, diagram: 360, compare: 340, breakdown: 340, timeline: 380 };

/** What SVG may hold when he draws it himself: shapes, text and their styling; nothing that runs or loads. */
const SAFE = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "marker", "lineargradient", "radialgradient", "stop", "title", "use", "clippath", "pattern", "symbol"]);

/** His own picture, made safe: unknown elements, event handlers and outside links are dropped. */
export function safeSvg(src: string): SVGSVGElement | null {
  // Claude often leaves out the namespace: without it nothing would be drawn, only the text shown.
  let text = src.trim();
  if (!/^<svg[^>]*\sxmlns=/i.test(text)) text = text.replace(/^<svg/i, `<svg xmlns="${NS}"`);
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!SAFE.has(child.localName.toLowerCase())) child.remove();
      else walk(child);
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "xlink:href") && !v.startsWith("#")) || /url\(\s*['"]?(?!#)/.test(v) || v.includes("javascript:")) el.removeAttribute(a.name);
    }
  };
  walk(root);
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("class", "ex-svg ex-own");
  return svg;
}

/** The width a window starts at: his drawing's own width (from its viewBox), kept between 300 and 640. */
export function widthFor(w: Any): number {
  if (w.kind !== "drawing") return WIDTH[w.kind] ?? 330;
  const vb = /viewBox\s*=\s*['"]\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/i.exec(String(w.svg ?? ""));
  return Math.max(300, Math.min(640, (vb ? Number(vb[1]) : 400) + 24));
}

export function content(w: Any): HTMLElement {
  const box = h("div", "ex-content");
  switch (w.kind) {
    case "pending": {
      // Being drawn (issue #14): a few faint lines while his eye sweeps in the header.
      const wait = h("div", "ex-wait ix");
      for (const width of [92, 70, 84, 56]) {
        const bar = h("i", "");
        bar.style.width = `${width}%`;
        wait.append(bar);
      }
      box.append(wait);
      break;
    }
    case "failed":
      box.append(h("div", "ex-failed ix", str(w.text, 80)));
      break;
    case "drawing": {
      const pic = safeSvg(String(w.svg ?? ""));
      if (pic) {
        pic.classList.add("ix");
        box.append(pic);
      }
      break;
    }
    case "steps":
      list(w.steps).forEach((s, i) => {
        const row = h("div", "ex-step ix");
        row.append(h("span", "ex-num", String(i + 1)), h("span", "", str(s)));
        box.append(row);
      });
      break;
    case "checklist": {
      list(w.checks).forEach((c) => {
        const ok = c?.ok !== false;
        const row = h("div", `ex-check ix${ok ? "" : " no"}`);
        row.append(h("span", "ex-mark", ok ? "✓" : "✕"), h("span", "", str(c?.text)));
        box.append(row);
      });
      if (w.next) box.append(h("div", "ex-next ix", str(w.next, 90)));
      break;
    }
    case "diagram": {
      // Boxes two by two, each leading to the next: right, down, left, down…
      const nodes = list(w.nodes, 6).map((n) => str(n, 28));
      const rows = Math.ceil(nodes.length / 2);
      const W = 300, bw = 128, bh = 30, rowH = 62;
      const s = svg(W, rows * rowH - (rowH - bh) + 4);
      const pos = nodes.map((_, i) => {
        const r = Math.floor(i / 2), leftToRight = r % 2 === 0, c = i % 2;
        return { x: (leftToRight ? c : 1 - c) === 0 ? 2 : W - bw - 2, y: 2 + r * rowH };
      });
      nodes.forEach((n, i) => {
        const g = step(s);
        const { x, y } = pos[i];
        if (i) {
          const p = pos[i - 1];
          const d = p.y === y
            ? (p.x < x ? `M${p.x + bw} ${y + bh / 2} L${x - 4} ${y + bh / 2} M${x - 10} ${y + bh / 2 - 5} L${x - 3} ${y + bh / 2} L${x - 10} ${y + bh / 2 + 5}`
                       : `M${p.x} ${y + bh / 2} L${x + bw + 4} ${y + bh / 2} M${x + bw + 10} ${y + bh / 2 - 5} L${x + bw + 3} ${y + bh / 2} L${x + bw + 10} ${y + bh / 2 + 5}`)
            : `M${x + bw / 2} ${p.y + bh} L${x + bw / 2} ${y - 4} M${x + bw / 2 - 5} ${y - 10} L${x + bw / 2} ${y - 3} L${x + bw / 2 + 5} ${y - 10}`;
          add(g, "path", { d, fill: "none", stroke: BLUE, "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" });
        }
        add(g, "rect", { x, y, width: bw, height: bh, rx: 7, fill: "none", stroke: BLUE, "stroke-width": 1.8 });
        text(g, x + bw / 2, y + 19, n, { a: "middle", z: 11 });
      });
      box.append(s);
      break;
    }
    case "compare": {
      const bars = list(w.bars, 6);
      const max = Math.max(...bars.map((b) => Number(b?.value) || 0), 1);
      const s = svg(300, bars.length * 34 + (w.note ? 18 : 0));
      add(s, "line", { x1: 62, y1: 2, x2: 62, y2: bars.length * 34 - 4, stroke: "rgba(79,163,255,.4)" });
      bars.forEach((b, i) => {
        const g = step(s), y = 4 + i * 34, best = !!b?.best, bw = Math.max(4, 170 * (Number(b?.value) || 0) / max);
        text(g, 54, y + 15, str(b?.label, 12), { a: "end" });
        add(g, "rect", { x: 62, y, width: bw, height: 22, rx: 4, fill: best ? "rgba(79,163,255,.55)" : "rgba(79,163,255,.18)", stroke: BLUE, "stroke-width": best ? 2 : 1 });
        text(g, 68 + bw, y + 15, str(b?.text ?? b?.value, 12), { b: best, f: best ? "#fff" : "#cfd2d8" });
      });
      if (w.note) text(step(s), 0, bars.length * 34 + 12, str(w.note, 60), { z: 9.5, f: "#7fbfff" });
      box.append(s);
      break;
    }
    case "breakdown": {
      const parts = list(w.parts, 6);
      const total = parts.reduce((t, p) => t + (Number(p?.value) || 0), 0) || 1;
      const colors = ["#4fa3ff", "#7fbfff", "#a9d3ff", "#5d6b80", "#36597f", "#cfe6ff"];
      const s = svg(300, Math.max(124, 18 + parts.length * 26));
      const cx = 60, cy = 62, r = 46;
      let a0 = -Math.PI / 2;
      parts.forEach((p, i) => {
        const g = step(s), a1 = a0 + (Number(p?.value) || 0) / total * Math.PI * 2, col = colors[i % colors.length];
        add(g, "path", { d: `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(a1 - 0.03)} ${cy + r * Math.sin(a1 - 0.03)}`, fill: "none", stroke: col, "stroke-width": 17 });
        const y = 22 + i * 26;
        add(g, "rect", { x: 132, y: y - 9, width: 10, height: 10, rx: 2, fill: col });
        text(g, 148, y, str(p?.label, 14));
        text(g, 298, y, str(p?.text ?? p?.value, 10), { a: "end", b: i === 0, f: i ? "#cfd2d8" : "#fff" });
        a0 = a1;
      });
      if (w.total) text(s, cx, cy + 4, str(w.total, 10), { a: "middle", b: true, z: 12 });
      box.append(s);
      break;
    }
    case "timeline": {
      const pts = list(w.points, 6);
      const s = svg(340, 132);
      const y = 66, x0 = 20, x1 = 320, dx = pts.length > 1 ? (x1 - x0) / (pts.length - 1) : 0;
      add(s, "line", { x1: x0, y1: y, x2: x1, y2: y, stroke: BLUE, "stroke-width": 2 });
      pts.forEach((p, i) => {
        const g = step(s), x = pts.length > 1 ? x0 + dx * i : (x0 + x1) / 2, up = i % 2 ? 1 : -1, col = p?.urgent ? RED : BLUE, ty = y + up * 44;
        add(g, "line", { x1: x, y1: y, x2: x, y2: ty + (up < 0 ? 8 : -12), stroke: col, "stroke-width": 1.5 });
        add(g, "circle", { cx: x, cy: y, r: 5, fill: col });
        text(g, x, y + (up < 0 ? 20 : -10), str(p?.when, 10), { a: "middle", z: 10, f: "#7fbfff" });
        text(g, Math.min(Math.max(x, 44), 296), ty + (up < 0 ? 0 : 2), str(p?.what, 22), { a: "middle", b: !!p?.urgent, f: p?.urgent ? "#ffb3a8" : "#e6e7ea" });
      });
      box.append(s);
      break;
    }
  }
  return box;
}

/** His own drawing grown to hold everything he drew: nothing cut off at its edges. */
export function fitViewBox(svg: SVGSVGElement) {
  const vb = svg.viewBox.baseVal;
  let b: DOMRect;
  try {
    b = svg.getBBox();
  } catch {
    return;
  }
  if (!vb || !b.width || !b.height) return;
  const x0 = Math.min(vb.x, b.x - 8), y0 = Math.min(vb.y, b.y - 8);
  const x1 = Math.max(vb.x + vb.width, b.x + b.width + 8), y1 = Math.max(vb.y + vb.height, b.y + b.height + 8);
  if (x0 < vb.x || y0 < vb.y || x1 > vb.x + vb.width || y1 > vb.y + vb.height) svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Two texts of `boxes` on top of each other (more than a sliver), as their texts; or null. */
export function overlapping(boxes: { text: string; r: Box }[]): [string, string] | null {
  const area = (r: Box) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), hgt = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && hgt > 0 && w * hgt > 0.15 * Math.min(area(a), area(b))) return [boxes[i].text, boxes[j].text];
    }
  }
  return null;
}

/** What overlaps in his drawing, said for the redraw (« "links to" lies on "id (PK)" »), or null. */
export function textOverlap(root: Element): string | null {
  const boxes = [...root.querySelectorAll("text")]
    .map((t) => ({ text: (t.textContent ?? "").trim().slice(0, 30), r: t.getBoundingClientRect() }))
    .filter((b) => b.text && b.r.width > 0 && b.r.height > 0);
  const hit = overlapping(boxes);
  return hit ? `"${hit[0]}" lies on "${hit[1]}"` : null;
}
