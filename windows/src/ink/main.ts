// JARVIS: the trail while circling something (design C, the dashed lasso),
// drawn over the monitor by voice/ink.rs. A dashed blue line follows the
// pointer; once it closes, the inside fills with a faint blue; let go and it fades.

import { onEvent } from "../core/bridge";

const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("ink")!;
document.documentElement.style.cssText = "margin:0;background:transparent;overflow:hidden";
document.body.style.cssText = "margin:0;background:transparent;overflow:hidden";
svg.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;transition:opacity .25s ease");

const line = document.createElementNS(NS, "path");
line.setAttribute("fill", "none");
line.setAttribute("stroke", "#4fa3ff");
line.setAttribute("stroke-width", "1.8");
line.setAttribute("stroke-dasharray", "5 4");
line.setAttribute("stroke-linecap", "round");
line.setAttribute("stroke-linejoin", "round");
line.style.transition = "fill .2s ease";
const head = document.createElementNS(NS, "circle");
head.setAttribute("r", "3");
head.setAttribute("fill", "#fff");
svg.append(line, head);

function clear() {
  line.setAttribute("d", "");
  line.setAttribute("fill", "none");
  head.setAttribute("r", "0");
}

void onEvent<null>("ink-start", () => {
  clear();
  svg.style.opacity = "1";
});

void onEvent<{ points: [number, number][]; closed: boolean }>("ink-path", ({ points, closed }) => {
  if (!points.length) return;
  line.setAttribute("d", `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`);
  line.setAttribute("fill", closed ? "rgba(79,163,255,0.10)" : "none");
  const [x, y] = points[points.length - 1];
  head.setAttribute("cx", String(x));
  head.setAttribute("cy", String(y));
  head.setAttribute("r", closed ? "0" : "3");
});

void onEvent<null>("ink-end", () => {
  svg.style.opacity = "0";
  setTimeout(clear, 260);
});
